/**
 * Bay Tides Donation Handler Worker
 * Creates Stripe Checkout Sessions with full metadata for Salesforce integration
 * Handles one-time and recurring donations with tribute/anonymous options
 */

// ==========================================================================
// Types
// ==========================================================================

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ALLOWED_ORIGIN: string;
  SUCCESS_URL: string;
  CANCEL_URL: string;
}

interface DonationData {
  amount: number;
  frequency: 'one-time' | 'monthly';
  fund: string;
  tributeType?: 'none' | 'in_honor' | 'in_memory';
  tributeName?: string;
  anonymous: boolean;
  donorEmail?: string;
  donorName?: string;
}

interface StripeCheckoutSession {
  id: string;
  url: string;
}

interface StripePrice {
  id: string;
}

// ==========================================================================
// CORS Helpers
// ==========================================================================

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  const allowed = [
    env.ALLOWED_ORIGIN,
    'https://baytides-website.pages.dev',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  return allowed.some((a) => origin?.startsWith(a) || origin?.includes('baytides'));
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowedOrigin = isAllowedOrigin(origin, env) ? origin! : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleCORS(origin: string | null, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, env),
  });
}

// ==========================================================================
// Stripe API Helpers
// ==========================================================================

async function createStripePrice(env: Env, amount: number, recurring: boolean): Promise<string> {
  const params = new URLSearchParams({
    unit_amount: (amount * 100).toString(), // Convert to cents
    currency: 'usd',
    'product_data[name]': 'Donation to Bay Tides',
  });

  if (recurring) {
    params.append('recurring[interval]', 'month');
  }

  const response = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe price creation error:', error);
    throw new Error('Failed to create price');
  }

  const price = await response.json<StripePrice>();
  return price.id;
}

async function createCheckoutSession(env: Env, data: DonationData): Promise<StripeCheckoutSession> {
  // Create a price for this donation
  const priceId = await createStripePrice(env, data.amount, data.frequency === 'monthly');

  // Build metadata for Salesforce webhook
  const metadata: Record<string, string> = {
    fund: data.fund,
    anonymous: data.anonymous.toString(),
    source: 'website',
  };

  if (data.tributeType && data.tributeType !== 'none') {
    metadata.tribute_type = data.tributeType;
    if (data.tributeName) {
      metadata.tribute_name = data.tributeName;
    }
  }

  // Build checkout session params
  const params = new URLSearchParams({
    mode: data.frequency === 'monthly' ? 'subscription' : 'payment',
    success_url: `${env.SUCCESS_URL}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: env.CANCEL_URL,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    billing_address_collection: 'required',
    submit_type: data.frequency === 'monthly' ? undefined : 'donate',
  });

  // Add metadata
  Object.entries(metadata).forEach(([key, value]) => {
    params.append(`metadata[${key}]`, value);
    // Also add to payment intent metadata for one-time donations
    if (data.frequency === 'one-time') {
      params.append(`payment_intent_data[metadata][${key}]`, value);
    }
    // Add to subscription metadata for recurring
    if (data.frequency === 'monthly') {
      params.append(`subscription_data[metadata][${key}]`, value);
    }
  });

  // Pre-fill email if provided
  if (data.donorEmail) {
    params.append('customer_email', data.donorEmail);
  }

  // Remove undefined params
  params.delete('submit_type');
  if (data.frequency === 'one-time') {
    params.set('submit_type', 'donate');
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe checkout session error:', error);
    throw new Error('Failed to create checkout session');
  }

  return response.json<StripeCheckoutSession>();
}

// ==========================================================================
// Request Handlers
// ==========================================================================

async function handleCreateCheckout(
  request: Request,
  env: Env,
  origin: string | null
): Promise<Response> {
  try {
    const body = await request.json<DonationData>();

    // Validate required fields
    if (!body.amount || body.amount < 1) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400,
        headers: { ...corsHeaders(origin, env), 'Content-Type': 'application/json' },
      });
    }

    if (!body.fund) {
      body.fund = 'General Fund';
    }

    if (!body.frequency) {
      body.frequency = 'one-time';
    }

    // Create Stripe Checkout Session
    const session = await createCheckoutSession(env, body);

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { ...corsHeaders(origin, env), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Checkout creation error:', error);
    return new Response(JSON.stringify({ error: 'Failed to create checkout session' }), {
      status: 500,
      headers: { ...corsHeaders(origin, env), 'Content-Type': 'application/json' },
    });
  }
}

// ==========================================================================
// Main Handler
// ==========================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(origin, env);
    }

    // Verify origin
    if (!isAllowedOrigin(origin, env)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Route requests
    if (url.pathname === '/create-checkout' && request.method === 'POST') {
      return handleCreateCheckout(request, env, origin);
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
