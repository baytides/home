/**
 * Records Stripe donations in NPSP.
 * One-time gifts become a Posted Donation opportunity. A monthly gift creates
 * an Enhanced Recurring Donation on its first payment, and each paid invoice
 * posts that month's installment. Every opportunity stores its Stripe ID in
 * Stripe_Payment_Id__c, so a webhook that Stripe delivers twice is recorded once.
 */

import {
  allocateToFund,
  DEFAULT_FUND,
  findOrCreateOrganization,
  getRecordTypeId,
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
  donor_type?: string;
  organization_name?: string;
}

export interface Donor {
  email: string;
  name?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

// ==========================================================================
// Lookups
// ==========================================================================

function getDonationRecordTypeId(env: SalesforceEnv): Promise<string> {
  return getRecordTypeId(env, 'Opportunity', 'Donation');
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

function organizationName(metadata: DonationMetadata): string | undefined {
  const name = metadata.organization_name?.trim();
  return metadata.donor_type === 'organization' && name ? name : undefined;
}

/**
 * The organization's Account ID when the donor gave on behalf of one. The gift
 * then belongs to that account, and the person who gave stays the primary
 * contact so NPSP soft-credits them.
 */
async function organizationAccountId(
  env: SalesforceEnv,
  metadata: DonationMetadata
): Promise<string | undefined> {
  const name = organizationName(metadata);
  return name ? findOrCreateOrganization(env, name) : undefined;
}

function opportunityName(
  donor: Donor,
  metadata: DonationMetadata,
  amount: number,
  date: string,
  label: string
): string {
  const who = organizationName(metadata) || donor.name?.trim() || donor.email;
  return `${who} $${amount.toFixed(2)} ${label} ${date}`.slice(0, 120);
}

/** Notes for the Description field, such as a fund the form listed as "Other". */
function describeFund(metadata: DonationMetadata): string | undefined {
  const fund = metadata.fund?.trim();
  return fund && fund !== DEFAULT_FUND ? `Designated on the website: ${fund}` : undefined;
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
  const organizationId = await organizationAccountId(env, gift.metadata);
  const amount = toDollars(gift.amountCents);

  const created = await sfRequest<CreateResponse>(env, 'POST', '/sobjects/Opportunity', {
    RecordTypeId: await getDonationRecordTypeId(env),
    Name: opportunityName(gift.donor, gift.metadata, amount, gift.date, 'Donation'),
    ...(organizationId ? { AccountId: organizationId } : {}),
    npsp__Primary_Contact__c: contactId,
    Amount: amount,
    CloseDate: gift.date,
    StageName: 'Posted',
    LeadSource: 'Web',
    Stripe_Payment_Id__c: gift.paymentIntentId,
    Gift_Vehicle__c: 'Online',
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
  const organizationId = await organizationAccountId(env, sub.metadata);
  const day = String(Number(sub.date.slice(8, 10)));

  const created = await sfRequest<CreateResponse>(
    env,
    'POST',
    '/sobjects/npe03__Recurring_Donation__c',
    {
      Name: opportunityName(
        sub.donor,
        sub.metadata,
        toDollars(sub.amountCents),
        sub.date,
        'Monthly'
      ),
      npe03__Contact__c: contactId,
      ...(organizationId ? { npe03__Organization__c: organizationId } : {}),
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
    Gift_Vehicle__c: 'Online',
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

  const [rd] = await query<{ npe03__Contact__c: string; npe03__Organization__c: string | null }>(
    env,
    'SELECT npe03__Contact__c, npe03__Organization__c FROM npe03__Recurring_Donation__c' +
      ` WHERE Id = ${soqlString(rdId)}`
  );
  await sfRequest(env, 'POST', '/sobjects/Opportunity', {
    RecordTypeId: await getDonationRecordTypeId(env),
    Name: opportunityName(
      installment.donor,
      installment.metadata,
      amount,
      installment.date,
      'Monthly Donation'
    ),
    ...(rd.npe03__Organization__c ? { AccountId: rd.npe03__Organization__c } : {}),
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
