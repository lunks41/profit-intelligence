import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractResourceId, parseWebhookHeaders, verifyWebhookHmac } from './webhooks.js';

const SECRET = 'webhook-test-secret';
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('base64');

describe('verifyWebhookHmac', () => {
  const body = '{"id":123,"note":"café ✓"}';

  it('accepts the correct signature over the raw bytes (Buffer or string)', () => {
    expect(verifyWebhookHmac(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookHmac(Buffer.from(body, 'utf8'), sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body, another secret, and re-serialised JSON', () => {
    expect(verifyWebhookHmac(body.replace('123', '124'), sign(body), SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, sign(body, 'other'), SECRET)).toBe(false);
    // same data, different whitespace: the signature is over the exact bytes
    expect(verifyWebhookHmac(JSON.stringify(JSON.parse(body), null, 1), sign(body), SECRET)).toBe(
      false,
    );
  });

  it('rejects missing, empty, malformed and wrong-length signatures without throwing', () => {
    expect(verifyWebhookHmac(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, '', SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, '!!!not base64!!!', SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, 'c2hvcnQ=', SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, sign(body), '')).toBe(false);
  });
});

describe('parseWebhookHeaders', () => {
  const good = {
    'x-shopify-topic': 'orders/updated',
    'x-shopify-shop-domain': 'Shop-A.myshopify.com',
    'x-shopify-webhook-id': 'abc-123',
    'x-shopify-triggered-at': '2026-10-09T10:00:00Z',
  };

  it('parses valid headers and lower-cases the shop', () => {
    expect(parseWebhookHeaders(good)).toEqual({
      topic: 'orders/updated',
      shopDomain: 'shop-a.myshopify.com',
      webhookId: 'abc-123',
      triggeredAt: new Date('2026-10-09T10:00:00Z'),
    });
  });

  it('rejects missing or malformed required headers', () => {
    expect(parseWebhookHeaders({ ...good, 'x-shopify-topic': undefined })).toBeNull();
    expect(
      parseWebhookHeaders({ ...good, 'x-shopify-shop-domain': 'evil.example.com' }),
    ).toBeNull();
    expect(parseWebhookHeaders({ ...good, 'x-shopify-topic': 'ORDERS; DROP' })).toBeNull();
    expect(parseWebhookHeaders({ ...good, 'x-shopify-webhook-id': 'x'.repeat(200) })).toBeNull();
  });

  it('tolerates a missing or invalid triggered-at', () => {
    expect(
      parseWebhookHeaders({ ...good, 'x-shopify-triggered-at': 'garbage' })?.triggeredAt,
    ).toBeNull();
    expect(
      parseWebhookHeaders({ ...good, 'x-shopify-triggered-at': undefined })?.triggeredAt,
    ).toBeNull();
  });
});

describe('extractResourceId', () => {
  it('reads numeric ids and GIDs', () => {
    expect(extractResourceId('orders/updated', { id: 18937535824098 })).toBe(18937535824098);
    expect(
      extractResourceId('orders/updated', { admin_graphql_api_id: 'gid://shopify/Order/42' }),
    ).toBe(42);
    expect(extractResourceId('products/update', { id: 7 })).toBe(7);
  });

  it('uses the order id for refund webhooks', () => {
    expect(extractResourceId('refunds/create', { id: 999, order_id: 55 })).toBe(55);
  });

  it('returns null for missing, non-positive or unsafe ids', () => {
    expect(extractResourceId('orders/updated', {})).toBeNull();
    expect(extractResourceId('orders/updated', { id: -1 })).toBeNull();
    expect(extractResourceId('orders/updated', { id: 1e20 })).toBeNull();
    expect(extractResourceId('orders/updated', null)).toBeNull();
    expect(extractResourceId('orders/updated', 'text')).toBeNull();
  });
});
