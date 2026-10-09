import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createDb, createPool, installShop } from '@pi/db';
import type { InstallResult } from '@pi/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';

const SECRET = 'webhook-secret-for-tests';
const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: APP_URL,
  WEB_PORT: 3000,
  API_PORT: 3001,
  WORKER_HEALTH_PORT: 3002,
  SHOPIFY_API_KEY: 'k',
  SHOPIFY_API_SECRET: SECRET,
  SHOPIFY_SCOPES: 'read_orders',
  SHOPIFY_API_VERSION: '2026-10',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_ENCRYPTION_KEY_ID: 'k1',
} as unknown as AppEnv;

const send = vi.fn(async (..._args: unknown[]) => 'job-id');
const fakeBoss = { send, stop: async () => {} };
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 2);

let app: NestFastifyApplication;
let shopA: InstallResult;
let shopB: InstallResult;

const sign = (body: string | Buffer, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('base64');

function post(
  body: string,
  headers: Record<string, string> = {},
  hmac: string | null = sign(body),
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/webhooks',
    headers: {
      'content-type': 'application/json',
      'x-shopify-topic': 'orders/updated',
      'x-shopify-shop-domain': 'wh-a.myshopify.com',
      'x-shopify-webhook-id': 'evt-1',
      ...(hmac ? { 'x-shopify-hmac-sha256': hmac } : {}),
      ...headers,
    },
    payload: body,
  });
}
const events = async () =>
  (await admin.query('select * from o_webhook_event order by received_at')).rows;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .overrideProvider(QUEUE)
    .useValue(fakeBoss)
    .overrideProvider(SHOPIFY_AUTH)
    .useValue({})
    .overrideProvider(SHOPIFY_ADMIN)
    .useValue({})
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue('job-id');
  await admin.query('truncate m_tenant cascade');
  const db = createDb(setupPool);
  const mk = (domain: string) =>
    installShop(db, {
      shopDomain: domain,
      name: domain,
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: 'x',
      keyId: 'k1',
      scopes: 'read_orders',
    });
  shopA = await mk('wh-a.myshopify.com');
  shopB = await mk('wh-b.myshopify.com');
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

describe('POST /api/v1/webhooks', () => {
  it('accepts a correctly signed webhook, records it and queues the work', async () => {
    const res = await post('{"id":4242}');
    expect(res.statusCode).toBe(200);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: shopA.tenantId,
      shop_id: shopA.shopId,
      webhook_id: 'evt-1',
      topic: 'orders/updated',
      status: 'received',
    });
    expect(Number(rows[0].resource_id)).toBe(4242);
    expect(send).toHaveBeenCalledTimes(1);
    const [queue, payload] = send.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(queue).toBe('webhook.process');
    expect(payload).toEqual({
      tenantId: shopA.tenantId,
      shopId: shopA.shopId,
      eventId: rows[0].id,
    });
  });

  it('is idempotent: a redelivered webhook id is acknowledged but not queued again', async () => {
    await post('{"id":1}');
    const again = await post('{"id":1}');
    expect(again.statusCode).toBe(200);
    expect(await events()).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('handles simultaneous deliveries of the same webhook id', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post('{"id":7}')));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(await events()).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('verifies the signature over the exact raw bytes (unicode, odd whitespace)', async () => {
    const body = '{ "id" : 9 ,\n  "note":"café ✓" }';
    expect((await post(body)).statusCode).toBe(200);
  });

  it('rejects a missing, wrong or tampered signature and stores nothing', async () => {
    expect((await post('{"id":1}', {}, null)).statusCode).toBe(401);
    expect((await post('{"id":1}', {}, sign('{"id":1}', 'another-secret'))).statusCode).toBe(401);
    expect((await post('{"id":2}', {}, sign('{"id":1}'))).statusCode).toBe(401); // body changed after signing
    expect(await events()).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed headers even when the signature is valid', async () => {
    expect((await post('{"id":1}', { 'x-shopify-topic': 'not a topic' })).statusCode).toBe(400);
    expect(
      (await post('{"id":1}', { 'x-shopify-shop-domain': 'evil.example.com' })).statusCode,
    ).toBe(400);
    expect(await events()).toHaveLength(0);
  });

  it('acknowledges a webhook for an unknown shop without storing or queueing anything', async () => {
    const res = await post('{"id":1}', { 'x-shopify-shop-domain': 'nobody.myshopify.com' });
    expect(res.statusCode).toBe(200);
    expect(await events()).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('files each shop event under its own tenant', async () => {
    await post('{"id":1}', { 'x-shopify-webhook-id': 'a' });
    await post('{"id":1}', {
      'x-shopify-shop-domain': 'wh-b.myshopify.com',
      'x-shopify-webhook-id': 'b',
    });
    const rows = await events();
    expect(rows.find((r) => r.webhook_id === 'a')?.tenant_id).toBe(shopA.tenantId);
    expect(rows.find((r) => r.webhook_id === 'b')?.tenant_id).toBe(shopB.tenantId);
  });

  it('returns 500 and forgets the event when queueing fails, so the retry is processed', async () => {
    send.mockRejectedValueOnce(new Error('queue down'));
    const first = await post('{"id":1}');
    expect(first.statusCode).toBe(500);
    expect(await events()).toHaveLength(0);

    const retry = await post('{"id":1}');
    expect(retry.statusCode).toBe(200);
    expect(await events()).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('queues compliance topics too (uninstall and privacy requests)', async () => {
    for (const [i, topic] of [
      'app/uninstalled',
      'shop/redact',
      'customers/redact',
      'customers/data_request',
    ].entries()) {
      expect(
        (await post('{}', { 'x-shopify-topic': topic, 'x-shopify-webhook-id': `c${i}` }))
          .statusCode,
      ).toBe(200);
    }
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('does not leak internals in errors', async () => {
    const res = await post('{"id":1}', {}, null);
    expect(res.json()).toEqual({
      error: { code: 'invalid_signature', message: 'Webhook rejected' },
    });
  });
});
