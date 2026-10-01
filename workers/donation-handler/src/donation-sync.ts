/**
 * Records Stripe donations in NPSP.
 * One-time gifts become a Posted Donation opportunity. A monthly gift creates
 * an Enhanced Recurring Donation on its first payment, and each paid invoice
 * posts that month's installment. Every opportunity stores its Stripe ID in
 * Stripe_Payment_Id__c, so a webhook that Stripe delivers twice is recorded once.
 */

import {
  ownerFields,
  query,
  sfRequest,
  soqlString,
  splitName,
  upsertContact,
  withoutEmpty,
  type CreateResponse,
  type SalesforceEnv,
  type SObjectFields,
} from '../../shared/salesforce';

/** Metadata the donation worker attaches to every PaymentIntent and Subscription. */
export interface DonationMetadata {
  fund?: string;
  anonymous?: string;
  tribute_type?: string;
  tribute_name?: string;
}

export interface Donor {
  email: string;
  name?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

const DEFAULT_FUND = 'General Fund';

// ==========================================================================
// Lookups
// ==========================================================================

let donationRecordTypeId: string | null = null;

async function getDonationRecordTypeId(env: SalesforceEnv): Promise<string> {
  if (!donationRecordTypeId) {
    const [rt] = await query<{ Id: string }>(
      env,
      "SELECT Id FROM RecordType WHERE SobjectType = 'Opportunity' AND DeveloperName = 'Donation'"
    );
    if (!rt) throw new Error('Salesforce Donation record type not found');
    donationRecordTypeId = rt.Id;
  }
  return donationRecordTypeId;
}

const fundIds = new Map<string, string | null>();

/** Finds the NPSP General Accounting Unit for a fund name. Unknown funds fall back to the General Fund. */
async function getFundId(env: SalesforceEnv, fund: string): Promise<string | null> {
  for (const name of [fund, DEFAULT_FUND]) {
    if (!fundIds.has(name)) {
      const [gau] = await query<{ Id: string }>(
        env,
        `SELECT Id FROM npsp__General_Accounting_Unit__c WHERE Name = ${soqlString(name)}` +
          ' AND npsp__Active__c = true LIMIT 1'
      );
      fundIds.set(name, gau?.Id ?? null);
    }
    const id = fundIds.get(name);
    if (id) return id;
  }
  return null;
}

async function findOpportunityByStripeId(
  env: SalesforceEnv,
  stripeId: string
): Promise<{ Id: string; StageName: string; Description: string | null } | null> {
  const [opp] = await query<{ Id: string; StageName: string; Description: string | null }>(
    env,
    `SELECT Id, StageName, Description FROM Opportunity WHERE Stripe_Payment_Id__c = ${soqlString(stripeId)} LIMIT 1`
  );
  return opp ?? null;
}

async function upsertDonor(env: SalesforceEnv, donor: Donor): Promise<string> {
  return upsertContact(env, donor.email, {
    ...(donor.name ? splitName(donor.name) : {}),
    MailingStreet: donor.street,
    MailingCity: donor.city,
    MailingState: donor.state,
    MailingPostalCode: donor.postalCode,
  });
}

// ==========================================================================
// Field mapping
// ==========================================================================

function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function tributeFields(metadata: DonationMetadata): SObjectFields {
  const type =
    metadata.tribute_type === 'in_honor'
      ? 'Honor'
      : metadata.tribute_type === 'in_memory'
        ? 'Memorial'
        : undefined;
  if (!type) return {};
  return { npsp__Tribute_Type__c: type, npsp__Honoree_Name__c: metadata.tribute_name };
}

function opportunityName(donor: Donor, amount: number, date: string, label: string): string {
  const who = donor.name?.trim() || donor.email;
  return `${who} $${amount.toFixed(2)} ${label} ${date}`.slice(0, 120);
}

/** Notes for the Description field, such as a fund the form listed as "Other". */
function describeFund(metadata: DonationMetadata): string | undefined {
  const fund = metadata.fund?.trim();
  return fund && fund !== DEFAULT_FUND ? `Designated on the website: ${fund}` : undefined;
}

async function allocateToFund(
  env: SalesforceEnv,
  parent: { npsp__Opportunity__c: string } | { npsp__Recurring_Donation__c: string },
  fund: string | undefined
): Promise<void> {
  const gauId = await getFundId(env, fund?.trim() || DEFAULT_FUND);
  if (!gauId) return;
  await sfRequest(env, 'POST', '/sobjects/npsp__Allocation__c', {
    ...parent,
    npsp__General_Accounting_Unit__c: gauId,
    npsp__Percent__c: 100,
  });
}

// ==========================================================================
// One-time gifts
// ==========================================================================

export async function recordOneTimeGift(
  env: SalesforceEnv,
  gift: {
    paymentIntentId: string;
    amountCents: number;
    date: string;
    donor: Donor;
    metadata: DonationMetadata;
  }
): Promise<void> {
  if (await findOpportunityByStripeId(env, gift.paymentIntentId)) return;

  const contactId = await upsertDonor(env, gift.donor);
  const amount = toDollars(gift.amountCents);

  const created = await sfRequest<CreateResponse>(env, 'POST', '/sobjects/Opportunity', {
    RecordTypeId: await getDonationRecordTypeId(env),
    Name: opportunityName(gift.donor, amount, gift.date, 'Donation'),
    npsp__Primary_Contact__c: contactId,
    Amount: amount,
    CloseDate: gift.date,
    StageName: 'Posted',
    LeadSource: 'Web',
    Stripe_Payment_Id__c: gift.paymentIntentId,
    Anonymous_Gift__c: gift.metadata.anonymous === 'true',
    ...withoutEmpty({ Description: describeFund(gift.metadata), ...tributeFields(gift.metadata) }),
    ...ownerFields(env),
  });

  await allocateToFund(env, { npsp__Opportunity__c: created.id }, gift.metadata.fund);
}

// ==========================================================================
// Monthly gifts
// ==========================================================================

async function findRecurringDonation(
  env: SalesforceEnv,
  subscriptionId: string
): Promise<string | null> {
  const [rd] = await query<{ Id: string }>(
    env,
    `SELECT Id FROM npe03__Recurring_Donation__c WHERE npsp__CommitmentId__c = ${soqlString(subscriptionId)} LIMIT 1`
  );
  return rd?.Id ?? null;
}

async function createRecurringDonation(
  env: SalesforceEnv,
  sub: {
    subscriptionId: string;
    amountCents: number;
    date: string;
    donor: Donor;
    metadata: DonationMetadata;
  }
): Promise<string> {
  const contactId = await upsertDonor(env, sub.donor);
  const day = String(Number(sub.date.slice(8, 10)));

  const created = await sfRequest<CreateResponse>(
    env,
    'POST',
    '/sobjects/npe03__Recurring_Donation__c',
    {
      Name: opportunityName(sub.donor, toDollars(sub.amountCents), sub.date, 'Monthly'),
      npe03__Contact__c: contactId,
      npe03__Amount__c: toDollars(sub.amountCents),
      npsp__RecurringType__c: 'Open',
      npe03__Installment_Period__c: 'Monthly',
      npsp__InstallmentFrequency__c: 1,
      npsp__Day_of_Month__c: day,
      npsp__StartDate__c: sub.date,
      npe03__Date_Established__c: sub.date,
      npsp__Status__c: 'Active',
      npsp__PaymentMethod__c: 'Credit Card',
      npsp__CommitmentId__c: sub.subscriptionId,
      ...ownerFields(env),
    }
  );

  await allocateToFund(env, { npsp__Recurring_Donation__c: created.id }, sub.metadata.fund);
  return created.id;
}

/**
 * Posts one paid monthly invoice. Enhanced Recurring Donations keeps the next
 * installment open as a Pledged opportunity, so that one is marked Posted.
 * When NPSP has not created it yet, a Posted installment is created directly.
 */
export async function recordRecurringInstallment(
  env: SalesforceEnv,
  installment: {
    subscriptionId: string;
    invoiceId: string;
    amountCents: number;
    date: string;
    donor: Donor;
    metadata: DonationMetadata;
  }
): Promise<void> {
  if (await findOpportunityByStripeId(env, installment.invoiceId)) return;

  const rdId =
    (await findRecurringDonation(env, installment.subscriptionId)) ??
    (await createRecurringDonation(env, installment));

  const amount = toDollars(installment.amountCents);
  const posted: SObjectFields = {
    Amount: amount,
    CloseDate: installment.date,
    StageName: 'Posted',
    Stripe_Payment_Id__c: installment.invoiceId,
    Anonymous_Gift__c: installment.metadata.anonymous === 'true',
    ...withoutEmpty(tributeFields(installment.metadata)),
  };

  const [pledged] = await query<{ Id: string }>(
    env,
    `SELECT Id FROM Opportunity WHERE npe03__Recurring_Donation__c = ${soqlString(rdId)}` +
      ' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 1'
  );

  if (pledged) {
    await sfRequest(env, 'PATCH', `/sobjects/Opportunity/${pledged.Id}`, posted);
    return;
  }

  const [rd] = await query<{ npe03__Contact__c: string }>(
    env,
    `SELECT npe03__Contact__c FROM npe03__Recurring_Donation__c WHERE Id = ${soqlString(rdId)}`
  );
  await sfRequest(env, 'POST', '/sobjects/Opportunity', {
    RecordTypeId: await getDonationRecordTypeId(env),
    Name: opportunityName(installment.donor, amount, installment.date, 'Monthly Donation'),
    npsp__Primary_Contact__c: rd.npe03__Contact__c,
    npe03__Recurring_Donation__c: rdId,
    LeadSource: 'Web',
    ...posted,
    ...ownerFields(env),
  });
}

/** Closes the Recurring Donation when the Stripe subscription ends. */
export async function closeRecurringDonation(
  env: SalesforceEnv,
  subscriptionId: string,
  reason: string
): Promise<void> {
  const rdId = await findRecurringDonation(env, subscriptionId);
  if (!rdId) return;
  await sfRequest(env, 'PATCH', `/sobjects/npe03__Recurring_Donation__c/${rdId}`, {
    npsp__Status__c: 'Closed',
    npsp__ClosedReason__c: reason,
  });
}

// ==========================================================================
// Refunds
// ==========================================================================

/**
 * A full refund moves the gift to Closed Lost. A partial refund leaves the
 * amount as posted and adds a Task so staff can adjust it.
 */
export async function recordRefund(
  env: SalesforceEnv,
  refund: { stripeId: string; refundedCents: number; fullyRefunded: boolean; date: string }
): Promise<void> {
  const opp = await findOpportunityByStripeId(env, refund.stripeId);
  if (!opp) return;

  const note = `Refunded $${toDollars(refund.refundedCents).toFixed(2)} in Stripe on ${refund.date}.`;

  if (refund.fullyRefunded) {
    if (opp.StageName === 'Closed Lost') return;
    await sfRequest(env, 'PATCH', `/sobjects/Opportunity/${opp.Id}`, {
      StageName: 'Closed Lost',
      Description: [opp.Description, note].filter(Boolean).join('\n'),
    });
    return;
  }

  await sfRequest(env, 'POST', '/sobjects/Task', {
    WhatId: opp.Id,
    Subject: 'Partial refund in Stripe: adjust this donation',
    Description: note,
    Status: 'Not Started',
    Priority: 'Normal',
    ActivityDate: refund.date,
    ...ownerFields(env),
  });
}
