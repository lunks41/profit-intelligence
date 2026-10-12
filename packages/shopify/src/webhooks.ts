import { createHmac, timingSafeEqual } from 'node:crypto';
import { SHOP_DOMAIN_RE } from './auth.js';

/**
 * Verifies X-Shopify-Hmac-Sha256: base64 HMAC-SHA256 of the RAW request body with the app secret.
 * Must be computed over the exact bytes received (not re-serialised JSON).
 */
export function verifyWebhookHmac(
  rawBody: Buffer | string,
  headerValue: string | undefined,
  secret: string,
): boolean {
  if (!headerValue || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(headerValue, 'base64');
  } catch {
    return false;
  }
  // timingSafeEqual requires equal lengths; a length mismatch is simply a failed check.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export const COMPLIANCE_TOPICS = [
  'customers/data_request',
  'customers/redact',
  'shop/redact',
] as const;

export const WEBHOOK_TOPICS = {
  orderChanged: [
    'orders/create',
    'orders/updated',
    'orders/cancelled',
    'orders/edited',
    'orders/paid',
  ],
  orderDeleted: ['orders/delete'],
  refund: ['refunds/create'],
  productChanged: ['products/create', 'products/update'],
  productDeleted: ['products/delete'],
  inventoryItem: ['inventory_items/update'],
  shopUpdated: ['shop/update'],
  subscriptionChanged: ['app_subscriptions/update'],
  uninstalled: ['app/uninstalled'],
  compliance: [...COMPLIANCE_TOPICS],
} as const;

export interface WebhookHeaders {
  topic: string;
  shopDomain: string;
  webhookId: string;
  triggeredAt: Date | null;
}

type HeaderBag = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads and validates the headers Shopify sends. Returns null if anything required is bad. */
export function parseWebhookHeaders(headers: HeaderBag): WebhookHeaders | null {
  const topic = one(headers['x-shopify-topic']);
  const shop = one(headers['x-shopify-shop-domain'])?.toLowerCase();
  const webhookId = one(headers['x-shopify-webhook-id']);
  if (!topic || !shop || !webhookId) return null;
  if (!/^[a-z_]+\/[a-z_]+$/.test(topic)) return null;
  if (!SHOP_DOMAIN_RE.test(shop)) return null;
  if (webhookId.length > 100) return null;
  const triggered = one(headers['x-shopify-triggered-at']);
  const at = triggered ? new Date(triggered) : null;
  return {
    topic,
    shopDomain: shop,
    webhookId,
    triggeredAt: at && !Number.isNaN(at.getTime()) ? at : null,
  };
}

/**
 * The id of the resource a webhook is about. We only ever need the id: the handler re-fetches the
 * current state from Shopify, which also makes out-of-order delivery harmless.
 */
export function extractResourceId(topic: string, payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  // a customer request names the customer, not an order
  const customer = (p.customer ?? {}) as Record<string, unknown>;
  const raw =
    topic === 'refunds/create'
      ? (p.order_id ?? p.order_admin_graphql_api_id)
      : topic === 'customers/redact' || topic === 'customers/data_request'
        ? (customer.id ?? customer.admin_graphql_api_id)
        : (p.id ?? p.admin_graphql_api_id);
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const m = /(\d+)$/.exec(raw);
    if (m) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n) && n > 0) return n;
    }
  }
  return null;
}
