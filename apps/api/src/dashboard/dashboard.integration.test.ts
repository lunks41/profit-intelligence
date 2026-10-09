import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { overviewResponseSchema } from '@pi/contracts';
import {
  createDb,
  createPool,
  installShop,
  loadOrdersForProfit,
  replaceProfitEntries,
  setMissingCogsThreshold,
  upsertOrders,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { calculateOrder } from '@pi/profit-engine';
import type { EngineConfig, EngineOrder } from '@pi/profit-engine';
import { AuthError, mapOrder } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';

const orderNodes = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shopify/test/fixtures/orders-page.json', import.meta.url),
    'utf8',
  ),
).orders.nodes as Record<string, unknown>[];

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

let app: NestFastifyApplication;
let a: InstallResult;

const get = (url: string, token = 'id-dash-a') =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const overview = async (qs: string, token?: string) => {
  const res = await get(`/api/v1/dashboard/overview${qs}`, token);
  return { res, body: res.json() };
};
const ALL = '?preset=custom&from=2026-01-01&to=2026-10-09';

function mixedConfig(orders: EngineOrder[]): EngineConfig {
  const variants = [
    ...new Set(
      orders.flatMap((o) =>
        o.lines.map((l) => l.variantShopifyId).filter((v): v is number => v !== null),
      ),
    ),
  ].sort((x, y) => x - y); // deterministic: the database returns orders in random UUID order
  const merchantCosts = new Map<number, { effectiveFrom: string; amount: string }[]>();
  const shopifyCosts = new Map<number, string>();
  variants.forEach((v, i) => {
    if (i % 3 === 0) merchantCosts.set(v, [{ effectiveFrom: '2026-01-01', amount: '12.50' }]);
    else if (i % 3 === 1) shopifyCosts.set(v, '8.00');
  });
  return {
    timezone: 'UTC',
    merchantCosts,
    shopifyCosts,
    feeRules: [
      {
        gateway: null,
        percent: '2.9',
        fixedAmount: '0.30',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ],
    shippingRules: [],
  };
}

async function calculateAll(who: InstallResult) {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, orderNodes.map(mapOrder)));
  const loaded = await withTenant(db, who.tenantId, (tx) =>
    loadOrdersForProfit(tx, who, { limit: 1000 }),
  );
  const cfg = mixedConfig(loaded.map((l) => l.order as EngineOrder));
  for (const { orderId, order } of loaded) {
    const r = calculateOrder(order as EngineOrder, cfg);
    await withTenant(db, who.tenantId, (tx) =>
      replaceProfitEntries(
        tx,
        who,
        orderId,
        order.currency,
        'test',
        {
          orderDate: r.entries[0]?.entryDate ?? order.processedAt.toISOString().slice(0, 10),
          recognized: r.recognized,
          exclusionReason: r.exclusionReason,
          flags: r.flags,
          contributionAmount: r.recognized
            ? r.entries
                .filter((e) => !e.memo)
                .reduce((s, e) => s + Number(e.amount), 0)
                .toFixed(4)
            : null,
          partial: r.entries.some(
            (e) =>
              ['cogs', 'payment_fees', 'shipping_cost'].includes(e.component) &&
              e.status === 'missing',
          ),
        },
        r.entries.map((e) => ({ ...e })),
      ),
    );
  }
}

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
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
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
  a = await mk('dash-a.myshopify.com');
  await mk('dash-b.myshopify.com');
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

describe('GET /api/v1/dashboard/overview', () => {
  it('requires authentication', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/dashboard/overview' })).statusCode,
    ).toBe(401);
  });

  it('returns a complete, schema-valid overview for the default period', async () => {
    await calculateAll(a);
    const { res, body } = await overview('');
    expect(res.statusCode).toBe(200);
    const parsed = overviewResponseSchema.parse(body);
    expect(parsed.period).toMatchObject({ preset: '30d', days: 30, timezone: 'UTC' });
    expect(parsed.trend).toHaveLength(30);
    expect(parsed.currency).toMatchObject({ code: 'USD', shopCode: 'USD', converted: false });
  });

  it('summarises a period and its trend adds up exactly to the headline numbers', async () => {
    await calculateAll(a);
    const { body } = await overview(ALL);
    const o = overviewResponseSchema.parse(body);
    expect(Number(o.summary.revenue)).toBeGreaterThan(0);
    expect(o.summary.orders).toBeGreaterThan(5);
    const cents = (s: string) => Math.round(Number(s) * 100);
    expect(o.trend.reduce((s, d) => s + cents(d.revenue), 0)).toBe(cents(o.summary.revenue));
    expect(o.trend.reduce((s, d) => s + cents(d.contributionProfit), 0)).toBe(
      cents(o.summary.contributionProfit),
    );
    expect(o.trend.reduce((s, d) => s + d.orders, 0)).toBe(o.summary.orders);
    expect(o.trend).toHaveLength(o.period.days);
    // costs missing for some variants and no shipping rule: profit is partial, confidence is not high
    expect(o.summary.partial).toBe(true);
    expect(o.summary.confidence.band).not.toBe('high');
  });

  it('compares with the period immediately before it', async () => {
    await calculateAll(a);
    const { body } = await overview('?preset=custom&from=2026-09-01&to=2026-09-30');
    const o = overviewResponseSchema.parse(body);
    expect(o.period.days).toBe(30);
    expect(o.previousPeriod).toEqual({ from: '2026-08-02', to: '2026-08-31' });
    if (Number(o.previous.revenue) !== 0) expect(o.deltas.revenue).not.toBeNull();
  });

  it('filters by date: a narrow period has fewer orders than the whole one', async () => {
    await calculateAll(a);
    const whole = overviewResponseSchema.parse((await overview(ALL)).body);
    const narrow = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-04-10&to=2026-04-25')).body,
    );
    expect(narrow.summary.orders).toBeLessThan(whole.summary.orders);
    expect(Number(narrow.summary.grossSales)).toBeLessThan(Number(whole.summary.grossSales));
  });

  it('reports alerts: missing costs, fees, shipping and awaiting payment', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    const ids = o.alerts.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['missing_shipping_cost', 'awaiting_payment']));
    expect(o.awaitingPayment.count).toBeGreaterThan(0);

    // The missing-cost alert follows the merchant's limit: no alert while the share of sales without
    // a cost is within the limit, an alert as soon as the limit is set below it.
    const share = Number(o.summary.missingCostShare) * 100;
    expect(share).toBeGreaterThan(2);
    expect(share).toBeLessThan(98);
    await setMissingCogsThreshold(db, a, String(Math.ceil(share) + 1), 'tester');
    const lenient = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(lenient.alerts.map((x) => x.id)).not.toContain('missing_costs');
    await setMissingCogsThreshold(db, a, String(Math.floor(share) - 1), 'tester');
    const strict = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(strict.alerts.map((x) => x.id)).toContain('missing_costs');
    // alerts come with a reason and sorted by severity
    const order = { critical: 0, warning: 1, info: 2 } as const;
    expect(o.alerts.map((x) => order[x.severity])).toEqual(
      [...o.alerts.map((x) => order[x.severity])].sort(),
    );
    // nothing here is a "confirmed loss" because every order has a missing shipping cost
    expect(ids).not.toContain('loss_orders');
  });

  it('an empty store gives zeros and no undefined ratios (no NaN)', async () => {
    const { res, body } = await overview('?preset=7d', 'id-dash-b');
    expect(res.statusCode).toBe(200);
    const o = overviewResponseSchema.parse(body);
    expect(o.summary).toMatchObject({
      revenue: '0.0000',
      contributionProfit: '0.0000',
      orders: 0,
      contributionMargin: null,
      averageOrderValue: null,
      refundRate: null,
    });
    expect(o.deltas).toEqual({
      revenue: null,
      contributionProfit: null,
      orders: null,
      averageOrderValue: null,
      marginPoints: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/NaN|Infinity/);
  });

  it('keeps each shop to its own data', async () => {
    await calculateAll(a);
    const mine = overviewResponseSchema.parse((await overview(ALL)).body);
    const theirs = overviewResponseSchema.parse((await overview(ALL, 'id-dash-b')).body);
    expect(mine.summary.orders).toBeGreaterThan(0);
    expect(theirs.summary.orders).toBe(0);
    expect(theirs.summary.revenue).toBe('0.0000');
  });
});

describe('validation', () => {
  it.each([
    ['unknown preset', '?preset=yesterday'],
    ['custom without dates', '?preset=custom'],
    ['reversed dates', '?preset=custom&from=2026-09-30&to=2026-09-01'],
    ['impossible date', '?preset=custom&from=2026-02-31&to=2026-03-05'],
    ['future end date', '?preset=custom&from=2026-10-01&to=2099-01-01'],
    ['more than a year', '?preset=custom&from=2024-01-01&to=2026-10-09'],
    ['malformed date', '?preset=custom&from=nope&to=2026-10-09'],
    ['lower-case currency', '?currency=aed'],
  ])('rejects %s with 400 and a readable message', async (_label, qs) => {
    const { res, body } = await overview(qs);
    expect(res.statusCode).toBe(400);
    expect(body.error.code).toMatch(/invalid_/);
    expect(body.error.message.length).toBeGreaterThan(5);
  });

  it('rejects a currency with no known rate', async () => {
    const { res, body } = await overview('?currency=EUR');
    expect(res.statusCode).toBe(400);
    expect(body.error.code).toBe('unsupported_currency');
  });
});

describe('display currency', () => {
  it('converts USD to AED at the peg, day by day, and says so', async () => {
    await calculateAll(a);
    const usd = overviewResponseSchema.parse((await overview(ALL)).body);
    const aed = overviewResponseSchema.parse((await overview(`${ALL}&currency=AED`)).body);
    expect(aed.currency).toMatchObject({ code: 'AED', shopCode: 'USD', converted: true });
    expect(aed.currency.note).toContain('peg');
    expect(aed.currency.available).toEqual(['USD', 'AED']);
    // within a cent of the exact conversion for each day that has activity
    const days = usd.trend.filter((d) => Number(d.revenue) !== 0 || d.orders > 0).length;
    expect(
      Math.abs(Number(aed.summary.revenue) - Number(usd.summary.revenue) * 3.6725),
    ).toBeLessThan(0.01 * days + 0.01);
    expect(aed.summary.orders).toBe(usd.summary.orders); // counts do not convert
    expect(aed.summary.contributionMargin).not.toBeNull();
    // the trend still adds up to the converted headline
    const cents = (s: string) => Math.round(Number(s) * 100);
    expect(aed.trend.reduce((s, d) => s + cents(d.revenue), 0)).toBe(cents(aed.summary.revenue));
  });

  it('asking for the shop currency explicitly changes nothing', async () => {
    await calculateAll(a);
    const implicit = (await overview(ALL)).body;
    const explicit = (await overview(`${ALL}&currency=USD`)).body;
    expect(explicit).toEqual(implicit);
  });
});
