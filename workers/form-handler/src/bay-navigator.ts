/**
 * JSON form endpoints for baynavigator.org, which posts JSON with fetch and
 * reads a { success, message | errors } reply. These replace the
 * feedback-form and partnership-form Azure Functions.
 *
 *   POST /baynavigator/feedback     Bug reports, feature requests, feedback (email only)
 *   POST /baynavigator/partnership  Partnership inquiries (email, plus a Lead in Salesforce)
 */

import { createLead, createTask, findOpenLead, splitName } from '../../shared/salesforce';
import type { SalesforceEnv } from '../../shared/salesforce';

export const BAY_NAVIGATOR_ROUTES = ['/baynavigator/feedback', '/baynavigator/partnership'];

const ALLOWED_ORIGINS = [
  'https://baynavigator.org',
  'https://www.baynavigator.org',
  'http://localhost:4321',
];

export interface BayNavigatorDeps {
  isRateLimited: (ip: string) => Promise<boolean>;
  sendEmail: (options: {
    to: string;
    toName?: string;
    replyTo?: string;
    subject: string;
    body: string;
  }) => Promise<unknown>;
  staffEmail: string;
}

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':
      origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

function text(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// ==========================================================================
// Feedback
// ==========================================================================

const FEEDBACK_LABELS: Record<string, string> = {
  bug: 'Bug Report',
  feature: 'Feature Request',
};

async function handleFeedback(
  body: Record<string, unknown>,
  origin: string | null,
  ip: string,
  deps: BayNavigatorDeps
): Promise<Response> {
  const type = text(body, 'type', 50);
  const name = text(body, 'name', 100);
  const email = text(body, 'email', 254);
  const subject = text(body, 'subject', 200);
  const message = text(body, 'message', 5000);
  const platform = text(body, 'platform', 50);
  const url = text(body, 'url', 500);

  const errors: string[] = [];
  if (!type) errors.push('Feedback type is required');
  if (!name) errors.push('Name is required');
  if (!email) errors.push('Email is required');
  else if (!isValidEmail(email)) errors.push('Invalid email format');
  if (!subject) errors.push('Subject is required');
  if (!message) errors.push('Message is required');
  if (errors.length > 0) return json(origin, 400, { success: false, errors });

  const label = FEEDBACK_LABELS[type] ?? 'General Feedback';
  await deps.sendEmail({
    to: deps.staffEmail,
    toName: 'Bay Navigator',
    replyTo: email,
    subject: `[${label}] ${subject}`,
    body: [
      label,
      '='.repeat(label.length),
      `Subject: ${subject}`,
      `From: ${name} <${email}>`,
      platform && `Platform: ${platform}`,
      url && `Page URL: ${url}`,
      '',
      'Message',
      '-------',
      message,
      '',
      '---',
      'Submitted via the Bay Navigator feedback form',
      `IP: ${ip} | ${new Date().toISOString()}`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  });

  return json(origin, 200, {
    success: true,
    message: 'Thank you! Your feedback has been submitted.',
  });
}

// ==========================================================================
// Partnership inquiries
// ==========================================================================

async function recordPartnershipLead(
  env: SalesforceEnv,
  inquiry: {
    orgName: string;
    orgUrl: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    details: string;
  }
): Promise<void> {
  const description = `Bay Navigator partnership inquiry\n\n${inquiry.details}`;

  // A repeat inquiry adds to the open Lead instead of creating a duplicate.
  const existingLeadId = await findOpenLead(env, inquiry.contactEmail);
  if (existingLeadId) {
    await createTask(
      env,
      existingLeadId,
      `Repeat Bay Navigator partnership inquiry: ${inquiry.orgName}`,
      description
    );
    return;
  }

  await createLead(env, {
    ...splitName(inquiry.contactName),
    Email: inquiry.contactEmail,
    Phone: inquiry.contactPhone,
    Company: inquiry.orgName,
    Website: inquiry.orgUrl,
    Description: description.slice(0, 32000),
  });
}

async function handlePartnership(
  body: Record<string, unknown>,
  origin: string | null,
  env: SalesforceEnv,
  ctx: ExecutionContext,
  deps: BayNavigatorDeps
): Promise<Response> {
  const orgName = text(body, 'orgName', 200);
  const orgUrl = text(body, 'orgUrl', 500);
  const contactName = text(body, 'contactName', 100);
  const contactEmail = text(body, 'contactEmail', 254);
  const contactPhone = text(body, 'contactPhone', 20);
  const orgType = text(body, 'orgType', 50);
  const partnershipType = text(body, 'partnershipType', 50);
  const message = text(body, 'message', 2000);

  const errors: string[] = [];
  if (!orgName) errors.push('Organization name is required');
  if (!orgUrl) errors.push('Organization URL is required');
  else if (!isValidUrl(orgUrl)) errors.push('Invalid organization URL');
  if (!contactName) errors.push('Contact name is required');
  if (!contactEmail) errors.push('Contact email is required');
  else if (!isValidEmail(contactEmail)) errors.push('Invalid email format');
  if (!orgType) errors.push('Organization type is required');
  if (!partnershipType) errors.push('Partnership type is required');
  if (!message) errors.push('Message is required');
  if (errors.length > 0) return json(origin, 400, { success: false, errors });

  const details = [
    `Organization: ${orgName}`,
    `Website: ${orgUrl}`,
    `Organization type: ${orgType}`,
    `Partnership type: ${partnershipType}`,
    `Contact: ${contactName} <${contactEmail}>${contactPhone ? `, ${contactPhone}` : ''}`,
    '',
    message,
  ].join('\n');

  await deps.sendEmail({
    to: deps.staffEmail,
    toName: 'Bay Navigator',
    replyTo: contactEmail,
    subject: `Partnership Inquiry: ${orgName}`,
    body: `${details}\n\n---\nSubmitted via the Bay Navigator partnership form\n${new Date().toISOString()}`,
  });

  if (env.SF_INSTANCE_URL && env.SF_CLIENT_ID && env.SF_CLIENT_SECRET) {
    ctx.waitUntil(
      recordPartnershipLead(env, {
        orgName,
        orgUrl,
        contactName,
        contactEmail,
        contactPhone,
        details,
      }).catch((error) =>
        console.error('Salesforce sync failed for Bay Navigator partnership:', error)
      )
    );
  }

  return json(origin, 200, {
    success: true,
    message: 'Thank you! Your partnership inquiry has been submitted.',
  });
}

// ==========================================================================
// Entry point
// ==========================================================================

export async function handleBayNavigator(
  request: Request,
  env: SalesforceEnv,
  ctx: ExecutionContext,
  deps: BayNavigatorDeps
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const path = new URL(request.url).pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== 'POST') {
    return json(origin, 405, { success: false, error: 'Method not allowed' });
  }
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return json(origin, 403, { success: false, error: 'Forbidden' });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await deps.isRateLimited(ip)) {
    return json(origin, 429, {
      success: false,
      error: 'Too many submissions. Please try again later.',
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(origin, 400, { success: false, error: 'Invalid request body' });
  }

  try {
    return path === '/baynavigator/feedback'
      ? await handleFeedback(body, origin, ip, deps)
      : await handlePartnership(body, origin, env, ctx, deps);
  } catch (error) {
    console.error(`Bay Navigator form failed (${path}):`, error);
    return json(origin, 500, {
      success: false,
      error: 'Something went wrong. Please try again or email info@baytides.org.',
    });
  }
}
