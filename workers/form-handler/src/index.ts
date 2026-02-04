/**
 * Bay Tides Form Handler Worker
 * Handles contact form and newsletter submissions
 * Sends email notifications via MailChannels
 * Adds newsletter subscribers to MailerLite
 * Validates Cloudflare Turnstile tokens for spam protection
 * Includes persistent rate limiting via Cloudflare KV
 */

// ==========================================================================
// Types
// ==========================================================================

interface Env {
  RATE_LIMIT_KV: KVNamespace;
  ALLOWED_ORIGIN: string;
  TO_EMAIL: string;
  LEGAL_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  MAILERLITE_API_KEY?: string;
  MAILERLITE_GROUP_ID?: string;
  RESEND_API_KEY: string;
}

interface RateLimitRecord {
  count: number;
}

interface InMemoryRateLimitRecord {
  count: number;
  resetAt: number;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

interface EmailVerificationResponse {
  email: string;
  valid: boolean;
  deliverable: string;
  disposable: boolean;
  suggestion?: string;
  error?: string;
}

// ==========================================================================
// Rate Limiting Configuration
// ==========================================================================

const RATE_LIMIT = {
  maxRequests: 5,
  windowSeconds: 60,
} as const;

// In-memory fallback (resets on worker restart)
const rateLimitMap = new Map<string, InMemoryRateLimitRecord>();

// ==========================================================================
// Rate Limiting Functions
// ==========================================================================

async function isRateLimited(ip: string, env: Env): Promise<boolean> {
  if (env.RATE_LIMIT_KV) {
    const key = `rate:${ip}`;
    const record = await env.RATE_LIMIT_KV.get<RateLimitRecord>(key, { type: 'json' });

    if (!record) {
      await env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: 1 }), {
        expirationTtl: RATE_LIMIT.windowSeconds,
      });
      return false;
    }

    if (record.count >= RATE_LIMIT.maxRequests) {
      return true;
    }

    await env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: record.count + 1 }), {
      expirationTtl: RATE_LIMIT.windowSeconds,
    });
    return false;
  }

  return isRateLimitedInMemory(ip);
}

function isRateLimitedInMemory(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowSeconds * 1000 });
    return false;
  }

  if (now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowSeconds * 1000 });
    return false;
  }

  if (record.count >= RATE_LIMIT.maxRequests) {
    return true;
  }

  record.count++;
  return false;
}

function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

// ==========================================================================
// CORS Helpers
// ==========================================================================

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  const allowed = [
    env.ALLOWED_ORIGIN,
    'https://baytides-website.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  return allowed.some((a) => origin?.startsWith(a) || origin?.includes('baytides'));
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleCORS(env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env),
  });
}

// ==========================================================================
// Turnstile Verification
// ==========================================================================

async function verifyTurnstile(
  token: string,
  secretKey: string,
  ip: string | null
): Promise<boolean> {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: secretKey,
      response: token,
      remoteip: ip,
    }),
  });
  const result = await response.json<TurnstileResponse>();
  return result.success === true;
}

// ==========================================================================
// Email Verification
// ==========================================================================

async function verifyEmail(email: string): Promise<EmailVerificationResponse | null> {
  try {
    const response = await fetch(
      `https://verify.baytides.org/v1/${encodeURIComponent(email)}/verification`,
      { method: 'GET' }
    );

    if (!response.ok) {
      console.error('Email verification API error:', response.status);
      return null; // Don't block on verification failures
    }

    return await response.json<EmailVerificationResponse>();
  } catch (error) {
    console.error('Email verification error:', error);
    return null; // Don't block on network errors
  }
}

// ==========================================================================
// MailerLite Integration
// ==========================================================================

async function addToMailerLite(
  env: Env,
  email: string,
  groupId?: string | null
): Promise<Response> {
  const apiKey = env.MAILERLITE_API_KEY;

  const subscriberData: { email: string; groups?: string[] } = {
    email: email,
  };

  if (groupId || env.MAILERLITE_GROUP_ID) {
    subscriberData.groups = [groupId || env.MAILERLITE_GROUP_ID!];
  }

  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(subscriberData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('MailerLite error:', errorText);
  }

  return response;
}

// ==========================================================================
// Email Sending
// ==========================================================================

interface EmailOptions {
  to: string;
  toName?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  body: string;
  htmlBody?: string;
}

async function sendEmail(
  env: Env,
  subject: string,
  body: string,
  replyTo?: string
): Promise<Response> {
  const toEmail = env.TO_EMAIL || 'admin@baytides.org';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Bay Tides Website <noreply@baytides.org>',
      to: [toEmail],
      reply_to: replyTo || undefined,
      subject: subject,
      text: body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Resend error:', errorText);
    throw new Error(`Failed to send email: ${response.status}`);
  }

  return response;
}

async function sendEmailAdvanced(env: Env, options: EmailOptions): Promise<Response> {
  interface ResendEmailPayload {
    from: string;
    to: string[];
    bcc?: string[];
    reply_to?: string;
    subject: string;
    text: string;
    html?: string;
  }

  const payload: ResendEmailPayload = {
    from: 'Bay Tides <noreply@baytides.org>',
    to: [options.toName ? `${options.toName} <${options.to}>` : options.to],
    reply_to: options.replyTo || undefined,
    subject: options.subject,
    text: options.body,
  };

  if (options.bcc) {
    payload.bcc = [options.bcc];
  }

  if (options.htmlBody) {
    payload.html = options.htmlBody;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Resend error:', errorText);
    throw new Error(`Failed to send email: ${response.status}`);
  }

  return response;
}

// ==========================================================================
// Availability Formatter
// ==========================================================================

function formatAvailability(slots: string[]): string {
  if (slots.length === 0) return 'Not specified';

  const dayMap: Record<string, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  };

  const timeMap: Record<string, string> = {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
  };

  // Group by day
  const byDay: Record<string, string[]> = {};
  for (const slot of slots) {
    const [day, time] = slot.split('_');
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(timeMap[time] || time);
  }

  // Format output
  const lines: string[] = [];
  for (const [day, times] of Object.entries(byDay)) {
    lines.push(`${dayMap[day] || day}: ${times.join(', ')}`);
  }

  return lines.join('\n');
}

// ==========================================================================
// Redirect Helpers
// ==========================================================================

function redirectWithError(formData: FormData, error: string): Response {
  const redirect =
    (formData.get('redirect') as string | null) || 'https://baytides.org/contact.html';
  const redirectUrl = new URL(redirect);
  redirectUrl.searchParams.set('error', error);
  return Response.redirect(redirectUrl.toString(), 303);
}

// ==========================================================================
// Main Handler
// ==========================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(env);
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Verify origin
    const origin = request.headers.get('Origin');
    if (!isAllowedOrigin(origin, env)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Rate limiting check
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await isRateLimited(clientIP, env)) {
      return new Response('Too many requests. Please try again later.', {
        status: 429,
        headers: {
          ...corsHeaders(env),
          'Retry-After': '60',
        },
      });
    }

    // Clean up old rate limit entries in the background
    ctx.waitUntil(Promise.resolve(cleanupRateLimits()));

    try {
      const formData = await request.formData();

      // Honeypot check - if filled, it's a bot
      if (formData.get('botcheck')) {
        return redirectWithError(formData, 'spam');
      }

      // Verify Turnstile token (if present)
      const turnstileToken = formData.get('cf-turnstile-response') as string | null;
      if (turnstileToken && env.TURNSTILE_SECRET_KEY) {
        const turnstileValid = await verifyTurnstile(
          turnstileToken,
          env.TURNSTILE_SECRET_KEY,
          request.headers.get('CF-Connecting-IP')
        );
        if (!turnstileValid) {
          return redirectWithError(formData, 'captcha');
        }
      }

      const formType = (formData.get('form_type') as string | null) || 'contact';
      const email = formData.get('email') as string;

      // Verify email address
      if (email) {
        const emailVerification = await verifyEmail(email);
        if (emailVerification) {
          // Block disposable emails
          if (emailVerification.disposable) {
            return redirectWithError(formData, 'disposable_email');
          }
          // Block clearly invalid/undeliverable emails
          if (emailVerification.deliverable === 'no') {
            return redirectWithError(formData, 'invalid_email');
          }
        }
      }

      if (formType === 'newsletter') {
        // Add subscriber to MailerLite
        if (env.MAILERLITE_API_KEY) {
          await addToMailerLite(env, email);
        }

        // Also send notification email
        const subject = 'New Newsletter Signup - Bay Tides';
        const emailContent = `
New newsletter subscription:

Email: ${email}
Date: ${new Date().toISOString()}
        `.trim();
        await sendEmail(env, subject, emailContent, email);
      } else if (formType === 'aegis_interest') {
        // Aegis Initiative interest form
        const name = formData.get('name') as string;
        const serviceStatus = (formData.get('service_status') as string | null) || 'Not specified';
        const branch = (formData.get('branch') as string | null) || 'Not specified';
        const skills = (formData.get('skills') as string | null) || 'Not provided';
        const interests = formData.get('interests') as string;
        const availability = (formData.get('availability') as string | null) || 'Not specified';
        const referral = (formData.get('referral') as string | null) || 'Not specified';

        const subject = `New Aegis Initiative Interest - ${name}`;
        const emailContent = `
New Aegis Initiative interest form submission:

=== CONTACT INFO ===
Name: ${name}
Email: ${email}

=== SERVICE BACKGROUND ===
Service Status: ${serviceStatus}
Branch: ${branch}

=== INTERESTS & AVAILABILITY ===
Skills & Experience:
${skills}

What interests them:
${interests}

Availability: ${availability}

=== REFERRAL ===
How they heard about Aegis: ${referral}

---
Submitted: ${new Date().toISOString()}
        `.trim();

        await sendEmail(env, subject, emailContent, email);
      } else if (formType === 'volunteer') {
        // Volunteer registration form
        const firstName = formData.get('first_name') as string;
        const lastName = formData.get('last_name') as string;
        const phone = formData.get('phone') as string;
        const dob = formData.get('date_of_birth') as string;
        const isMinor = formData.get('is_minor') === 'true';
        const address = (formData.get('address') as string | null) || 'Not provided';
        const city = (formData.get('city') as string | null) || '';
        const state = (formData.get('state') as string | null) || '';
        const zip = (formData.get('zip') as string | null) || '';
        const emergencyName = formData.get('emergency_name') as string;
        const emergencyPhone = formData.get('emergency_phone') as string;
        const emergencyRelationship =
          (formData.get('emergency_relationship') as string | null) || 'Not specified';
        const interestsRaw = formData.getAll('interests[]');
        const otherInterest = (formData.get('other_interest') as string | null) || '';
        const interests =
          interestsRaw.length > 0
            ? interestsRaw
                .map((i) => (i === 'other' && otherInterest ? `Other: ${otherInterest}` : i))
                .join(', ')
            : 'None selected';
        // Combine desktop and mobile availability (only one will be submitted based on screen size)
        const availabilityRaw = formData.getAll('availability[]');
        const availabilityMobileRaw = formData.getAll('availability_mobile[]');
        const combinedAvailability = [...availabilityRaw, ...availabilityMobileRaw];
        const availability = formatAvailability(combinedAvailability as string[]);
        const frequency = (formData.get('frequency') as string | null) || 'Not specified';
        const experience = (formData.get('experience') as string | null) || 'Not provided';
        const referral = (formData.get('referral') as string | null) || 'Not specified';
        const message = (formData.get('message') as string | null) || '';
        const needsAccommodations = formData.get('needs_accommodations') === 'on';
        const accommodations = (formData.get('accommodations') as string | null) || '';

        // Volunteer hours tracking
        const needsHours = formData.get('needs_hours') === 'yes';
        const hoursCategory = (formData.get('hours_category') as string | null) || '';
        const hoursSubcategory = (formData.get('hours_subcategory') as string | null) || '';
        const hoursCategoryOther = (formData.get('hours_category_other') as string | null) || '';
        const legalNature = (formData.get('legal_nature') as string | null) || '';
        const hoursOrganization = (formData.get('hours_organization') as string | null) || '';
        const hoursContactName = (formData.get('hours_contact_name') as string | null) || '';
        const hoursContactEmail = (formData.get('hours_contact_email') as string | null) || '';
        const hoursContactPhone = (formData.get('hours_contact_phone') as string | null) || '';
        const hoursRequired = (formData.get('hours_required') as string | null) || '';
        const hoursDeadline = (formData.get('hours_deadline') as string | null) || '';
        const hoursNotes = (formData.get('hours_notes') as string | null) || '';

        // Check if it's a legal/court requirement
        const isLegalRequirement = ['legal_court', 'rehabilitation'].includes(hoursCategory);

        const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
        const submittedDate = new Date().toISOString();

        // Email to Bay Tides staff with BCC to legal
        const staffSubject = `New Volunteer Registration - ${firstName} ${lastName}`;
        const staffEmailContent = `
New volunteer registration received:

=== PERSONAL INFORMATION ===
Name: ${firstName} ${lastName}
Email: ${email}
Phone: ${phone}
Date of Birth: ${dob}${isMinor ? ' (Minor - under 18)' : ''}
Address: ${fullAddress}

=== EMERGENCY CONTACT ===
Name: ${emergencyName}
Phone: ${emergencyPhone}
Relationship: ${emergencyRelationship}

=== VOLUNTEER INTERESTS ===
Areas of Interest: ${interests}
Availability: ${availability}
Frequency: ${frequency}

=== EXPERIENCE & BACKGROUND ===
${experience}

Referral Source: ${referral}

Additional Comments:
${message || 'None'}
${
  needsAccommodations
    ? `
=== ACCOMMODATIONS REQUESTED ===
⚠️ This volunteer has requested accommodations (5 business days notice required):

${accommodations}

Please contact them to discuss and confirm arrangements.
`
    : ''
}${
          needsHours
            ? `
=== VOLUNTEER HOURS TRACKING ===
${isLegalRequirement ? '⚠️ LEGAL/COURT REQUIREMENT - Review placement carefully\n' : ''}
Category: ${hoursCategory}${hoursSubcategory ? ` - ${hoursSubcategory}` : ''}${hoursCategoryOther ? ` (${hoursCategoryOther})` : ''}
${isLegalRequirement && legalNature ? `Nature of Requirement: ${legalNature}\n` : ''}
Organization: ${hoursOrganization || 'Not provided'}
Contact: ${hoursContactName || 'Not provided'}${hoursContactEmail ? ` (${hoursContactEmail})` : ''}${hoursContactPhone ? ` - ${hoursContactPhone}` : ''}
Hours Required: ${hoursRequired || 'Not specified'}
Deadline: ${hoursDeadline || 'Not specified'}
${hoursNotes ? `Notes: ${hoursNotes}` : ''}
`
            : ''
        }
=== AGREEMENTS ===
Terms & Conditions: Accepted
Privacy Policy: Accepted
${isMinor ? 'Minor Participant: Yes (parent/guardian signature required for waiver)' : ''}
Waiver Status: Pending - volunteer directed to complete online

---
Submitted: ${submittedDate}
        `.trim();

        await sendEmailAdvanced(env, {
          to: env.TO_EMAIL || 'volunteer@baytides.org',
          toName: 'Bay Tides Volunteer Coordinator',
          bcc: env.LEGAL_EMAIL || 'legal@baytides.org',
          replyTo: email,
          subject: staffSubject,
          body: staffEmailContent,
        });

        // Confirmation email to volunteer
        const volunteerSubject = 'Welcome to Bay Tides Volunteer Program!';
        const volunteerEmailContent = `
Dear ${firstName},

Thank you for registering as a volunteer with Bay Tides! We're excited to have you join our community of environmental stewards dedicated to protecting the San Francisco Bay.

=== YOUR REGISTRATION DETAILS ===

Name: ${firstName} ${lastName}
Email: ${email}
Phone: ${phone}

Areas of Interest: ${interests}
Availability: ${availability}
Preferred Frequency: ${frequency}

Emergency Contact: ${emergencyName} (${emergencyPhone})
${
  needsAccommodations
    ? `
=== ACCOMMODATIONS ===

We have received your accommodation request. A member of our team will contact you within 5 business days to discuss your needs and confirm arrangements.

Your request:
${accommodations}
`
    : ''
}${
          needsHours
            ? `
=== VOLUNTEER HOURS TRACKING ===

We've recorded your volunteer hours requirement. We'll provide verification letters upon request after you complete volunteer activities.

Organization: ${hoursOrganization || 'Not specified'}
Hours Required: ${hoursRequired || 'Not specified'}
Deadline: ${hoursDeadline || 'Not specified'}

Please allow 5-7 business days for processing verification requests.
`
            : ''
        }
=== NEXT STEP: SIGN YOUR LIABILITY WAIVER ===

A liability waiver is required before you can participate in any volunteer activities.

Complete your waiver online at: https://baytides.org/volunteer/waiver
${
  isMinor
    ? `
Since you are under 18, a parent or guardian will need to sign the waiver on your behalf.`
    : ''
}
You can also complete the waiver at your first volunteer event if you prefer to do it in person.
=== WHAT'S NEXT? ===

1. Watch your inbox for upcoming volunteer opportunities
2. Follow us on social media for event announcements
3. Check our website for the latest news: https://baytides.org

If you have any questions, feel free to reply to this email or contact us at volunteer@baytides.org.

Thank you for your commitment to protecting our bay!

Warm regards,
The Bay Tides Team

---
Bay Tides
https://baytides.org
        `.trim();

        await sendEmailAdvanced(env, {
          to: email,
          toName: `${firstName} ${lastName}`,
          subject: volunteerSubject,
          body: volunteerEmailContent,
        });
      } else if (formType === 'waiver') {
        // Liability waiver form
        const firstName = formData.get('first_name') as string;
        const lastName = formData.get('last_name') as string;
        const phone = formData.get('phone') as string;
        const dob = formData.get('date_of_birth') as string;
        const address = (formData.get('address') as string | null) || 'Not provided';
        const emergencyName = formData.get('emergency_name') as string;
        const emergencyPhone = formData.get('emergency_phone') as string;
        const emergencyRelationship = formData.get('emergency_relationship') as string;
        const medicalInfo = (formData.get('medical_info') as string | null) || 'None disclosed';
        const signature = formData.get('signature') as string;
        const signatureDate = formData.get('signature_date') as string;
        const minorName = (formData.get('minor_name') as string | null) || '';
        const minorDob = (formData.get('minor_dob') as string | null) || '';

        const submittedDate = new Date().toISOString();
        const isMinorWaiver = minorName && minorDob;

        // Email to Bay Tides staff with BCC to legal
        const staffSubject = `Liability Waiver Signed - ${firstName} ${lastName}${isMinorWaiver ? ` (for minor: ${minorName})` : ''}`;
        const staffEmailContent = `
Liability waiver received:

=== PARTICIPANT INFORMATION ===
Name: ${firstName} ${lastName}
Email: ${email}
Phone: ${phone}
Date of Birth: ${dob}
Address: ${address}

=== EMERGENCY CONTACT ===
Name: ${emergencyName}
Phone: ${emergencyPhone}
Relationship: ${emergencyRelationship}

=== MEDICAL INFORMATION ===
${medicalInfo}

${
  isMinorWaiver
    ? `
=== MINOR PARTICIPANT ===
Minor's Name: ${minorName}
Minor's Date of Birth: ${minorDob}
Parent/Guardian: ${firstName} ${lastName}
`
    : ''
}
=== SIGNATURE ===
Electronic Signature: ${signature}
Date Signed: ${signatureDate}
IP Address: ${request.headers.get('CF-Connecting-IP') || 'Unknown'}

---
Submitted: ${submittedDate}
        `.trim();

        await sendEmailAdvanced(env, {
          to: env.TO_EMAIL || 'volunteer@baytides.org',
          toName: 'Bay Tides Volunteer Coordinator',
          bcc: env.LEGAL_EMAIL || 'legal@baytides.org',
          replyTo: email,
          subject: staffSubject,
          body: staffEmailContent,
        });

        // Confirmation email to signer with copy of waiver
        const waiverConfirmSubject = 'Bay Tides Liability Waiver - Confirmation';
        const waiverConfirmContent = `
Dear ${firstName},

Thank you for completing the Bay Tides Liability Waiver. This email confirms your submission and serves as your record.

=== WAIVER CONFIRMATION ===

Participant: ${firstName} ${lastName}
Date of Birth: ${dob}
${isMinorWaiver ? `Minor Participant: ${minorName} (DOB: ${minorDob})` : ''}

Electronic Signature: ${signature}
Date Signed: ${signatureDate}

Emergency Contact: ${emergencyName} (${emergencyPhone})

=== SUMMARY OF AGREEMENTS ===

By signing this waiver, you acknowledged:

1. ASSUMPTION OF RISK: You voluntarily assume all risks associated with participation in Bay Tides volunteer activities, including but not limited to personal injury, illness, death, and property damage.

2. RELEASE OF LIABILITY: You released Bay Tides, its officers, directors, employees, volunteers, and agents from any claims arising from your participation.

3. INDEMNIFICATION: You agreed to indemnify and hold harmless Bay Tides from any claims arising from your participation.

4. MEDICAL AUTHORIZATION: You authorized Bay Tides to obtain emergency medical treatment if needed during volunteer activities.

5. PHOTOGRAPHY RELEASE: You granted Bay Tides permission to use photos and videos taken during volunteer activities.

=== WHAT'S NEXT? ===

You're all set to participate in Bay Tides volunteer activities! Watch your inbox for upcoming opportunities.

If you have any questions about the waiver or your participation, please contact us at volunteer@baytides.org.

Thank you for your commitment to protecting the San Francisco Bay!

Warm regards,
The Bay Tides Team

---
Bay Tides
https://baytides.org

This email serves as your official confirmation. Please save it for your records.
        `.trim();

        await sendEmailAdvanced(env, {
          to: email,
          toName: `${firstName} ${lastName}`,
          subject: waiverConfirmSubject,
          body: waiverConfirmContent,
        });
      } else {
        // Contact form
        const name = formData.get('name') as string;
        const topic = (formData.get('topic') as string | null) || 'Not specified';
        const message = formData.get('message') as string;

        const subject = `New Contact Form Submission - Bay Tides (${topic})`;
        const emailContent = `
New contact form submission:

Name: ${name}
Email: ${email}
Topic: ${topic}
Message:
${message}

---
Submitted: ${new Date().toISOString()}
        `.trim();

        await sendEmail(env, subject, emailContent, email);
      }

      // Redirect back to the page with success parameter
      const redirect =
        (formData.get('redirect') as string | null) || 'https://baytides.org/contact.html';
      const redirectUrl = new URL(redirect);
      redirectUrl.searchParams.set(formType === 'newsletter' ? 'subscribed' : 'submitted', 'true');

      return Response.redirect(redirectUrl.toString(), 303);
    } catch (error) {
      console.error('Form submission error:', error);
      return new Response('An error occurred. Please try again.', {
        status: 500,
        headers: corsHeaders(env),
      });
    }
  },
};
