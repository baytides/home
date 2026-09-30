/**
 * Records website form submissions in Salesforce.
 * Runs after the visitor has been redirected, so a Salesforce outage never
 * blocks a form or the notification emails. Failures are logged only.
 */

import {
  addToCampaign,
  attachTextFile,
  createLead,
  createTask,
  findOpenLead,
  isSalesforceConfigured,
  splitName,
  upsertContact,
  upsertHouseholdMember,
  type SalesforceEnv,
} from '../../shared/salesforce';

const CAMPAIGNS = {
  newsletter: 'Newsletter',
  aegis: 'Aegis Initiative Interest',
  volunteer: 'Volunteer Opportunities',
} as const;

function field(formData: FormData, name: string): string {
  return ((formData.get(name) as string | null) || '').trim();
}

function isoDate(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lines of "Label: value", skipping empty values. */
function details(pairs: Array<[string, string | undefined]>): string {
  return pairs
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** Maps day_time slots such as "sat_morning" to V4S availability values. */
function v4sAvailability(slots: string[]): string | undefined {
  const values = new Set<string>();
  for (const slot of slots) {
    const [day, time] = slot.split('_');
    if (['sat', 'sun'].includes(day)) values.add('Weekends');
    else if (day) values.add('Weekdays');
    if (time === 'morning') values.add('Morning');
    if (time === 'afternoon') values.add('Afternoon');
  }
  return values.size > 0 ? [...values].join(';') : undefined;
}

// ==========================================================================
// Per-form handlers
// ==========================================================================

async function syncContactForm(env: SalesforceEnv, formData: FormData): Promise<void> {
  const email = field(formData, 'email');
  const topic = field(formData, 'topic') || 'General';
  const contactId = await upsertContact(env, email, splitName(field(formData, 'name')));
  await createTask(env, contactId, `Website contact form: ${topic}`, field(formData, 'message'));
}

async function syncNewsletter(env: SalesforceEnv, formData: FormData): Promise<void> {
  const contactId = await upsertContact(env, field(formData, 'email'), {});
  await addToCampaign(env, CAMPAIGNS.newsletter, contactId);
}

async function syncAegisInterest(env: SalesforceEnv, formData: FormData): Promise<void> {
  const contactId = await upsertContact(
    env,
    field(formData, 'email'),
    splitName(field(formData, 'name'))
  );
  await addToCampaign(env, CAMPAIGNS.aegis, contactId);
  await createTask(
    env,
    contactId,
    'Aegis Initiative interest form',
    details([
      ['Service status', field(formData, 'service_status')],
      ['Branch', field(formData, 'branch')],
      ['Skills and experience', field(formData, 'skills')],
      ['Interests', field(formData, 'interests')],
      ['Availability', field(formData, 'availability')],
      ['Heard about Aegis from', field(formData, 'referral')],
    ])
  );
}

async function syncVolunteer(env: SalesforceEnv, formData: FormData): Promise<void> {
  const interests = formData
    .getAll('interests[]')
    .map((i) =>
      i === 'other' && field(formData, 'other_interest')
        ? `Other: ${field(formData, 'other_interest')}`
        : String(i)
    );
  const slots = [...formData.getAll('availability[]'), ...formData.getAll('availability_mobile[]')];
  const needsHours = field(formData, 'needs_hours') === 'yes';
  const needsAccommodations = formData.get('needs_accommodations') === 'on';

  const hoursDetails = needsHours
    ? details([
        [
          'Category',
          [
            field(formData, 'hours_category'),
            field(formData, 'hours_subcategory'),
            field(formData, 'hours_category_other'),
          ]
            .filter(Boolean)
            .join(' / '),
        ],
        ['Nature of legal requirement', field(formData, 'legal_nature')],
        ['Organization', field(formData, 'hours_organization')],
        ['Organization contact', field(formData, 'hours_contact_name')],
        ['Contact email', field(formData, 'hours_contact_email')],
        ['Contact phone', field(formData, 'hours_contact_phone')],
        ['Hours required', field(formData, 'hours_required')],
        ['Deadline', field(formData, 'hours_deadline')],
        ['Notes', field(formData, 'hours_notes')],
      ])
    : undefined;

  const contactId = await upsertContact(env, field(formData, 'email'), {
    FirstName: field(formData, 'first_name'),
    LastName: field(formData, 'last_name'),
    Phone: field(formData, 'phone'),
    Birthdate: isoDate(field(formData, 'date_of_birth')),
    MailingStreet: field(formData, 'address'),
    MailingCity: field(formData, 'city'),
    MailingState: field(formData, 'state'),
    MailingPostalCode: field(formData, 'zip'),
    Emergency_Contact_Name__c: field(formData, 'emergency_name'),
    Emergency_Contact_Phone__c: field(formData, 'emergency_phone'),
    Emergency_Contact_Relationship__c: field(formData, 'emergency_relationship'),
    // Volunteer_Last_Web_Signup_Date__c is left unset on purpose. Setting it
    // fires the V4S "Volunteer Signup - Contact" rule, which sends a second
    // welcome email on top of the one this worker sends.
    GW_Volunteers__Volunteer_Status__c: 'New Sign Up',
    GW_Volunteers__Volunteer_Availability__c: v4sAvailability(slots as string[]),
    GW_Volunteers__Volunteer_Organization__c: needsHours
      ? field(formData, 'hours_organization')
      : undefined,
    GW_Volunteers__Volunteer_Notes__c: details([
      ['Interests', interests.join(', ')],
      ['Frequency', field(formData, 'frequency')],
      ['Experience', field(formData, 'experience')],
      ['Heard about us from', field(formData, 'referral')],
      ['Comments', field(formData, 'message')],
    ]),
    Volunteer_Accommodations__c: needsAccommodations
      ? field(formData, 'accommodations')
      : undefined,
    Needs_Service_Hours_Verification__c: needsHours || undefined,
    Service_Hours_Details__c: hoursDetails,
  });

  await addToCampaign(env, CAMPAIGNS.volunteer, contactId);

  if (needsHours || needsAccommodations) {
    await createTask(
      env,
      contactId,
      needsHours
        ? 'Follow up: volunteer service hours requirement'
        : 'Follow up: volunteer accommodation request',
      'Details are in the restricted volunteer fields on this Contact.'
    );
  }
}

async function syncWaiver(env: SalesforceEnv, formData: FormData, ip: string): Promise<void> {
  const signedDate = isoDate(field(formData, 'signature_date')) || today();
  const minorName = field(formData, 'minor_name');
  const minorDob = isoDate(field(formData, 'minor_dob'));

  const waiverFields = {
    Waiver_Signed_Date__c: signedDate,
    Waiver_Signature__c: field(formData, 'signature'),
    Waiver_IP_Address__c: ip,
    Emergency_Contact_Name__c: field(formData, 'emergency_name'),
    Emergency_Contact_Phone__c: field(formData, 'emergency_phone'),
    Emergency_Contact_Relationship__c: field(formData, 'emergency_relationship'),
    Medical_Information__c: field(formData, 'medical_info'),
  };

  const signerFields = {
    FirstName: field(formData, 'first_name'),
    LastName: field(formData, 'last_name'),
    Phone: field(formData, 'phone'),
    Birthdate: isoDate(field(formData, 'date_of_birth')),
    MailingStreet: field(formData, 'address'),
  };

  const record = details([
    ['Signer', `${signerFields.FirstName} ${signerFields.LastName}`],
    ['Email', field(formData, 'email')],
    ['Phone', signerFields.Phone],
    ['Date of birth', signerFields.Birthdate],
    ['Address', signerFields.MailingStreet],
    ['Minor participant', minorName],
    ["Minor's date of birth", minorDob],
    ['Emergency contact', waiverFields.Emergency_Contact_Name__c],
    ['Emergency phone', waiverFields.Emergency_Contact_Phone__c],
    ['Relationship', waiverFields.Emergency_Contact_Relationship__c],
    ['Medical information', waiverFields.Medical_Information__c],
    ['Electronic signature', waiverFields.Waiver_Signature__c],
    ['Date signed', signedDate],
    ['IP address', ip],
    ['Received', new Date().toISOString()],
  ]);
  const title = `Liability waiver ${signedDate}`;

  if (minorName && minorDob) {
    // A parent or guardian signed for a minor. The waiver belongs to the minor.
    // The parent's own medical information field is left untouched.
    const parentId = await upsertContact(env, field(formData, 'email'), signerFields);
    const minor = splitName(minorName);
    const minorId = await upsertHouseholdMember(
      env,
      parentId,
      minor.FirstName || '',
      minor.LastName,
      minorDob,
      waiverFields
    );
    await attachTextFile(env, minorId, title, record);
    await attachTextFile(env, parentId, `${title} (signed for ${minorName})`, record);
    return;
  }

  const contactId = await upsertContact(env, field(formData, 'email'), {
    ...signerFields,
    ...waiverFields,
  });
  await attachTextFile(env, contactId, title, record);
}

async function syncPartnership(
  env: SalesforceEnv,
  formData: FormData,
  quiz: Record<string, unknown>
): Promise<void> {
  const name = splitName(field(formData, 'contact_name'));
  const company = typeof quiz.companyName === 'string' ? quiz.companyName : '';
  const email = field(formData, 'email');

  // A repeat inquiry adds to the open Lead instead of creating a duplicate.
  const existingLeadId = await findOpenLead(env, email);
  if (existingLeadId) {
    await createTask(
      env,
      existingLeadId,
      `Repeat partnership inquiry${company ? `: ${company}` : ''}`,
      formatPartnershipDetails(formData, quiz)
    );
    return;
  }

  await createLead(env, {
    ...name,
    Email: email,
    Phone: field(formData, 'phone'),
    Title: field(formData, 'job_title'),
    Website: field(formData, 'website'),
    Company: company || `${name.LastName} (company not given)`,
    Description: formatPartnershipDetails(formData, quiz).slice(0, 32000),
  });
}

// ==========================================================================
// Shared with the notification email
// ==========================================================================

/** Parses the partnership quiz JSON. Returns an empty object when it is missing or invalid. */
export function parseQuizData(formData: FormData): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(field(formData, 'quiz_data') || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The partnership form's contact preferences and quiz answers as readable lines. */
export function formatPartnershipDetails(
  formData: FormData,
  quiz: Record<string, unknown>
): string {
  const answers = Object.entries(quiz)
    .filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([key, v]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      return `${label}: ${Array.isArray(v) ? v.join(', ') : String(v)}`;
    })
    .join('\n');

  return [
    details([
      ['Preferred contact method', field(formData, 'contact_method')],
      ['Best time to reach', field(formData, 'best_time')],
      ['Heard about us from', field(formData, 'referral_source')],
      ['Notes', field(formData, 'notes')],
    ]),
    answers ? `Partnership questionnaire\n${answers}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ==========================================================================
// Entry point
// ==========================================================================

export async function syncFormToSalesforce(
  env: SalesforceEnv,
  formType: string,
  formData: FormData,
  ip: string
): Promise<void> {
  if (!isSalesforceConfigured(env)) return;

  try {
    switch (formType) {
      case 'newsletter':
        return await syncNewsletter(env, formData);
      case 'aegis_interest':
        return await syncAegisInterest(env, formData);
      case 'volunteer':
        return await syncVolunteer(env, formData);
      case 'waiver':
        return await syncWaiver(env, formData, ip);
      case 'corporate-partnership':
        return await syncPartnership(env, formData, parseQuizData(formData));
      default:
        return await syncContactForm(env, formData);
    }
  } catch (error) {
    console.error(`Salesforce sync failed for ${formType} form:`, error);
  }
}
