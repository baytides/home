/**
 * Bay Tides Form Handler Worker
 * Handles contact form and newsletter submissions
 * Sends email notifications via MailChannels
 * Adds newsletter subscribers to MailerLite
 * Validates Cloudflare Turnstile tokens for spam protection
 * Includes rate limiting to prevent abuse
 */

// Rate limiting configuration
const RATE_LIMIT = {
  maxRequests: 5, // Max requests per window
  windowMs: 60000, // 1 minute window
};

// Simple in-memory rate limiting (resets on worker restart)
// For production, consider using Cloudflare KV or Durable Objects
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }

  if (now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }

  if (record.count >= RATE_LIMIT.maxRequests) {
    return true;
  }

  record.count++;
  return false;
}

// Clean up old entries periodically
function cleanupRateLimits() {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
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
    if (isRateLimited(clientIP)) {
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
      const turnstileToken = formData.get('cf-turnstile-response');
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

      const formType = formData.get('form_type') || 'contact';
      const email = formData.get('email');

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
      } else {
        // Contact form
        const name = formData.get('name');
        const topic = formData.get('topic') || 'Not specified';
        const message = formData.get('message');

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
      const redirect = formData.get('redirect') || 'https://baytides.org/contact.html';
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

async function addToMailerLite(env, email, groupId = null) {
  const apiKey = env.MAILERLITE_API_KEY;

  const subscriberData = {
    email: email,
  };

  // Add to specific group if provided
  if (groupId || env.MAILERLITE_GROUP_ID) {
    subscriberData.groups = [groupId || env.MAILERLITE_GROUP_ID];
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
    // Don't throw - we still want to complete the form submission
    // even if MailerLite fails
  }

  return response;
}

async function verifyTurnstile(token, secretKey, ip) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: secretKey,
      response: token,
      remoteip: ip,
    }),
  });
  const result = await response.json();
  return result.success === true;
}

function redirectWithError(formData, error) {
  const redirect = formData.get('redirect') || 'https://baytides.org/contact.html';
  const redirectUrl = new URL(redirect);
  redirectUrl.searchParams.set('error', error);
  return Response.redirect(redirectUrl.toString(), 303);
}

function isAllowedOrigin(origin, env) {
  const allowed = [
    env.ALLOWED_ORIGIN,
    'https://baytides-website.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  return allowed.some((a) => origin?.startsWith(a) || origin?.includes('baytides'));
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleCORS(env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env),
  });
}

async function sendEmail(env, subject, body, replyTo) {
  const toEmail = env.TO_EMAIL || 'admin@baytides.org';

  const emailRequest = new Request('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: toEmail, name: 'Bay Tides' }],
        },
      ],
      from: {
        email: 'noreply@baytides.org',
        name: 'Bay Tides Website',
      },
      reply_to: replyTo ? { email: replyTo } : undefined,
      subject: subject,
      content: [
        {
          type: 'text/plain',
          value: body,
        },
      ],
    }),
  });

  const response = await fetch(emailRequest);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('MailChannels error:', errorText);
    throw new Error(`Failed to send email: ${response.status}`);
  }

  return response;
}
