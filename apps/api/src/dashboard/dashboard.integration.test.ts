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
  upsertExchangeRates,
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
    // 30 days is longer than 14, so the chart is weekly by default: 4 blocks of 7 days and one of 2
    expect(parsed.trendInterval).toBe('week');
    expect(parsed.trend).toHaveLength(5);
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
    // 282 days is longer than 90, so the chart is weekly: 40 blocks of 7 days and one of 2
    expect(o.trendInterval).toBe('week');
    expect(o.trend).toHaveLength(Math.ceil(o.period.days / 7));
    expect(o.trend[0]!.date).toBe(o.period.from);
    expect(o.trend.at(-1)!.to).toBe(o.period.to);
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

  it('splits payment fees into reported and estimated, in every currency, and in the trend', async () => {
    await calculateAll(a);
    for (const qs of [ALL, `${ALL}&currency=AED`, `${ALL}&interval=month`]) {
      const o = overviewResponseSchema.parse((await overview(qs)).body);
      const cents = (v: string) => Math.round(Number(v) * 100);
      // the two parts add up to the fees in the summary, to the cent
      expect(cents(o.fees.actual) + cents(o.fees.estimated)).toBe(cents(o.summary.paymentFees));
      // the fixture has a fee rule, so some fees are estimates, and never more than all of them
      expect(cents(o.fees.estimated)).toBeGreaterThan(0);
      expect(Number(o.fees.estimatedShare)).toBeGreaterThan(0);
      expect(Number(o.fees.estimatedShare)).toBeLessThanOrEqual(1);
      // the trend carries the same estimated amount and never more than the costs of a point
      const trendTotal = o.trend.reduce((a, t) => a + cents(t.estimatedFees), 0);
      expect(Math.abs(trendTotal - cents(o.fees.estimated))).toBeLessThanOrEqual(o.trend.length);
      for (const t of o.trend) expect(cents(t.estimatedFees)).toBeLessThanOrEqual(cents(t.costs));
    }
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
      costs: null,
      orders: null,
      averageOrderValue: null,
      marginPoints: null,
      basis: 'contribution',
      basisNote: null,
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
    ['unknown preset', '?preset=fortnight'],
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
    const days = usd.period.days;
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

// ---------------------------------------------------------------------------------------------
// Advertising, currency and comparisons agree between the headline figure and the chart
// ---------------------------------------------------------------------------------------------

const post = (url: string, payload: unknown, token = 'id-dash-a') =>
  app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as object,
  });
const centsOf = (s: string) => Math.round(Number(s) * 100);

async function addSpend(rows: Array<{ date: string; spend: string }>, name = 'M') {
  const created = await post('/marketing/accounts', { provider: 'manual', name });
  const id = created.json().id as string;
  const res = await post(`/marketing/accounts/${id}/spend`, { rows });
  expect(res.statusCode).toBeLessThan(300);
  return id;
}

describe('advertising in the headline figure and the chart', () => {
  it('the chart adds up to contribution profit once advertising exists (shop currency)', async () => {
    await calculateAll(a);
    await addSpend([
      { date: '2026-09-05', spend: '250.50' },
      { date: '2026-09-06', spend: '10.01' },
      { date: '2026-10-02', spend: '99.99' },
    ]);
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(o.summary.statuses.advertising).toBe('confirmed');
    expect(o.summary.adSpend).toBe('360.5000');
    expect(o.trend.reduce((s, d) => s + centsOf(d.contributionProfit), 0)).toBe(
      centsOf(o.summary.contributionProfit),
    );
    expect(centsOf(o.summary.contributionBeforeAds) - centsOf(o.summary.adSpend!)).toBe(
      centsOf(o.summary.contributionProfit),
    );
  });

  it('with a display currency the chart still adds up to the headline, advertising included', async () => {
    await calculateAll(a);
    // two accounts spending on the same day, amounts that do not convert to whole cents
    await addSpend([{ date: '2026-09-05', spend: '10.01' }], 'A');
    await addSpend([{ date: '2026-09-05', spend: '20.03' }], 'B');
    await addSpend([{ date: '2026-10-02', spend: '33.33' }], 'C');
    const aed = overviewResponseSchema.parse((await overview(`${ALL}&currency=AED`)).body);
    expect(aed.currency.converted).toBe(true);
    expect(aed.trend.reduce((s, d) => s + centsOf(d.contributionProfit), 0)).toBe(
      centsOf(aed.summary.contributionProfit),
    );
    expect(aed.trend.reduce((s, d) => s + centsOf(d.revenue), 0)).toBe(
      centsOf(aed.summary.revenue),
    );
    // advertising on the day is converted once per day, so the headline and the chart share it
    expect(centsOf(aed.summary.contributionBeforeAds) - centsOf(aed.summary.adSpend!)).toBe(
      centsOf(aed.summary.contributionProfit),
    );
    // within a cent per spending day of the exact peg conversion of 63.37 USD
    expect(Math.abs(Number(aed.summary.adSpend) - 63.37 * 3.6725)).toBeLessThan(0.05);
  });
});

describe('profit change is compared like for like', () => {
  it('compares contribution profit when advertising status is the same in both periods', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-09-01&to=2026-09-30')).body,
    );
    expect(o.deltas.basis).toBe('contribution');
    expect(o.deltas.basisNote).toBeNull();
  });

  it('compares before advertising when only one of the two periods has advertising data', async () => {
    await calculateAll(a);
    await addSpend([{ date: '2026-09-05', spend: '500.00' }]); // September has spend, August does not
    const o = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-09-01&to=2026-09-30')).body,
    );
    expect(o.summary.statuses.advertising).toBe('confirmed');
    expect(o.previous.statuses.advertising).not.toBe('confirmed');
    expect(o.deltas.basis).toBe('before_advertising');
    expect(o.deltas.basisNote).toMatch(/before advertising/);
    // the change must not include the 500.00 of spend
    const expected =
      Number(o.previous.contributionBeforeAds) === 0
        ? null
        : (Number(o.summary.contributionBeforeAds) - Number(o.previous.contributionBeforeAds)) /
          Math.abs(Number(o.previous.contributionBeforeAds));
    if (expected === null) expect(o.deltas.contributionProfit).toBeNull();
    else expect(o.deltas.contributionProfit).toBeCloseTo(expected, 6);
  });

  it('a zero baseline gives no percentage, never infinity', async () => {
    await calculateAll(a);
    // the first orders are in the spring: the 30 days before them have nothing
    const o = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-01-01&to=2026-01-31')).body,
    );
    if (Number(o.previous.revenue) === 0) expect(o.deltas.revenue).toBeNull();
    for (const v of Object.values(o.deltas)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('calendar periods through the API', () => {
  it.each(['today', 'yesterday', 'this_month', 'previous_month'] as const)(
    '%s returns a consistent period with an equivalent previous period',
    async (preset) => {
      await calculateAll(a);
      const o = overviewResponseSchema.parse((await overview(`?preset=${preset}`)).body);
      expect(o.period.preset).toBe(preset);
      // the points cover the period from its first day to its last, with no gap
      expect(o.trend[0]!.date).toBe(o.period.from);
      expect(o.trend.at(-1)!.to).toBe(o.period.to);
      expect(o.previousPeriod.to < o.period.from).toBe(true);
      if (preset === 'today' || preset === 'yesterday') {
        expect(o.period.days).toBe(1);
        expect(o.previousPeriod.from).toBe(o.previousPeriod.to);
      }
      if (preset === 'previous_month') {
        expect(o.period.from.endsWith('-01')).toBe(true);
        expect(o.previousPeriod.from.endsWith('-01')).toBe(true);
      }
    },
  );
});

describe('data completeness and issues', () => {
  it('reports each input with its counts and every issue once, with a working destination', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    const q = o.dataQuality;

    // product cost: shares of sales value that add up to the whole
    expect(q.cost).not.toBeNull();
    const parts = [q.cost!.confirmed, q.cost!.estimated, q.cost!.missing].map(Number);
    expect(Math.abs(parts[0]! + parts[1]! + parts[2]! - 1)).toBeLessThan(0.001);
    // the issue and the summary describe the same share
    expect(o.summary.confidence.components.cost?.shares.missing).toBe(q.cost!.missing);

    // fees and shipping: counts of orders; every counted order is in exactly one bucket
    for (const c of [q.fees, q.shipping]) {
      if (c) expect(c.confirmed + c.estimated + c.missing).toBeGreaterThan(0);
    }
    // the fixture has no shipping rule and no advertising or expenses
    expect(q.shipping!.missing).toBeGreaterThan(0);
    expect(q.advertising).toBe('not_configured');
    expect(q.operatingExpenses).toBe('not_configured');

    const ids = o.issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'missing_shipping_cost',
        'advertising_not_set_up',
        'expenses_not_set_up',
      ]),
    );
    const shipping = o.issues.find((i) => i.id === 'missing_shipping_cost')!;
    expect(shipping.title).toContain(`${q.shipping!.missing} of`);
    for (const i of o.issues) {
      expect(i.action.href).toMatch(/^(#sync|\/(settings|marketing|expenses)(\?.*)?)$/);
    }
    // most severe first
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const order = o.issues.map((i) => rank[i.severity]);
    expect(order).toEqual([...order].sort());
  });

  it('issues change with the inputs: advertising and expenses disappear once they exist', async () => {
    await calculateAll(a);
    await addSpend([{ date: '2026-09-05', spend: '10.00' }]);
    const cat = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/expenses/categories',
        headers: { authorization: 'Bearer id-dash-a' },
      })
    ).json().categories[0].id;
    await post('/expenses', {
      name: 'Rent',
      categoryId: cat,
      amount: '1000',
      kind: 'recurring',
      frequency: 'monthly',
      startDate: '2026-01-01',
    });
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(o.dataQuality.advertising).toBe('confirmed');
    expect(o.dataQuality.operatingExpenses).toBe('confirmed');
    const ids = o.issues.map((i) => i.id);
    expect(ids).not.toContain('advertising_not_set_up');
    expect(ids).not.toContain('expenses_not_set_up');
    expect(ids).toContain('missing_shipping_cost'); // still unresolved
  });

  it('an empty shop still lists what is not set up', async () => {
    const o = overviewResponseSchema.parse((await overview('?preset=7d', 'id-dash-b')).body);
    expect(o.summary.orders).toBe(0);
    expect(o.dataQuality.cost).toBeNull();
    expect(o.dataQuality.fees).toBeNull();
    expect(o.issues.map((i) => i.id)).toEqual(
      expect.arrayContaining(['advertising_not_set_up', 'expenses_not_set_up']),
    );
  });
});

describe('the trend series', () => {
  it('is daily for a period of 14 days or less, one point per day', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-07-01&to=2026-07-14')).body,
    ); // 14 days
    expect(o.period.days).toBe(14);
    expect(o.trendInterval).toBe('day');
    expect(o.trend).toHaveLength(14);
    expect(o.trend.every((p) => p.date === p.to)).toBe(true);
  });

  it('is weekly beyond 14 days, and the points still add up to the headline figures', async () => {
    await calculateAll(a);
    await addSpend([
      { date: '2026-03-03', spend: '120.25' },
      { date: '2026-09-05', spend: '80.10' },
    ]);
    for (const qs of [ALL, `${ALL}&currency=AED`]) {
      const o = overviewResponseSchema.parse((await overview(qs)).body);
      expect(o.trendInterval).toBe('week');
      expect(o.trend.reduce((s, p) => s + centsOf(p.revenue), 0)).toBe(centsOf(o.summary.revenue));
      expect(o.trend.reduce((s, p) => s + centsOf(p.contributionProfit), 0)).toBe(
        centsOf(o.summary.contributionProfit),
      );
      expect(o.trend.reduce((s, p) => s + p.orders, 0)).toBe(o.summary.orders);
      // blocks are contiguous: each starts the day after the previous one ended
      for (let i = 1; i < o.trend.length; i++) {
        const prevEnd = new Date(`${o.trend[i - 1]!.to}T00:00:00Z`).getTime() + 86_400_000;
        expect(new Date(`${o.trend[i]!.date}T00:00:00Z`).getTime()).toBe(prevEnd);
      }
    }
  });

  it('a day without orders is a real zero, not a gap and not invented', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-01-01&to=2026-01-20')).body,
    );
    const quiet = o.trend.filter((p) => p.orders === 0);
    expect(quiet.length).toBeGreaterThan(0);
    for (const p of quiet) expect(Number(p.revenue)).toBe(0);
  });
});

describe('costs and channels', () => {
  it('costs are revenue less contribution profit, on the card, the chart and the days', async () => {
    await calculateAll(a);
    await addSpend([{ date: '2026-09-05', spend: '77.77' }]);
    for (const qs of [ALL, `${ALL}&currency=AED`]) {
      const o = overviewResponseSchema.parse((await overview(qs)).body);
      expect(centsOf(o.summary.revenue) - centsOf(o.summary.contributionProfit)).toBe(
        centsOf(o.summary.totalCosts),
      );
      // each point of the chart is revenue less profit too, and the points add up to the card
      for (const p of o.trend) {
        expect(centsOf(p.revenue) - centsOf(p.contributionProfit)).toBe(centsOf(p.costs));
      }
      expect(o.trend.reduce((s, p) => s + centsOf(p.costs), 0)).toBe(centsOf(o.summary.totalCosts));
      // costs are product cost + fees + shipping + advertising
      const parts =
        centsOf(o.summary.cogs) +
        centsOf(o.summary.paymentFees) +
        centsOf(o.summary.shippingCost) +
        centsOf(o.summary.adSpend!);
      expect(Math.abs(parts - centsOf(o.summary.totalCosts))).toBeLessThanOrEqual(
        qs === ALL ? 0 : 5, // converted amounts can differ by a rounding cent per day
      );
    }
  });

  it('the channels add up to the headline revenue exactly, in either currency', async () => {
    await calculateAll(a);
    for (const qs of [ALL, `${ALL}&currency=AED`]) {
      const o = overviewResponseSchema.parse((await overview(qs)).body);
      expect(o.channels.length).toBeGreaterThan(0);
      expect(o.channels.reduce((s, c) => s + centsOf(c.revenue), 0)).toBe(
        centsOf(o.summary.revenue),
      );
      const keys = o.channels.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      // largest first
      const amounts = o.channels.map((c) => centsOf(c.revenue));
      expect(amounts).toEqual([...amounts].sort((x, y) => y - x));
      if (Number(o.summary.revenue) > 0) {
        const shares = o.channels.reduce((s, c) => s + Number(c.share), 0);
        expect(Math.abs(shares - 1)).toBeLessThan(0.001);
      }
    }
  });

  it('the orders of the channels add up to the order count of the period', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(o.channels.reduce((s, c) => s + c.orders, 0)).toBe(o.summary.orders);
  });

  it('a shorter period has channels that add up to its own revenue', async () => {
    await calculateAll(a);
    const o = overviewResponseSchema.parse(
      (await overview('?preset=custom&from=2026-07-01&to=2026-07-31')).body,
    );
    expect(o.channels.reduce((s, c) => s + centsOf(c.revenue), 0)).toBe(centsOf(o.summary.revenue));
  });

  it('an empty shop has no channels', async () => {
    const o = overviewResponseSchema.parse((await overview('?preset=7d', 'id-dash-b')).body);
    expect(o.channels).toEqual([]);
    expect(o.summary.totalCosts).toBe('0.0000');
    expect(o.deltas.costs).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Any currency: the stored ECB reference rates, crossed through the euro
// ---------------------------------------------------------------------------------------------

async function storeRates(rows: Array<{ date: string; quote: string; rate: string }>) {
  await admin.query('truncate o_exchange_rate');
  await upsertExchangeRates(db, rows, 'test');
}

/** every day of 2026 up to 9 October has a EUR/USD of 1.10 and EUR/GBP of 0.85, EUR/INR 95 */
function yearOfRates() {
  const rows: Array<{ date: string; quote: string; rate: string }> = [];
  for (
    let d = new Date('2025-12-20T00:00:00Z');
    d <= new Date('2026-10-09T00:00:00Z');
    d = new Date(d.getTime() + 86_400_000)
  ) {
    const day = d.toISOString().slice(0, 10);
    if ([0, 6].includes(d.getUTCDay())) continue; // the ECB does not publish on weekends
    rows.push({ date: day, quote: 'USD', rate: '1.1000000000' });
    rows.push({ date: day, quote: 'GBP', rate: '0.8500000000' });
    rows.push({ date: day, quote: 'INR', rate: '95.0000000000' });
  }
  return rows;
}

describe('display currencies from the exchange rates', () => {
  it('offers only the peg partner while no rates are stored, and refuses a currency with no rate', async () => {
    await admin.query('truncate o_exchange_rate');
    await calculateAll(a);
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(o.currency.available).toEqual(['USD', 'AED']);
    const res = await overview(`${ALL}&currency=GBP`);
    expect(res.res.statusCode).toBe(400);
  });

  it('offers every currency the stored rates can price, the shop currency first', async () => {
    await storeRates(yearOfRates());
    await calculateAll(a);
    const o = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(o.currency.available[0]).toBe('USD');
    expect(o.currency.available).toEqual(
      expect.arrayContaining(['USD', 'AED', 'EUR', 'GBP', 'INR']),
    );
    expect(new Set(o.currency.available).size).toBe(o.currency.available.length);
  });

  it('shows the figures in euros at the rate of each day, and the chart still adds up', async () => {
    await storeRates(yearOfRates());
    await calculateAll(a);
    await addSpend([{ date: '2026-09-07', spend: '100.00' }]);
    const usd = overviewResponseSchema.parse((await overview(ALL)).body);
    const eur = overviewResponseSchema.parse((await overview(`${ALL}&currency=EUR`)).body);
    expect(eur.currency).toMatchObject({ code: 'EUR', shopCode: 'USD', converted: true });
    expect(eur.currency.note).toContain('ECB');
    // 1 EUR = 1.10 USD all year, so each amount is its USD amount divided by 1.1, within a cent a day
    const days = usd.period.days;
    expect(Math.abs(Number(eur.summary.revenue) - Number(usd.summary.revenue) / 1.1)).toBeLessThan(
      0.01 * days,
    );
    expect(eur.summary.orders).toBe(usd.summary.orders); // counts do not convert
    // the chart and the channels add up to the converted headline, advertising included
    expect(eur.trend.reduce((s, p) => s + centsOf(p.revenue), 0)).toBe(
      centsOf(eur.summary.revenue),
    );
    expect(eur.trend.reduce((s, p) => s + centsOf(p.contributionProfit), 0)).toBe(
      centsOf(eur.summary.contributionProfit),
    );
    expect(eur.channels.reduce((s, c) => s + centsOf(c.revenue), 0)).toBe(
      centsOf(eur.summary.revenue),
    );
  });

  it('crosses two non-euro currencies through the euro (USD to GBP and to INR)', async () => {
    await storeRates(yearOfRates());
    await calculateAll(a);
    const usd = overviewResponseSchema.parse((await overview(ALL)).body);
    const gbp = overviewResponseSchema.parse((await overview(`${ALL}&currency=GBP`)).body);
    const inr = overviewResponseSchema.parse((await overview(`${ALL}&currency=INR`)).body);
    // USD to GBP = 0.85 / 1.10, USD to INR = 95 / 1.10
    expect(
      Math.abs(Number(gbp.summary.revenue) - (Number(usd.summary.revenue) * 0.85) / 1.1),
    ).toBeLessThan(0.01 * usd.period.days);
    expect(
      Math.abs(Number(inr.summary.revenue) - (Number(usd.summary.revenue) * 95) / 1.1),
    ).toBeLessThan(0.01 * usd.period.days);
  });

  it('a period the stored rates do not reach falls back to the shop currency and says why', async () => {
    // rates exist only for the last few days, but the period starts in January
    await storeRates(yearOfRates().filter((r) => r.date >= '2026-10-01'));
    await calculateAll(a);
    const o = overviewResponseSchema.parse((await overview(`${ALL}&currency=EUR`)).body);
    expect(o.currency.converted).toBe(false);
    expect(o.currency.code).toBe('USD');
    expect(o.currency.note).toMatch(/No exchange rate|rate/);
  });

  it('AED still uses the fixed peg, with or without stored rates', async () => {
    await storeRates(yearOfRates());
    await calculateAll(a);
    const usd = overviewResponseSchema.parse((await overview(ALL)).body);
    const aed = overviewResponseSchema.parse((await overview(`${ALL}&currency=AED`)).body);
    expect(aed.currency.converted).toBe(true);
    expect(aed.currency.note).toContain('peg');
    expect(
      Math.abs(Number(aed.summary.revenue) - Number(usd.summary.revenue) * 3.6725),
    ).toBeLessThan(0.01 * usd.period.days + 0.01);
  });
});
