/**
 * Salesforce client for the form handler.
 * Signs in with the OAuth 2.0 client credentials flow as the API-only
 * integration user, then writes Contacts, Leads, Tasks, Campaign Members,
 * and files through the REST API. The org uses NPSP, so inserting a Contact
 * without an Account lets NPSP create the household automatically.
 */

export interface SalesforceEnv {
  RATE_LIMIT_KV: KVNamespace;
  SF_INSTANCE_URL?: string;
  SF_CLIENT_ID?: string;
  SF_CLIENT_SECRET?: string;
  /** Staff user who owns new records and receives follow-up Tasks. */
  SF_OWNER_ID?: string;
}

const API_VERSION = 'v65.0';
const TOKEN_CACHE_KEY = 'sf:token';
// Salesforce does not return an expiry for client credentials tokens. The org
// session timeout is at least 2 hours, so 30 minutes stays well inside it.
const TOKEN_CACHE_SECONDS = 1800;

type SObjectFields = Record<string, string | number | boolean | null | undefined>;

interface TokenResponse {
  access_token: string;
  instance_url: string;
}

interface QueryResponse<T> {
  totalSize: number;
  records: T[];
}

interface CreateResponse {
  id: string;
  success: boolean;
}

interface SalesforceError {
  errorCode: string;
  message: string;
}

export class SalesforceRequestError extends Error {
  constructor(
    public status: number,
    public errors: SalesforceError[]
  ) {
    super(`Salesforce ${status}: ${errors.map((e) => `${e.errorCode} ${e.message}`).join('; ')}`);
  }
}

export function isSalesforceConfigured(env: SalesforceEnv): boolean {
  return Boolean(env.SF_INSTANCE_URL && env.SF_CLIENT_ID && env.SF_CLIENT_SECRET);
}

// ==========================================================================
// Auth and transport
// ==========================================================================

async function fetchToken(env: SalesforceEnv): Promise<TokenResponse> {
  const response = await fetch(`${env.SF_INSTANCE_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SF_CLIENT_ID!,
      client_secret: env.SF_CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    throw new Error(`Salesforce token request failed: ${response.status} ${await response.text()}`);
  }

  const token = await response.json<TokenResponse>();
  await env.RATE_LIMIT_KV.put(TOKEN_CACHE_KEY, JSON.stringify(token), {
    expirationTtl: TOKEN_CACHE_SECONDS,
  });
  return token;
}

async function getToken(env: SalesforceEnv, forceRefresh = false): Promise<TokenResponse> {
  if (!forceRefresh) {
    const cached = await env.RATE_LIMIT_KV.get<TokenResponse>(TOKEN_CACHE_KEY, { type: 'json' });
    if (cached) return cached;
  }
  return fetchToken(env);
}

async function sfRequest<T>(
  env: SalesforceEnv,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(env, attempt > 0);
    const response = await fetch(`${token.instance_url}/services/data/${API_VERSION}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // The standard duplicate rules only alert. Without this header the API
        // treats the alert as an error and rejects a repeat submission.
        'Sforce-Duplicate-Rule-Header': 'allowSave=true',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // An expired or revoked session: fetch a fresh token and retry once.
    if (response.status === 401 && attempt === 0) continue;

    if (response.status === 204) return undefined as T;
    if (!response.ok) {
      throw new SalesforceRequestError(response.status, await response.json<SalesforceError[]>());
    }
    return response.json<T>();
  }
  throw new Error('Salesforce request failed after refreshing the token');
}

function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function query<T>(env: SalesforceEnv, soql: string): Promise<T[]> {
  const result = await sfRequest<QueryResponse<T>>(
    env,
    'GET',
    `/query?q=${encodeURIComponent(soql)}`
  );
  return result.records;
}

/** Sets the owner on new records so they are not owned by the integration user. */
function ownerFields(env: SalesforceEnv): SObjectFields {
  return env.SF_OWNER_ID ? { OwnerId: env.SF_OWNER_ID } : {};
}

/** Drops empty values so an update never blanks out data already in Salesforce. */
function withoutEmpty(fields: SObjectFields): SObjectFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

// ==========================================================================
// Records
// ==========================================================================

/**
 * Finds a Contact by email and updates it, or creates one. Matching checks
 * the standard Email field and the NPSP personal email field.
 */
export async function upsertContact(
  env: SalesforceEnv,
  email: string,
  fields: SObjectFields
): Promise<string> {
  const e = soqlString(email.trim().toLowerCase());
  const matches = await query<{ Id: string }>(
    env,
    `SELECT Id FROM Contact WHERE Email = ${e} OR npe01__HomeEmail__c = ${e} ORDER BY CreatedDate LIMIT 1`
  );
  const data = withoutEmpty(fields);

  if (matches.length > 0) {
    const id = matches[0].Id;
    // LastName and LeadSource describe the original record. Do not overwrite them.
    delete data.LastName;
    delete data.LeadSource;
    if (Object.keys(data).length > 0) {
      await sfRequest(env, 'PATCH', `/sobjects/Contact/${id}`, data);
    }
    return id;
  }

  const created = await sfRequest<CreateResponse>(env, 'POST', '/sobjects/Contact', {
    LastName: '(Unknown)',
    Email: email.trim(),
    npe01__HomeEmail__c: email.trim(),
    npe01__Preferred_Email__c: 'Personal',
    LeadSource: 'Web',
    ...ownerFields(env),
    ...data,
  });
  return created.id;
}

/**
 * Finds or creates a Contact without an email address (a minor on a parent's
 * waiver) in the same NPSP household as another Contact. Matching is by name
 * and birthdate within that household.
 */
export async function upsertHouseholdMember(
  env: SalesforceEnv,
  householdContactId: string,
  firstName: string,
  lastName: string,
  birthdate: string,
  fields: SObjectFields
): Promise<string> {
  const [parent] = await query<{ AccountId: string | null }>(
    env,
    `SELECT AccountId FROM Contact WHERE Id = ${soqlString(householdContactId)}`
  );
  const accountId = parent?.AccountId;
  const data = withoutEmpty(fields);

  if (accountId) {
    const matches = await query<{ Id: string }>(
      env,
      `SELECT Id FROM Contact WHERE AccountId = ${soqlString(accountId)}` +
        ` AND FirstName = ${soqlString(firstName)} AND LastName = ${soqlString(lastName)}` +
        ` AND Birthdate = ${birthdate} LIMIT 1`
    );
    if (matches.length > 0) {
      await sfRequest(env, 'PATCH', `/sobjects/Contact/${matches[0].Id}`, data);
      return matches[0].Id;
    }
  }

  const created = await sfRequest<CreateResponse>(env, 'POST', '/sobjects/Contact', {
    FirstName: firstName,
    LastName: lastName,
    Birthdate: birthdate,
    AccountId: accountId ?? undefined,
    LeadSource: 'Web',
    ...ownerFields(env),
    ...data,
  });
  return created.id;
}

const campaignIds = new Map<string, string>();

/**
 * Adds a Contact to a Campaign by name with the campaign's default member
 * status. Adding someone twice is not an error.
 */
export async function addToCampaign(
  env: SalesforceEnv,
  campaignName: string,
  contactId: string
): Promise<void> {
  let campaignId = campaignIds.get(campaignName);
  if (!campaignId) {
    const campaigns = await query<{ Id: string }>(
      env,
      `SELECT Id FROM Campaign WHERE Name = ${soqlString(campaignName)} LIMIT 1`
    );
    if (campaigns.length === 0) {
      throw new Error(`Salesforce campaign not found: ${campaignName}`);
    }
    campaignId = campaigns[0].Id;
    campaignIds.set(campaignName, campaignId);
  }

  try {
    await sfRequest(env, 'POST', '/sobjects/CampaignMember', {
      CampaignId: campaignId,
      ContactId: contactId,
    });
  } catch (error) {
    if (
      error instanceof SalesforceRequestError &&
      error.errors.some((e) => e.errorCode === 'DUPLICATE_VALUE')
    ) {
      return;
    }
    throw error;
  }
}

/** Creates an open Task on a Contact or Lead for the staff owner to act on. */
export async function createTask(
  env: SalesforceEnv,
  whoId: string,
  subject: string,
  description: string
): Promise<void> {
  await sfRequest(env, 'POST', '/sobjects/Task', {
    WhoId: whoId,
    Subject: subject.slice(0, 255),
    Description: description.slice(0, 32000),
    Status: 'Not Started',
    Priority: 'Normal',
    ActivityDate: new Date().toISOString().slice(0, 10),
    ...ownerFields(env),
  });
}

/** Finds an unconverted Lead by email. Returns null when there is none. */
export async function findOpenLead(env: SalesforceEnv, email: string): Promise<string | null> {
  const leads = await query<{ Id: string }>(
    env,
    `SELECT Id FROM Lead WHERE Email = ${soqlString(email.trim().toLowerCase())}` +
      ` AND IsConverted = false ORDER BY CreatedDate DESC LIMIT 1`
  );
  return leads[0]?.Id ?? null;
}

export async function createLead(env: SalesforceEnv, fields: SObjectFields): Promise<string> {
  const created = await sfRequest<CreateResponse>(env, 'POST', '/sobjects/Lead', {
    LeadSource: 'Web',
    Status: 'New',
    ...ownerFields(env),
    ...withoutEmpty(fields),
  });
  return created.id;
}

/** Attaches a plain text file to a record so it appears under its Files list. */
export async function attachTextFile(
  env: SalesforceEnv,
  recordId: string,
  title: string,
  text: string
): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  await sfRequest(env, 'POST', '/sobjects/ContentVersion', {
    Title: title,
    PathOnClient: `${title}.txt`,
    VersionData: btoa(binary),
    FirstPublishLocationId: recordId,
  });
}
