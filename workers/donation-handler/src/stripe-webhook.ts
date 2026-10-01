/**
 * Stripe webhook endpoint. Verifies the Stripe-Signature header, then records
 * website donations in Salesforce. Returns 500 when Salesforce fails so Stripe
 * retries the event. Recording is idempotent, so retries never duplicate a gift.
 */

import { isSalesforceConfigured, type SalesforceEnv } from '../../shared/salesforce';
import {
  closeRecurringDonation,
  recordOneTimeGift,
  recordRecurringInstallment,
  recordRefund,
  type DonationMetadata,
  type Donor,
} from './donation-sync';

export interface WebhookEnv extends SalesforceEnv {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

// Stripe's recommended tolerance for the signature timestamp.
const SIGNATURE_TOLERANCE_SECONDS = 300;

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface StripeAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

// ==========================================================================
// Signature verification
// ==========================================================================

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(',').map((p) => p.split('='));
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = hex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
  );
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

// ==========================================================================
// Stripe helpers
// ==========================================================================

async function stripeGet<T>(env: WebhookEnv, path: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`Stripe GET ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json<T>();
}

/** A Unix timestamp as a YYYY-MM-DD date in Bay Area time. */
function bayAreaDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(
    new Date(unixSeconds * 1000)
  );
}

function isWebsiteDonation(metadata: Record<string, string> | undefined): boolean {
  return Boolean(metadata?.source?.startsWith('website'));
}

function donorFrom(
  email: string | null | undefined,
  name: string | null | undefined,
  address: StripeAddress | null | undefined
): Donor | null {
  if (!email) return null;
  return {
    email,
    name: name ?? undefined,
    street: [address?.line1, address?.line2].filter(Boolean).join('\n') || undefined,
    city: address?.city ?? undefined,
    state: address?.state ?? undefined,
    postalCode: address?.postal_code ?? undefined,
  };
}

// ==========================================================================
// Event handlers
// ==========================================================================

async function onPaymentIntentSucceeded(env: WebhookEnv, pi: Record<string, unknown>) {
  const metadata = pi.metadata as Record<string, string>;
  // Monthly gifts carry their metadata on the Subscription and are recorded
  // from invoice.paid, so only one-time website gifts are handled here.
  if (!isWebsiteDonation(metadata)) return;

  const chargeId = pi.latest_charge as string | null;
  const charge = chargeId
    ? await stripeGet<{
        billing_details: { email: string | null; name: string | null; address: StripeAddress };
      }>(env, `charges/${chargeId}`)
    : null;

  const donor = donorFrom(
    charge?.billing_details.email ?? (pi.receipt_email as string | null),
    charge?.billing_details.name ?? metadata.donor_name,
    charge?.billing_details.address
  );
  if (!donor) {
    console.error(`Donation ${pi.id as string} has no donor email; not recorded in Salesforce`);
    return;
  }

  await recordOneTimeGift(env, {
    paymentIntentId: pi.id as string,
    amountCents: pi.amount_received as number,
    date: bayAreaDate(pi.created as number),
    donor,
    metadata: metadata as DonationMetadata,
  });
}

/** The subscription ID moved under invoice.parent in newer Stripe API versions. */
function invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  if (typeof invoice.subscription === 'string') return invoice.subscription;
  const parent = invoice.parent as { subscription_details?: { subscription?: string } } | null;
  return parent?.subscription_details?.subscription ?? null;
}

async function onInvoicePaid(env: WebhookEnv, invoice: Record<string, unknown>) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId || (invoice.amount_paid as number) <= 0) return;

  const subscription = await stripeGet<{ metadata: Record<string, string> }>(
    env,
    `subscriptions/${subscriptionId}`
  );
  if (!isWebsiteDonation(subscription.metadata)) return;

  const donor = donorFrom(
    invoice.customer_email as string | null,
    invoice.customer_name as string | null,
    invoice.customer_address as StripeAddress | null
  );
  if (!donor) {
    console.error(`Invoice ${invoice.id as string} has no donor email; not recorded in Salesforce`);
    return;
  }

  const transitions = invoice.status_transitions as { paid_at?: number | null } | undefined;
  await recordRecurringInstallment(env, {
    subscriptionId,
    invoiceId: invoice.id as string,
    amountCents: invoice.amount_paid as number,
    date: bayAreaDate(transitions?.paid_at ?? (invoice.created as number)),
    donor,
    metadata: subscription.metadata as DonationMetadata,
  });
}

async function onSubscriptionDeleted(env: WebhookEnv, sub: Record<string, unknown>) {
  if (!isWebsiteDonation(sub.metadata as Record<string, string>)) return;
  const details = sub.cancellation_details as { reason?: string | null } | null;
  // Stripe cancels a subscription after failed payments when retries run out.
  const reason = details?.reason === 'payment_failed' ? 'Card Expired' : 'No Longer Interested';
  await closeRecurringDonation(env, sub.id as string, reason);
}

async function onChargeRefunded(env: WebhookEnv, charge: Record<string, unknown>) {
  const paymentIntentId = charge.payment_intent as string | null;
  if (!paymentIntentId) return;
  await recordRefund(env, {
    stripeId: paymentIntentId,
    refundedCents: charge.amount_refunded as number,
    fullyRefunded: charge.refunded === true,
    date: bayAreaDate(Date.now() / 1000),
  });
}

// ==========================================================================
// Entry point
// ==========================================================================

export async function handleStripeWebhook(request: Request, env: WebhookEnv): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get('Stripe-Signature') || '';
  if (!(await verifySignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  const event = JSON.parse(payload) as StripeEvent;
  if (!isSalesforceConfigured(env)) {
    return new Response('Salesforce not configured', { status: 503 });
  }

  try {
    const object = event.data.object;
    switch (event.type) {
      case 'payment_intent.succeeded':
        await onPaymentIntentSucceeded(env, object);
        break;
      case 'invoice.paid':
        await onInvoicePaid(env, object);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(env, object);
        break;
      case 'charge.refunded':
        await onChargeRefunded(env, object);
        break;
    }
  } catch (error) {
    console.error(`Stripe event ${event.id} (${event.type}) failed:`, error);
    return new Response('Recording failed', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
