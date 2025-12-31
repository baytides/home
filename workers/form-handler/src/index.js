/**
 * Bay Tides Form Handler Worker
 * Handles contact form and newsletter submissions
 * Sends email notifications via Cloudflare Email Workers (MailChannels)
 * Validates Cloudflare Turnstile tokens for spam protection
 */

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

      let emailContent;
      let subject;

      if (formType === 'newsletter') {
        const email = formData.get('email');
        subject = 'New Newsletter Signup - Bay Tides';
        emailContent = `
New newsletter subscription:

Email: ${email}
Date: ${new Date().toISOString()}
        `.trim();
      } else {
        const name = formData.get('name');
        const email = formData.get('email');
        const topic = formData.get('topic') || 'Not specified';
        const message = formData.get('message');

        subject = `New Contact Form Submission - Bay Tides (${topic})`;
        emailContent = `
New contact form submission:

Name: ${name}
Email: ${email}
Topic: ${topic}
Message:
${message}

---
Submitted: ${new Date().toISOString()}
        `.trim();
      }

      // Send email via MailChannels (free for Cloudflare Workers)
      await sendEmail(env, subject, emailContent, formData.get('email'));

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
