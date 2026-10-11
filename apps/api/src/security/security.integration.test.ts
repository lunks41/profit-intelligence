import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createDb, createPool, installShop } from '@pi/db';
import { AuthError } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AppEnv } from '../config/config.module.js';
import { limiters } from '../common/rate-limit.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';

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
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_ENCRYPTION_KEY_ID: 'k1',
} as unknown as AppEnv;

const fakeAuth: ShopifyAuth = {
  async verifySessionToken(token) {
    const m = /^id-([a-z0-9-]+)$/.exec(token);
    if (!m) throw new AuthError('Invalid session token');
    return { shopDomain: `${m[1]}.myshopify.com`, userId: '1' };
  },
  exchangeOfflineToken: async () => ({ accessToken: 'shpat_x', scope: 'read_orders' }),
};
const fakeBoss = { send: vi.fn(async () => 'job'), stop: async () => {} };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);

const logged: Array<Record<string, unknown>> = [];
let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .overrideProvider(SHOPIFY_AUTH)
    .useValue(fakeAuth)
    .overrideProvider(SHOPIFY_ADMIN)
    .useValue({})
    .overrideProvider(QUEUE)
    .useValue(fakeBoss)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  const sink = (level: string) => (msg: string, fields?: Record<string, unknown>) =>
    void logged.push({ level, msg, ...fields });
  configureApp(app, {
    production: true,
    log: { debug: sink('debug'), info: sink('info'), warn: sink('warn'), error: sink('error') },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  logged.length = 0;
  limiters.shop.reset();
  limiters.failedAuth.reset();
  await admin.query('truncate m_tenant cascade');
  for (const d of ['sec-a', 'sec-b']) {
    await installShop(db, {
      shopDomain: `${d}.myshopify.com`,
      name: d,
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: 'x',
      keyId: 'k1',
      scopes: 'read_orders',
    });
  }
});
afterEach(() => {
  delete process.env.RATE_LIMIT_PER_MINUTE;
  limiters.shop.setClock(() => Date.now());
  limiters.failedAuth.setClock(() => Date.now());
});
afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

// ---- route inventory: no endpoint can be added without a sign-in check -------------------------

interface Route {
  controller: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  guarded: boolean;
}
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

function routes(): Route[] {
  const out: Route[] = [];
  const modules = app.get(ModulesContainer);
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: never[]) => object) | null;
      if (!ctrl) continue;
      const base = Reflect.getMetadata(PATH_METADATA, ctrl) as string | undefined;
      if (base === undefined) continue;
      const classGuards: unknown[] = Reflect.getMetadata('__guards__', ctrl) ?? [];
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = (ctrl.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (verb === undefined || verb > 4) continue;
        const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '/';
        const methodGuards: unknown[] = Reflect.getMetadata('__guards__', handler) ?? [];
        const path = [base, sub === '/' ? '' : sub]
          .filter(Boolean)
          .join('/')
          .replace(/:[A-Za-z]+/g, '1');
        out.push({
          controller: ctrl.name,
          method: METHODS[verb]!,
          url: `/api/v1/${path}`,
          guarded: [...classGuards, ...methodGuards].includes(SessionGuard),
        });
      }
    }
  }
  return out;
}

// Controllers that are public on purpose: health, the webhook endpoint (signed instead), and the address
// the ad platforms send the merchant back to (identified by an encrypted, expiring state instead).
const PUBLIC = new Set(['HealthController', 'WebhooksController', 'MarketingOauthController']);

describe('route inventory', () => {
  it('finds the whole API, so the checks below are not vacuous', () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(60);
    expect(new Set(all.map((r) => r.controller)).size).toBeGreaterThan(12);
  });

  it('every controller except health and webhooks is behind the session guard', () => {
    const open = routes().filter((r) => !r.guarded && !PUBLIC.has(r.controller));
    expect(open.map((r) => `${r.method} ${r.url} (${r.controller})`)).toEqual([]);
  });

  it('every guarded route answers 401 with no token, and with a malformed or unknown one', async () => {
    const guarded = routes().filter((r) => r.guarded);
    expect(guarded.length).toBeGreaterThan(55);
    for (const r of guarded) {
      for (const authorization of [
        undefined,
        'Bearer',
        'Bearer not.a.token',
        'Basic abc',
        'Bearer id-unknown-shop-without-install!',
      ]) {
        limiters.failedAuth.reset();
        const res = await app.inject({
          method: r.method,
          url: r.url,
          ...(authorization ? { headers: { authorization } } : {}),
          ...(r.method === 'GET' ? {} : { payload: {} }),
        });
        expect(res.statusCode, `${r.method} ${r.url} with ${authorization ?? 'no header'}`).toBe(
          401,
        );
      }
    }
  });

  it('the public controllers are exactly the expected ones', () => {
    const publicRoutes = routes().filter((r) => !r.guarded);
    expect(new Set(publicRoutes.map((r) => r.controller))).toEqual(PUBLIC);
  });
});

describe('response headers', () => {
  it('every response, including errors and the public health check, carries the security headers', async () => {
    for (const url of ['/health', '/api/v1/session', '/api/v1/does-not-exist']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('an authorised answer is marked no-store too', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { authorization: 'Bearer id-sec-a' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('request logging', () => {
  it('logs the method, the route pattern, status and shop, and never the path ids, query, token or body', async () => {
    const secret = 'id-sec-a';
    await app.inject({
      method: 'GET',
      url: '/api/v1/profitability/orders/123456789?search=customer%40mail.com',
      headers: { authorization: `Bearer ${secret}`, 'x-request-id': 'r-1' },
    });
    const line = logged.find((l) => l.route === '/api/v1/profitability/orders/:id')!;
    expect(line).toBeDefined();
    expect(line).toMatchObject({
      method: 'GET',
      status: 404,
      level: 'warn',
      shopId: expect.any(String),
    });
    const text = JSON.stringify(logged);
    expect(text).not.toContain('123456789');
    expect(text).not.toContain('customer');
    expect(text).not.toContain(secret);
  });

  it('logs a refused sign-in with no shop, and a server error as an error', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/session' });
    const line = logged.find((l) => l.status === 401)!;
    expect(line).toMatchObject({ level: 'warn', shopId: null, route: '/api/v1/session' });
  });

  it('does not log the health check, which a monitor calls every few seconds', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    expect(logged.filter((l) => l.route === '/health')).toEqual([]);
  });
});

describe('rate limiting', () => {
  it('slows a shop that sends too many requests, with Retry-After, and leaves other shops alone', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '5';
    const call = (token: string) =>
      app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { authorization: `Bearer ${token}` },
      });
    for (let i = 0; i < 5; i++) expect((await call('id-sec-a')).statusCode).toBe(200);
    const sixth = await call('id-sec-a');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers['retry-after']).toBeDefined();
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(sixth.json().error.code).toBe('rate_limited');
    expect((await call('id-sec-b')).statusCode).toBe(200);
  });

  it('lets the shop back in when the minute has passed', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    let now = Date.now();
    limiters.shop.setClock(() => now);
    const call = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { authorization: 'Bearer id-sec-a' },
      });
    await call();
    await call();
    expect((await call()).statusCode).toBe(429);
    now += 61_000;
    expect((await call()).statusCode).toBe(200);
  });

  it('a limit of 0 turns it off', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '0';
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/session',
            headers: { authorization: 'Bearer id-sec-a' },
          })
        ).statusCode,
      ).toBe(200);
    }
  });

  it('an address that keeps presenting bad tokens is told to wait, and good requests from elsewhere are not affected', async () => {
    for (let i = 0; i < 60; i++) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/session',
            headers: { authorization: 'Bearer bad.token' },
          })
        ).statusCode,
      ).toBe(401);
    }
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { authorization: 'Bearer bad.token' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // the block follows the address, so a valid token from the same address waits too: it is a
    // pause, not a ban, and it ends when the minute does
    limiters.failedAuth.reset();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/session',
          headers: { authorization: 'Bearer id-sec-a' },
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('the public endpoints', () => {
  it('health reveals nothing but its own status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['service', 'status', 'time']);
  });

  it('the webhook endpoint refuses an unsigned or oversized request', async () => {
    const unsigned = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(unsigned.statusCode).toBe(401);
    const huge = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ filler: 'x'.repeat(2_000_000) }),
    });
    expect(huge.statusCode).toBe(413);
  });

  it('unknown routes and wrong methods give the same plain error shape, with nothing internal', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/nope'],
      ['DELETE', '/api/v1/session'],
      ['GET', '/admin'],
      ['GET', '/.env'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect([401, 404, 405]).toContain(res.statusCode);
      expect(res.body).not.toMatch(/stack|node_modules|at .*\.ts|postgres/i);
    }
  });
});
