import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  PLANS,
  billingStatusSchema,
  overviewResponseSchema,
  scheduleListResponseSchema,
  supportListResponseSchema,
} from '@pi/contracts';
import { createDb, createPool, installShop } from '@pi/db';
import type { InstallResult } from '@pi/db';
import { AuthError } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH, TOKEN_CRYPTO } from '../tokens.js';

const baseEnv = {
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
};

const fakeAuth: ShopifyAuth = {
  async verifySessionToken(token) {
    const m = /^id-([a-z0-9-]+)$/.exec(token);
    if (!m) throw new AuthError('Invalid session token');
    return { shopDomain: `${m[1]}.myshopify.com`, userId: '9' };
  },
  exchangeOfflineToken: async () => ({ accessToken: 'shpat_x', scope: 'read_orders' }),
};
const send = vi.fn(async (..._a: unknown[]) => 'job');
const fakeBoss = { send, stop: async () => {} };
const fakeCrypto = {
  encrypt: (v: string) => ({ value: v, keyId: 'k1' }),
  decrypt: () => 'shpat_test',
};

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);

// What Shopify "answers" to the app's GraphQL calls.
const shopify = {
  subscriptions: [] as Array<Record<string, unknown>>,
  createResponse: null as null | Record<string, unknown>,
  cancelErrors: [] as unknown[],
  calls: [] as Array<{ query: string; variables: Record<string, unknown> }>,
};
const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as {
    query: string;
    variables: Record<string, unknown>;
  };
  shopify.calls.push(body);
  let data: unknown = {};
  if (body.query.includes('activeSubscriptions')) {
    data = { currentAppInstallation: { activeSubscriptions: shopify.subscriptions } };
  } else if (body.query.includes('appSubscriptionCreate')) {
    data = { appSubscriptionCreate: shopify.createResponse };
  } else if (body.query.includes('appSubscriptionCancel')) {
    data = {
      appSubscriptionCancel: {
        appSubscription: { id: 'x', status: 'CANCELLED' },
        userErrors: shopify.cancelErrors,
      },
    };
    shopify.subscriptions = [];
  }
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

const apps: NestFastifyApplication[] = [];
async function start(overrides: Record<string, unknown> = {}): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue({ ...baseEnv, ...overrides } as unknown as AppEnv)
    .overrideProvider(SHOPIFY_AUTH)
    .useValue(fakeAuth)
    .overrideProvider(SHOPIFY_ADMIN)
    .useValue({})
    .overrideProvider(TOKEN_CRYPTO)
    .useValue(fakeCrypto)
    .overrideProvider(QUEUE)
    .useValue(fakeBoss)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  apps.push(app);
  return app;
}

let a: InstallResult;
const mk = (d: string) =>
  installShop(db, {
    shopDomain: d,
    name: d,
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });

beforeEach(async () => {
  send.mockClear();
  fetchMock.mockClear();
  shopify.subscriptions = [];
  shopify.createResponse = null;
  shopify.cancelErrors = [];
  shopify.calls = [];
  vi.stubGlobal('fetch', fetchMock);
  await admin.query('truncate m_tenant cascade');
  a = await mk('bill-a.myshopify.com');
  await mk('bill-b.myshopify.com');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  while (apps.length) await apps.pop()!.close();
  PLANS.growth.approved = false;
  PLANS.pro.approved = false;
});
afterAll(async () => {
  await admin.end();
  await setupPool.end();
});

const req = (
  app: NestFastifyApplication,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token = 'id-bill-a',
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const json = async (...args: Parameters<typeof req>) => {
  const res = await req(...args);
  return { res, body: res.json() };
};
const status = async (app: NestFastifyApplication, token?: string) =>
  billingStatusSchema.parse((await json(app, 'GET', '/billing/status', token)).body);
const shopifySub = (name: string, st = 'ACTIVE', id = 'gid://shopify/AppSubscription/1') => ({
  id,
  name,
  status: st,
  test: true,
  currentPeriodEnd: '2026-11-09T00:00:00Z',
});
const DAYS = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const TODAY = DAYS(0);

describe('billing off (development and beta)', () => {
  it('gives every shop the beta plan and says paid plans are not open', async () => {
    const app = await start();
    const s = await status(app);
    expect(s.mode).toBe('off');
    expect(s.plan).toBe('pro');
    expect(s.note).toMatch(/not open yet/);
    expect(s.plans.every((p) => !p.available)).toBe(true);
    expect(s.plans.find((p) => p.id === 'pro')!.current).toBe(true);
    expect(s.entitlements.historyDays).toBe(90);
  });

  it('can be set to give a different plan, for testing a plan end to end', async () => {
    const app = await start({ BILLING_OFF_PLAN: 'free' });
    const s = await status(app);
    expect(s.plan).toBe('free');
    expect(s.entitlements.scheduledReports).toBe(0);
  });

  it('refuses to subscribe or cancel, and never calls Shopify', async () => {
    const app = await start();
    expect(
      (await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' })).body.error
        .code,
    ).toBe('billing_not_enabled');
    expect((await json(app, 'POST', '/billing/cancel')).body.error.code).toBe(
      'billing_not_enabled',
    );
    expect((await req(app, 'POST', '/billing/refresh')).statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a session for every billing and support endpoint', async () => {
    const app = await start();
    for (const [method, url] of [
      ['GET', '/billing/status'],
      ['POST', '/billing/refresh'],
      ['POST', '/billing/subscribe'],
      ['POST', '/billing/cancel'],
      ['GET', '/support'],
      ['POST', '/support'],
    ] as const) {
      expect((await app.inject({ method, url: `/api/v1${url}` })).statusCode).toBe(401);
    }
  });
});

describe('billing on, no subscription: the free plan is enforced on the server', () => {
  const managed = { BILLING_MODE: 'managed', SHOPIFY_APP_HANDLE: 'profit-intelligence' };

  it('shows the free plan and its limits', async () => {
    const app = await start(managed);
    const s = await status(app);
    expect(s.plan).toBe('free');
    expect(s.entitlements).toEqual(PLANS.free.entitlements);
    expect(s.subscription).toBeNull();
    expect(s.plans.find((p) => p.id === 'growth')!.available).toBe(true);
    expect(s.plans.find((p) => p.id === 'free')!.available).toBe(false);
  });

  it('refuses a period beyond the plan window on every screen, but allows one inside it', async () => {
    const app = await start(managed);
    const tooFar = `preset=custom&from=${DAYS(60)}&to=${TODAY}`;
    const ok = `preset=custom&from=${DAYS(29)}&to=${TODAY}`;
    for (const path of [
      '/dashboard/overview',
      '/profitability/products',
      '/profitability/orders',
      '/marketing/overview',
      '/reports/preview?kind=profit_loss&x=1',
    ]) {
      const sep = path.includes('?') ? '&' : '?';
      const bad = await json(app, 'GET', `${path}${sep}${tooFar}`);
      expect(bad.res.statusCode, path).toBe(403);
      expect(bad.body.error.code).toBe('plan_limit');
      expect(bad.body.error.message).toMatch(/last 30 days/);
      expect(bad.body.error.message).toMatch(/Growth plan/);
      const good = await req(app, 'GET', `${path}${sep}${ok}`);
      expect(good.statusCode, path).toBe(200);
    }
    // the named periods follow the same rule
    expect((await req(app, 'GET', '/dashboard/overview?preset=90d')).statusCode).toBe(403);
    expect((await req(app, 'GET', '/dashboard/overview?preset=30d')).statusCode).toBe(200);
  });

  it('does not leak older numbers through the comparison period', async () => {
    const app = await start(managed);
    const o = overviewResponseSchema.parse(
      (await json(app, 'GET', '/dashboard/overview?preset=30d')).body,
    );
    expect(o.deltas).toEqual({
      revenue: null,
      contributionProfit: null,
      costs: null,
      orders: null,
      averageOrderValue: null,
      marginPoints: null,
    });
    expect(o.previous.orders).toBe(0);
  });

  it('keeps leakage findings out of the free plan, with a pointer to the plan that has them', async () => {
    const app = await start(managed);
    const r = await json(app, 'GET', '/leakage?preset=7d');
    expect(r.res.statusCode).toBe(403);
    expect(r.body.error.code).toBe('plan_limit');
    expect(r.body.error.message).toMatch(/Growth plan/);
  });

  it('refuses PDF reports and scheduled emails, but allows CSV reports', async () => {
    const app = await start(managed);
    const pdf = await json(app, 'POST', '/reports/exports', 'id-bill-a', {
      kind: 'products',
      format: 'pdf',
      preset: '7d',
    });
    expect(pdf.res.statusCode).toBe(403);
    expect(pdf.body.error.message).toMatch(/PDF/);
    expect(
      (
        await req(app, 'POST', '/reports/exports', 'id-bill-a', {
          kind: 'products',
          format: 'csv',
          preset: '7d',
        })
      ).statusCode,
    ).toBe(202);
    const sched = await json(app, 'POST', '/reports/schedules', 'id-bill-a', {
      kind: 'products',
      format: 'csv',
      frequency: 'weekly',
      weekday: 1,
      hour: 8,
      recipients: ['o@x.com'],
    });
    expect(sched.res.statusCode).toBe(403);
    expect(sched.body.error.message).toMatch(/Scheduled emails/);
  });

  it('stops at the monthly report allowance and counts only this shop', async () => {
    const app = await start(managed);
    const make = (token = 'id-bill-a') =>
      req(app, 'POST', '/reports/exports', token, {
        kind: 'expenses',
        format: 'csv',
        preset: '7d',
      });
    // mark each as finished so the 5 "at once" cap does not hide the monthly one
    for (let i = 0; i < 5; i++) {
      expect((await make()).statusCode).toBe(202);
      await admin.query("update o_report_export set status = 'ready' where shop_id = $1", [
        a.shopId,
      ]);
    }
    const sixth = await json(app, 'POST', '/reports/exports', 'id-bill-a', {
      kind: 'expenses',
      format: 'csv',
      preset: '7d',
    });
    expect(sixth.res.statusCode).toBe(403);
    expect(sixth.body.error.message).toMatch(/5 of 5 reports this month/);
    expect((await make('id-bill-b')).statusCode).toBe(202);
  });

  it('a failed report does not use up the allowance', async () => {
    const app = await start(managed);
    for (let i = 0; i < 5; i++) {
      await req(app, 'POST', '/reports/exports', 'id-bill-a', {
        kind: 'expenses',
        format: 'csv',
        preset: '7d',
      });
      await admin.query("update o_report_export set status = 'failed' where shop_id = $1", [
        a.shopId,
      ]);
    }
    expect(
      (
        await req(app, 'POST', '/reports/exports', 'id-bill-a', {
          kind: 'expenses',
          format: 'csv',
          preset: '7d',
        })
      ).statusCode,
    ).toBe(202);
  });

  it('allows one advertising account, not two', async () => {
    const app = await start(managed);
    const add = (name: string) =>
      req(app, 'POST', '/marketing/accounts', 'id-bill-a', { provider: 'manual', name });
    expect((await add('One')).statusCode).toBe(201);
    const second = await json(app, 'POST', '/marketing/accounts', 'id-bill-a', {
      provider: 'manual',
      name: 'Two',
    });
    expect(second.res.statusCode).toBe(403);
    expect(second.body.error.message).toMatch(/1 advertising account/);
  });

  it('usage is reported next to the limits', async () => {
    const app = await start(managed);
    await req(app, 'POST', '/marketing/accounts', 'id-bill-a', { provider: 'manual', name: 'One' });
    await req(app, 'POST', '/reports/exports', 'id-bill-a', {
      kind: 'expenses',
      format: 'csv',
      preset: '7d',
    });
    const s = await status(app);
    expect(s.usage).toEqual({
      exportsThisMonth: 1,
      activeSchedules: 0,
      adAccounts: 1,
      ordersThisMonth: 0,
      extraOrders: 0,
      extraChargeUsd: '0.00',
    });
    expect(s.extraOrderUsd).toBe('0.10');
    expect(s.entitlements.ordersPerMonth).toBe(50);
  });
});

describe('subscriptions read from Shopify', () => {
  const managed = { BILLING_MODE: 'managed', SHOPIFY_APP_HANDLE: 'profit-intelligence' };

  it('an active Growth subscription lifts the shop to Growth, and everything it allows now works', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Growth')];
    const s = billingStatusSchema.parse((await json(app, 'POST', '/billing/refresh')).body);
    expect(s.plan).toBe('growth');
    expect(s.subscription).toMatchObject({ status: 'active', planName: 'Growth', isTest: true });
    expect(s.entitlements).toEqual(PLANS.growth.entitlements);

    expect((await req(app, 'GET', '/dashboard/overview?preset=90d')).statusCode).toBe(200);
    expect((await req(app, 'GET', '/leakage?preset=30d')).statusCode).toBe(200);
    expect(
      (
        await req(app, 'POST', '/reports/exports', 'id-bill-a', {
          kind: 'products',
          format: 'pdf',
          preset: '30d',
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await req(app, 'POST', '/reports/schedules', 'id-bill-a', {
          kind: 'products',
          format: 'pdf',
          frequency: 'weekly',
          weekday: 1,
          hour: 8,
          recipients: ['o@x.com'],
        })
      ).statusCode,
    ).toBe(201);
  });

  it('a name Shopify uses that we do not know never gives more than free', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Enterprise Plus')];
    expect((await status(app)).plan).toBe('free');
    shopify.subscriptions = [shopifySub('Enterprise Plus')];
    expect(((await json(app, 'POST', '/billing/refresh')).body as { plan: string }).plan).toBe(
      'free',
    );
  });

  it.each(['FROZEN', 'CANCELLED', 'DECLINED', 'EXPIRED', 'PENDING', 'WHATEVER'])(
    'a %s subscription is not paid for, so the shop stays on free',
    async (st) => {
      const app = await start(managed);
      shopify.subscriptions = [shopifySub('Pro', st)];
      const s = billingStatusSchema.parse((await json(app, 'POST', '/billing/refresh')).body);
      expect(s.plan).toBe('free');
      expect((await req(app, 'GET', '/dashboard/overview?preset=90d')).statusCode).toBe(403);
    },
  );

  it('with two active subscriptions the better plan counts', async () => {
    const app = await start(managed);
    shopify.subscriptions = [
      shopifySub('Growth', 'ACTIVE', 'g1'),
      shopifySub('Pro', 'ACTIVE', 'g2'),
    ];
    expect(billingStatusSchema.parse((await json(app, 'POST', '/billing/refresh')).body).plan).toBe(
      'pro',
    );
  });

  it('is per shop: one shop upgrading does not change another', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Pro')];
    await req(app, 'POST', '/billing/refresh');
    expect((await status(app)).plan).toBe('pro');
    expect((await status(app, 'id-bill-b')).plan).toBe('free');
  });

  it('Shopify being unreachable leaves the stored plan alone and says so', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Growth')];
    await req(app, 'POST', '/billing/refresh');
    // a token Shopify rejects is not retried, so the failure shows up straight away
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const r = await json(app, 'POST', '/billing/refresh');
    expect(r.res.statusCode).toBe(503);
    expect(r.body.error.code).toBe('shopify_unavailable');
    expect((await status(app)).plan).toBe('growth');
  });

  it('a downgrade pauses extra scheduled emails instead of deleting anything, and upgrading lets them resume', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Growth')];
    await req(app, 'POST', '/billing/refresh');
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await req(app, 'POST', '/reports/schedules', 'id-bill-a', {
            kind: 'products',
            format: 'csv',
            frequency: 'weekly',
            weekday: 1,
            hour: 8,
            recipients: [`r${i}@x.com`],
          })
        ).statusCode,
      ).toBe(201);
    }
    // back to free: nothing is cancelled for them, but the schedules stop
    shopify.subscriptions = [];
    expect(billingStatusSchema.parse((await json(app, 'POST', '/billing/refresh')).body).plan).toBe(
      'free',
    );
    let list = scheduleListResponseSchema.parse(
      (await json(app, 'GET', '/reports/schedules')).body,
    );
    expect(list.rows).toHaveLength(3); // still there
    expect(list.rows.every((r) => !r.enabled)).toBe(true); // all paused
    // while on free they cannot be switched back on
    const resume = await json(app, 'PATCH', `/reports/schedules/${list.rows[0]!.id}`, 'id-bill-a', {
      enabled: true,
    });
    expect(resume.res.statusCode).toBe(403);
    // upgrade again and they can
    shopify.subscriptions = [shopifySub('Growth')];
    await req(app, 'POST', '/billing/refresh');
    for (const r of list.rows) {
      expect(
        (await req(app, 'PATCH', `/reports/schedules/${r.id}`, 'id-bill-a', { enabled: true }))
          .statusCode,
      ).toBe(200);
    }
    list = scheduleListResponseSchema.parse((await json(app, 'GET', '/reports/schedules')).body);
    expect(list.rows.every((r) => r.enabled)).toBe(true);
  });

  it('a downgrade to a plan that allows fewer keeps the oldest and pauses the newest', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Pro')];
    await req(app, 'POST', '/billing/refresh');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        (
          await json(app, 'POST', '/reports/schedules', 'id-bill-a', {
            kind: 'products',
            format: 'csv',
            frequency: 'weekly',
            weekday: 1,
            hour: 8,
            recipients: [`r${i}@x.com`],
          })
        ).body.id,
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    shopify.subscriptions = [shopifySub('Growth')];
    await req(app, 'POST', '/billing/refresh');
    const list = scheduleListResponseSchema.parse(
      (await json(app, 'GET', '/reports/schedules')).body,
    );
    expect(list.rows.filter((r) => r.enabled).map((r) => r.id)).toEqual(ids.slice(0, 3));
    expect(list.rows.filter((r) => !r.enabled).map((r) => r.id)).toEqual(ids.slice(3));
  });

  it('a downgrade never removes data: expenses, costs and reports remain', async () => {
    const app = await start(managed);
    shopify.subscriptions = [shopifySub('Pro')];
    await req(app, 'POST', '/billing/refresh');
    const cat = (await json(app, 'GET', '/expenses/categories')).body.categories[0].id;
    await req(app, 'POST', '/expenses', 'id-bill-a', {
      name: 'Rent',
      categoryId: cat,
      amount: '100',
      kind: 'one_time',
      startDate: TODAY,
    });
    await req(app, 'POST', '/marketing/accounts', 'id-bill-a', { provider: 'manual', name: 'A' });
    await req(app, 'POST', '/marketing/accounts', 'id-bill-a', { provider: 'manual', name: 'B' });
    shopify.subscriptions = [];
    await req(app, 'POST', '/billing/refresh');
    expect(((await json(app, 'GET', '/expenses')).body.rows as unknown[]).length).toBe(1);
    expect(
      ((await json(app, 'GET', '/marketing/overview?preset=7d')).body.accounts as unknown[]).length,
    ).toBe(2); // 2 > the free limit of 1, kept
    // but adding another is refused
    expect(
      (
        await req(app, 'POST', '/marketing/accounts', 'id-bill-a', {
          provider: 'manual',
          name: 'C',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('starting a subscription', () => {
  it('managed pricing: sends the merchant to the plan page Shopify hosts, and charges nothing itself', async () => {
    const app = await start({ BILLING_MODE: 'managed', SHOPIFY_APP_HANDLE: 'profit-intelligence' });
    const r = await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'pro' });
    expect(r.res.statusCode).toBe(200);
    expect(r.body.url).toBe(
      'https://admin.shopify.com/store/bill-a/charges/profit-intelligence/pricing_plans',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses without the app handle, for the free plan, and for an unknown plan', async () => {
    const noHandle = await start({ BILLING_MODE: 'managed' });
    expect(
      (await json(noHandle, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'pro' })).body.error
        .code,
    ).toBe('billing_not_configured');
    const app = await start({ BILLING_MODE: 'managed', SHOPIFY_APP_HANDLE: 'h' });
    expect(
      (await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'free' })).body.error
        .code,
    ).toBe('invalid_plan');
    expect(
      (await req(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'platinum' })).statusCode,
    ).toBe(400);
    expect((await req(app, 'POST', '/billing/subscribe', 'id-bill-a', {})).statusCode).toBe(400);
  });

  it('billing API: an unapproved plan cannot be bought', async () => {
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'h' });
    const r = await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' });
    expect(r.res.statusCode).toBe(400);
    expect(r.body.error.code).toBe('plan_not_available');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await status(app)).plans.find((p) => p.id === 'growth')!.available).toBe(false);
  });

  it('billing API: an approved plan creates a test subscription with the right price and returns Shopify’s confirmation page', async () => {
    PLANS.growth.approved = true;
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'profit-intelligence' });
    shopify.createResponse = {
      confirmationUrl: 'https://admin.shopify.com/store/bill-a/charges/1/confirm',
      appSubscription: { id: 'gid://shopify/AppSubscription/9', status: 'PENDING' },
      userErrors: [],
    };
    const r = await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' });
    expect(r.res.statusCode).toBe(200);
    expect(r.body.url).toBe('https://admin.shopify.com/store/bill-a/charges/1/confirm');
    const call = shopify.calls[0]!;
    expect(call.query).toContain('appSubscriptionCreate');
    expect(call.variables).toMatchObject({
      name: 'Growth',
      test: true,
      returnUrl: 'https://admin.shopify.com/store/bill-a/apps/profit-intelligence',
    });
    expect(call.variables.lineItems).toEqual([
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: 29, currencyCode: 'USD' },
            interval: 'EVERY_30_DAYS',
          },
        },
      },
    ]);
    // nothing is granted until Shopify says it is ACTIVE
    expect((await status(app)).plan).toBe('free');
  });

  it('billing API: never hands the browser a URL that is not Shopify', async () => {
    PLANS.growth.approved = true;
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'h' });
    shopify.createResponse = { confirmationUrl: 'https://evil.example/pay', userErrors: [] };
    const r = await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' });
    expect(r.res.statusCode).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('evil.example');
  });

  it('billing API: Shopify errors become a plain message without leaking details', async () => {
    PLANS.growth.approved = true;
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'h' });
    shopify.createResponse = {
      confirmationUrl: null,
      userErrors: [{ field: ['x'], message: 'secret detail' }],
    };
    const r = await json(app, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' });
    expect(r.body.error.code).toBe('billing_failed');
    expect(JSON.stringify(r.body)).not.toContain('secret detail');
  });

  it('billing API: test charges outside production, and real ones only when the server says so', async () => {
    PLANS.growth.approved = true;
    shopify.createResponse = {
      confirmationUrl: 'https://admin.shopify.com/store/x/charges/1/confirm',
      userErrors: [],
    };
    const prod = await start({
      BILLING_MODE: 'api',
      SHOPIFY_APP_HANDLE: 'h',
      NODE_ENV: 'production',
      BILLING_TEST_MODE: 'false',
    });
    await req(prod, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' });
    expect(shopify.calls.at(-1)!.variables.test).toBe(false);
    const prodTest = await start({
      BILLING_MODE: 'api',
      SHOPIFY_APP_HANDLE: 'h',
      NODE_ENV: 'production',
      BILLING_TEST_MODE: 'true',
    });
    await req(prodTest, 'POST', '/billing/subscribe', 'id-bill-a', { plan: 'growth' });
    expect(shopify.calls.at(-1)!.variables.test).toBe(true);
  });
});

describe('cancelling', () => {
  it('billing API: cancels at Shopify and goes back to free', async () => {
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'h' });
    shopify.subscriptions = [shopifySub('Pro', 'ACTIVE', 'gid://shopify/AppSubscription/55')];
    await req(app, 'POST', '/billing/refresh');
    const r = await json(app, 'POST', '/billing/cancel');
    expect(r.res.statusCode).toBe(200);
    expect(r.body.plan).toBe('free');
    const cancel = shopify.calls.find((c) => c.query.includes('appSubscriptionCancel'))!;
    expect(cancel.variables).toEqual({ id: 'gid://shopify/AppSubscription/55' });
  });

  it('refuses when there is nothing to cancel', async () => {
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'h' });
    const r = await json(app, 'POST', '/billing/cancel');
    expect(r.res.statusCode).toBe(400);
    expect(r.body.error.code).toBe('no_subscription');
  });

  it('managed pricing: points the merchant to Shopify to change or cancel', async () => {
    const app = await start({ BILLING_MODE: 'managed', SHOPIFY_APP_HANDLE: 'h' });
    shopify.subscriptions = [shopifySub('Pro')];
    await req(app, 'POST', '/billing/refresh');
    const r = await json(app, 'POST', '/billing/cancel');
    expect(r.body.error.code).toBe('change_on_shopify');
    expect(r.body.error.message).toContain('admin.shopify.com/store/bill-a/settings/apps');
  });

  it('a Shopify refusal keeps the plan', async () => {
    const app = await start({ BILLING_MODE: 'api', SHOPIFY_APP_HANDLE: 'h' });
    shopify.subscriptions = [shopifySub('Pro')];
    await req(app, 'POST', '/billing/refresh');
    shopify.cancelErrors = [{ message: 'nope' }];
    const r = await json(app, 'POST', '/billing/cancel');
    expect(r.body.error.code).toBe('billing_failed');
  });
});

describe('support and feedback', () => {
  it('stores a message with the shop from the session, and lists only this shop messages', async () => {
    const app = await start();
    const r = await json(app, 'POST', '/support', 'id-bill-a', {
      kind: 'question',
      message: 'How do I add a cost?',
      contactEmail: 'Owner@Store.com',
    });
    expect(r.res.statusCode).toBe(201);
    expect(r.body).toMatchObject({
      kind: 'question',
      status: 'new',
      contactEmail: 'owner@store.com',
    });
    const mine = supportListResponseSchema.parse((await json(app, 'GET', '/support')).body);
    expect(mine.rows.map((x) => x.message)).toEqual(['How do I add a cost?']);
    expect(
      supportListResponseSchema.parse((await json(app, 'GET', '/support', 'id-bill-b')).body).rows,
    ).toEqual([]);
    const stored = await admin.query('select shop_id, created_by from o_feedback');
    expect(stored.rows[0]).toMatchObject({ shop_id: a.shopId, created_by: 'shopify-user:9' });
  });

  it('ignores a shop id sent by the client', async () => {
    const app = await start();
    await req(app, 'POST', '/support', 'id-bill-a', {
      kind: 'problem',
      message: 'It broke',
      shopId: 'x',
      tenantId: 'y',
    });
    expect(
      (await admin.query('select count(*)::int n from o_feedback where shop_id = $1', [a.shopId]))
        .rows[0].n,
    ).toBe(1);
  });

  it('tells the merchant it was received, and whether anyone can reply', async () => {
    const app = await start();
    await req(app, 'POST', '/support', 'id-bill-a', { kind: 'feedback', message: 'Nice app' });
    const n = (
      await admin.query("select title, body from o_notification where kind = 'support_received'")
    ).rows[0];
    expect(n.title).toBe('We received your message');
    expect(n.body).toMatch(/cannot reply/);
  });

  it('allows five messages an hour, then asks the merchant to wait', async () => {
    const app = await start();
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await req(app, 'POST', '/support', 'id-bill-a', {
            kind: 'feedback',
            message: `message ${i}`,
          })
        ).statusCode,
      ).toBe(201);
    }
    const sixth = await json(app, 'POST', '/support', 'id-bill-a', {
      kind: 'feedback',
      message: 'one more',
    });
    expect(sixth.res.statusCode).toBe(429);
    expect(sixth.body.error.code).toBe('rate_limited');
    expect(
      (await req(app, 'POST', '/support', 'id-bill-b', { kind: 'feedback', message: 'other shop' }))
        .statusCode,
    ).toBe(201);
  });

  it.each([
    ['empty message', { kind: 'feedback', message: '' }],
    ['two letters', { kind: 'feedback', message: 'hi' }],
    ['over 2000 characters', { kind: 'feedback', message: 'x'.repeat(2001) }],
    ['unknown kind', { kind: 'complaint', message: 'hello there' }],
    ['bad email', { kind: 'feedback', message: 'hello there', contactEmail: 'not-an-email' }],
    ['no kind', { message: 'hello there' }],
  ])('rejects %s', async (_l, body) => {
    const app = await start();
    expect((await req(app, 'POST', '/support', 'id-bill-a', body)).statusCode).toBe(400);
    expect((await admin.query('select count(*)::int n from o_feedback')).rows[0].n).toBe(0);
  });

  it('stores text as text: markup is kept inert and returned as a string', async () => {
    const app = await start();
    const evil = "<script>alert(1)</script> '; drop table o_feedback;--";
    const r = await json(app, 'POST', '/support', 'id-bill-a', { kind: 'problem', message: evil });
    expect(r.body.message).toBe(evil);
    expect((await admin.query('select count(*)::int n from o_feedback')).rows[0].n).toBe(1);
  });
});

describe('onboarding checklist', () => {
  const steps = async (app: NestFastifyApplication) =>
    Object.fromEntries(
      (
        (await json(app, 'GET', '/session')).body.onboarding.steps as Array<{
          id: string;
          status: string;
        }>
      ).map((s) => [s.id, s.status]),
    );

  it('starts with only the connection done and says what to do next, where, and why', async () => {
    const app = await start();
    const body = (await json(app, 'GET', '/session')).body;
    const list = body.onboarding.steps as Array<{
      id: string;
      status: string;
      href: string | null;
      optional: boolean;
      why: string;
    }>;
    expect(list.map((s) => s.id)).toEqual([
      'connected',
      'import_orders',
      'product_costs',
      'payment_fees',
      'shipping_costs',
      'ad_platforms',
      'expenses',
    ]);
    expect(list.filter((s) => s.status === 'done').map((s) => s.id)).toEqual(['connected']);
    expect(list.find((s) => s.id === 'expenses')!.optional).toBe(true);
    expect(list.filter((s) => s.optional).map((s) => s.id)).toEqual(['ad_platforms', 'expenses']);
    expect(list.find((s) => s.id === 'ad_platforms')!.href).toBe('/marketing');
    for (const s of list) expect(s.why.length).toBeGreaterThan(15);
    expect(list.find((s) => s.id === 'product_costs')!.href).toBe('/products?tab=costs');
    expect(list.find((s) => s.id === 'expenses')!.href).toBe('/expenses');
  });

  it('ticks each step off as the merchant does it', async () => {
    const app = await start();
    await req(app, 'POST', '/settings/fee-rules', 'id-bill-a', {
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.3',
      effectiveFrom: '2026-01-01',
    });
    expect(await steps(app)).toMatchObject({
      payment_fees: 'done',
      shipping_costs: 'pending',
      expenses: 'pending',
    });
    await req(app, 'POST', '/settings/shipping-rules', 'id-bill-a', {
      mode: 'flat',
      amount: '6',
      effectiveFrom: '2026-01-01',
    });
    const cat = (await json(app, 'GET', '/expenses/categories')).body.categories[0].id;
    await req(app, 'POST', '/expenses', 'id-bill-a', {
      name: 'Rent',
      categoryId: cat,
      amount: '100',
      kind: 'one_time',
      startDate: TODAY,
    });
    expect(await steps(app)).toMatchObject({
      payment_fees: 'done',
      shipping_costs: 'done',
      expenses: 'done',
    });
    // another shop is unaffected
    expect(
      await json(app, 'GET', '/session', 'id-bill-b').then(
        (r) =>
          r.body.onboarding.steps.filter((s: { status: string }) => s.status === 'done').length,
      ),
    ).toBe(1);
  });

  it('product costs count as done only when no product is without a cost', async () => {
    const { readFileSync } = await import('node:fs');
    const { upsertProducts, withTenant } = await import('@pi/db');
    const { mapProduct } = await import('@pi/shopify');
    const nodes = JSON.parse(
      readFileSync(
        new URL('../../../../packages/shopify/test/fixtures/products-page.json', import.meta.url),
        'utf8',
      ),
    ).products.nodes as Record<string, unknown>[];
    await withTenant(db, a.tenantId, (tx) => upsertProducts(tx, a, nodes.map(mapProduct)));
    const app = await start();
    const first = (await json(app, 'GET', '/session')).body.onboarding.steps.find(
      (s: { id: string }) => s.id === 'product_costs',
    );
    expect(first.status).toBe('pending');
    expect(first.why).toMatch(/no cost/);
    const missing = (await json(app, 'GET', '/settings/costs?filter=missing&pageSize=100')).body
      .rows as Array<{ variantShopifyId: string }>;
    for (const v of missing) {
      await req(app, 'PUT', `/settings/costs/${v.variantShopifyId}`, 'id-bill-a', {
        amount: '5',
        effectiveFrom: DAYS(5),
      });
    }
    expect(await steps(app)).toMatchObject({ product_costs: 'done' });
  });
});
