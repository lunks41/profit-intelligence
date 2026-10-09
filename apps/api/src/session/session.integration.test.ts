import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { sessionResponseSchema, syncStatusResponseSchema } from '@pi/contracts';
import { AuthError, createTokenCrypto } from '@pi/shopify';
import type { ShopifyAdmin, ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';
// Test database helpers live in the db package.
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';

const KEY = randomBytes(32).toString('base64');
const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: APP_URL,
  WEB_PORT: 3000,
  API_PORT: 3001,
  WORKER_HEALTH_PORT: 3002,
  SHOPIFY_API_KEY: 'k',
  SHOPIFY_API_SECRET: 's',
  SHOPIFY_SCOPES: 'read_orders',
  SHOPIFY_API_VERSION: '2026-10',
  TOKEN_ENCRYPTION_KEY: KEY,
  TOKEN_ENCRYPTION_KEY_ID: 'k1',
} as unknown as AppEnv;

// Fake Shopify: ID tokens are "id-<shop-subdomain>". Anything else is invalid.
const exchange = vi.fn(async (shop: string) => ({
  accessToken: `shpat_${shop}`,
  scope: 'read_orders',
}));
const fakeAuth: ShopifyAuth = {
  async verifySessionToken(token) {
    const m = /^id-([a-z0-9-]+)$/.exec(token);
    if (!m) throw new AuthError('Invalid session token');
    return { shopDomain: `${m[1]}.myshopify.com`, userId: '1' };
  },
  exchangeOfflineToken: exchange,
};
const fakeAdmin: ShopifyAdmin = {
  async fetchShopInfo(domain) {
    return { name: `Shop ${domain}`, currencyCode: 'USD', ianaTimezone: 'Asia/Dubai' };
  },
};

// Fake queue: the api only enqueues; we assert what it asked for.
const send = vi.fn(async (..._args: unknown[]) => 'job-id');
const fakeBoss = { send, stop: async () => {} };

let app: NestFastifyApplication;
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .overrideProvider(SHOPIFY_AUTH)
    .useValue(fakeAuth)
    .overrideProvider(QUEUE)
    .useValue(fakeBoss)
    .overrideProvider(SHOPIFY_ADMIN)
    .useValue(fakeAdmin)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
beforeEach(async () => {
  exchange.mockClear();
  send.mockReset();
  send.mockResolvedValue('job-id');
  await admin.query('truncate m_tenant cascade');
});
afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('authentication', () => {
  it('keeps /health public', async () => {
    expect((await get('/health')).statusCode).toBe(200);
  });

  it('rejects requests without a token', async () => {
    const res = await get('/api/v1/session');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'missing_token', message: 'Authentication required' },
    });
  });

  it('rejects other auth schemes and malformed tokens', async () => {
    expect((await get('/api/v1/session', { authorization: 'Basic abc' })).statusCode).toBe(401);
    expect((await get('/api/v1/session', { authorization: 'Bearer a b' })).statusCode).toBe(401);
  });

  it('rejects an invalid token without echoing it and creates nothing', async () => {
    const res = await get('/api/v1/session', bearer('forged.token.value'));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_token');
    expect(res.body).not.toContain('forged');
    expect((await admin.query('select 1 from m_shop')).rowCount).toBe(0);
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe('installation on first authenticated request', () => {
  it('creates the tenant, stores an encrypted token and returns the session', async () => {
    const res = await get('/api/v1/session', bearer('id-shop-a'));
    expect(res.statusCode).toBe(200);
    const body = sessionResponseSchema.parse(res.json());
    expect(body.shop).toMatchObject({
      domain: 'shop-a.myshopify.com',
      currency: 'USD',
      timezone: 'Asia/Dubai',
      status: 'active',
    });
    expect(body.onboarding.steps[0]).toMatchObject({ id: 'connected', status: 'done' });
    expect(res.body).not.toContain('shpat_');

    const { rows } = await admin.query(
      'select encrypted_access_token, key_id from s_shop_credential',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].encrypted_access_token).not.toContain('shpat_');
    const crypto = createTokenCrypto({ k1: KEY }, 'k1');
    expect(crypto.decrypt(rows[0].encrypted_access_token)).toBe('shpat_shop-a.myshopify.com');
  });

  it('does not call Shopify again for a known active shop', async () => {
    await get('/api/v1/session', bearer('id-shop-a'));
    await get('/api/v1/session', bearer('id-shop-a'));
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent first requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => get('/api/v1/session', bearer('id-shop-a'))),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect((await admin.query('select 1 from m_tenant')).rowCount).toBe(1);
  });

  it('returns 502 and stores nothing when token exchange fails', async () => {
    exchange.mockRejectedValueOnce(new AuthError('Token exchange failed'));
    const res = await get('/api/v1/session', bearer('id-shop-a'));
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('installation_failed');
    expect((await admin.query('select 1 from m_tenant')).rowCount).toBe(0);
  });
});

describe('tenant isolation through the API', () => {
  it('serves each shop only its own data and ignores client-supplied identifiers', async () => {
    const a = await get('/api/v1/session', bearer('id-shop-a'));
    const b = await get('/api/v1/session', bearer('id-shop-b'));
    expect(a.json().shop.domain).toBe('shop-a.myshopify.com');
    expect(b.json().shop.domain).toBe('shop-b.myshopify.com');

    // Attempts to override identity via headers or query string have no effect.
    const spoofed = await get('/api/v1/session?shop=shop-b.myshopify.com&tenantId=x', {
      ...bearer('id-shop-a'),
      'x-shop-domain': 'shop-b.myshopify.com',
      'x-tenant-id': 'y',
    });
    expect(spoofed.json().shop.domain).toBe('shop-a.myshopify.com');
  });
});

describe('sync endpoints', () => {
  const syncJobs = async () =>
    (await admin.query('select * from o_sync_job order by queued_at')).rows;

  it('requires authentication', async () => {
    expect((await get('/api/v1/sync/status')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/sync' })).statusCode).toBe(401);
  });

  it('queues the first import when a shop connects, once', async () => {
    await get('/api/v1/session', bearer('id-shop-a'));
    await get('/api/v1/session', bearer('id-shop-a'));
    expect(send).toHaveBeenCalledTimes(1);
    const [queue, payload, options] = send.mock.calls[0] as unknown as [
      string,
      Record<string, string>,
      { singletonKey: string },
    ];
    expect(queue).toBe('sync.shop');
    expect(options.singletonKey).toBe(payload.shopId);
    const jobs = await syncJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'initial', status: 'queued' });
    // 90 day history window
    const days = (Date.now() - new Date(jobs[0].window_start).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('reports status: queued, never-synced counts, stale', async () => {
    await get('/api/v1/session', bearer('id-shop-a'));
    const res = await get('/api/v1/sync/status', bearer('id-shop-a'));
    expect(res.statusCode).toBe(200);
    expect(syncStatusResponseSchema.parse(res.json())).toMatchObject({
      state: 'queued',
      counts: { products: 0, orders: 0, refunds: 0 },
      lastSuccessAt: null,
      stale: true,
      liveUpdates: { lastReceivedAt: null, failedLast24h: 0 },
    });
  });

  it('does not start a second sync while one is active, but can after it finished', async () => {
    await get('/api/v1/session', bearer('id-shop-a'));
    send.mockClear();
    const busy = await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: bearer('id-shop-a'),
    });
    expect(busy.statusCode).toBe(202);
    expect(busy.json()).toEqual({ started: false });
    expect(send).not.toHaveBeenCalled();

    await admin.query("update o_sync_job set status = 'succeeded', finished_at = now()");
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: bearer('id-shop-a'),
    });
    expect(again.json()).toEqual({ started: true });
    expect(send).toHaveBeenCalledTimes(1);
    const status = (await get('/api/v1/sync/status', bearer('id-shop-a'))).json();
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.stale).toBe(false);
  });

  it('marks the onboarding import step done after a successful sync', async () => {
    const before = (await get('/api/v1/session', bearer('id-shop-a'))).json();
    expect(
      before.onboarding.steps.find((s: { id: string }) => s.id === 'import_orders').status,
    ).toBe('pending');
    await admin.query("update o_sync_job set status = 'succeeded', finished_at = now()");
    const after = (await get('/api/v1/session', bearer('id-shop-a'))).json();
    expect(
      after.onboarding.steps.find((s: { id: string }) => s.id === 'import_orders').status,
    ).toBe('done');
  });

  it('still connects the shop if the queue is down, and records the failed import', async () => {
    send.mockRejectedValueOnce(new Error('queue unavailable'));
    const res = await get('/api/v1/session', bearer('id-shop-a'));
    expect(res.statusCode).toBe(200);
    const status = (await get('/api/v1/sync/status', bearer('id-shop-a'))).json();
    expect(status).toMatchObject({ state: 'failed', error: 'Could not queue the import' });
  });

  it('keeps each shop sync status separate', async () => {
    await get('/api/v1/session', bearer('id-shop-a'));
    await get('/api/v1/session', bearer('id-shop-b'));
    await admin.query(
      "update o_sync_job set status = 'succeeded', finished_at = now() where shop_id = (select id from m_shop where shopify_domain = 'shop-a.myshopify.com')",
    );
    const a = (await get('/api/v1/sync/status', bearer('id-shop-a'))).json();
    const b = (await get('/api/v1/sync/status', bearer('id-shop-b'))).json();
    expect(a.state).toBe('succeeded');
    expect(b.state).toBe('queued');
  });
});
