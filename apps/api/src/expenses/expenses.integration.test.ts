import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  auditResponseSchema,
  categoryListResponseSchema,
  expenseListResponseSchema,
  expenseSummaryResponseSchema,
  marketingResponseSchema,
  overviewResponseSchema,
  productListResponseSchema,
} from '@pi/contracts';
import {
  createDb,
  createPool,
  installShop,
  loadOrdersForProfit,
  replaceProfitEntries,
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
  a = await mk('exp-a.myshopify.com');
  await mk('exp-b.myshopify.com');
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

const call = (
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  token = 'id-exp-a',
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const json = async (...args: Parameters<typeof call>) => {
  const res = await call(...args);
  return { res, body: res.json() };
};
const cents = (s: string) => Math.round(Number(s) * 100);
const SEP = '?preset=custom&from=2026-09-01&to=2026-09-30';
const AUG = '?preset=custom&from=2026-08-01&to=2026-08-31';

async function category(name = 'Premises', token = 'id-exp-a') {
  const list = categoryListResponseSchema.parse(
    (await json('GET', '/expenses/categories', token)).body,
  );
  return list.categories.find((c) => c.name === name)!.id;
}
async function addExpense(over: Record<string, unknown> = {}, token = 'id-exp-a') {
  const categoryId = await category('Premises', token);
  const res = await json('POST', '/expenses', token, {
    name: 'Warehouse rent',
    categoryId,
    amount: '1000',
    kind: 'recurring',
    frequency: 'monthly',
    startDate: '2026-01-01',
    ...over,
  });
  return res;
}
const opex = async (qs: string, token?: string) =>
  overviewResponseSchema.parse((await json('GET', `/dashboard/overview${qs}`, token)).body).summary;

describe('expense categories', () => {
  it('starts with the standard categories, and adds custom ones without duplicates', async () => {
    const list = categoryListResponseSchema.parse((await json('GET', '/expenses/categories')).body);
    expect(list.categories.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'Premises',
        'Software',
        'Salaries',
        'Marketing',
        'Operations',
        'Other',
      ]),
    );
    const first = await json('POST', '/expenses/categories', 'id-exp-a', { name: 'Packaging' });
    expect(first.body.created).toBe(true);
    const again = await json('POST', '/expenses/categories', 'id-exp-a', { name: ' packaging ' });
    expect(again.body.created).toBe(false);
    expect(again.body.id).toBe(first.body.id);
    expect(
      categoryListResponseSchema
        .parse((await json('GET', '/expenses/categories')).body)
        .categories.filter((c) => c.name.toLowerCase() === 'packaging'),
    ).toHaveLength(1);
  });

  it('archiving hides a category but keeps its expenses labelled', async () => {
    const id = (await json('POST', '/expenses/categories', 'id-exp-a', { name: 'Temp' })).body.id;
    await addExpense({
      categoryId: id,
      name: 'Temp cost',
      kind: 'one_time',
      frequency: undefined,
      startDate: '2026-09-02',
    });
    expect((await call('DELETE', `/expenses/categories/${id}`)).statusCode).toBe(200);
    const cats = categoryListResponseSchema.parse((await json('GET', '/expenses/categories')).body);
    expect(cats.categories.some((c) => c.id === id)).toBe(false);
    const list = expenseListResponseSchema.parse((await json('GET', '/expenses')).body);
    expect(list.rows[0]!.category).toBe('Temp');
    // a new expense can no longer use it
    const res = await addExpense({ categoryId: id });
    expect(res.res.statusCode).toBe(404);
    expect((await call('DELETE', `/expenses/categories/${id}`)).statusCode).toBe(404);
  });

  it.each([[''], ['   '], ['x'.repeat(61)]])('rejects the name %j', async (name) => {
    expect((await call('POST', '/expenses/categories', 'id-exp-a', { name })).statusCode).toBe(400);
  });

  it('categories are per shop', async () => {
    await json('POST', '/expenses/categories', 'id-exp-a', { name: 'Only A' });
    const theirs = categoryListResponseSchema.parse(
      (await json('GET', '/expenses/categories', 'id-exp-b')).body,
    );
    expect(theirs.categories.some((c) => c.name === 'Only A')).toBe(false);
    const mine = categoryListResponseSchema.parse((await json('GET', '/expenses/categories')).body);
    expect(
      await call(
        'DELETE',
        `/expenses/categories/${mine.categories.find((c) => c.name === 'Only A')!.id}`,
        'id-exp-b',
      ).then((r) => r.statusCode),
    ).toBe(404);
  });
});

describe('expenses', () => {
  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/expenses' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/expenses', payload: {} })).statusCode,
    ).toBe(401);
  });

  it('creates a recurring and a one-time expense and lists them with next charge and this month', async () => {
    expect((await addExpense()).res.statusCode).toBe(201);
    const cat = await category('Software');
    expect(
      (
        await json('POST', '/expenses', 'id-exp-a', {
          name: 'Photography',
          categoryId: cat,
          amount: '450',
          kind: 'one_time',
          startDate: new Date().toISOString().slice(0, 10),
        })
      ).res.statusCode,
    ).toBe(201);
    const list = expenseListResponseSchema.parse((await json('GET', '/expenses')).body);
    expect(list.rows).toHaveLength(2);
    const rent = list.rows.find((r) => r.name === 'Warehouse rent')!;
    expect(rent).toMatchObject({
      kind: 'recurring',
      frequency: 'monthly',
      status: 'active',
      thisMonth: '1000.0000',
    });
    expect(rent.nextCharge).toMatch(/^\d{4}-\d{2}-01$/);
    const photo = list.rows.find((r) => r.name === 'Photography')!;
    expect(photo.nextCharge).toBeNull();
    expect(photo.thisMonth).toBe('450.0000');

    const only = expenseListResponseSchema.parse(
      (await json('GET', '/expenses?filter=one_time')).body,
    );
    expect(only.rows.map((r) => r.name)).toEqual(['Photography']);
    const found = expenseListResponseSchema.parse(
      (await json('GET', '/expenses?search=rent')).body,
    );
    expect(found.rows.map((r) => r.name)).toEqual(['Warehouse rent']);
  });

  it('a retried create request with the same key does not add a second expense', async () => {
    const key = 'retry-key-12345';
    const one = await addExpense({ requestKey: key });
    const two = await addExpense({ requestKey: key });
    expect(one.body.created).toBe(true);
    expect(two.body.created).toBe(false);
    expect(two.body.id).toBe(one.body.id);
    expect(
      expenseListResponseSchema.parse((await json('GET', '/expenses')).body).rows,
    ).toHaveLength(1);
    // the same key in another shop is independent
    const other = await addExpense({ requestKey: key }, 'id-exp-b');
    expect(other.body.created).toBe(true);
  });

  it.each([
    ['negative amount', { amount: '-5' }],
    ['text amount', { amount: 'lots' }],
    ['recurring without frequency', { frequency: undefined }],
    ['one-time that repeats', { kind: 'one_time', frequency: 'monthly' }],
    ['end before start', { endDate: '2025-12-31' }],
    ['unknown frequency', { frequency: 'weekly' }],
    ['empty name', { name: '  ' }],
    ['very long name', { name: 'x'.repeat(121) }],
    ['impossible date', { startDate: '2026-02-31' }],
    ['date years ahead', { startDate: '2999-01-01' }],
    ['ancient date', { startDate: '1980-01-01' }],
    ['malformed category id', { categoryId: 'not-a-uuid' }],
  ])('rejects %s and creates nothing', async (_l, over) => {
    const res = await addExpense(over);
    expect(res.res.statusCode).toBe(400);
    expect(expenseListResponseSchema.parse((await json('GET', '/expenses')).body).rows).toEqual([]);
  });

  it('rejects an unknown category and another shop category', async () => {
    const bCat = await category('Premises', 'id-exp-b');
    const res = await addExpense({ categoryId: bCat });
    expect(res.res.statusCode).toBe(404);
    const res2 = await addExpense({ categoryId: '00000000-0000-0000-0000-000000000000' });
    expect(res2.res.statusCode).toBe(404);
  });

  it('keeps expenses per shop; another shop cannot change, stop, remove or override them', async () => {
    const id = (await addExpense()).body.id;
    expect(
      expenseListResponseSchema.parse((await json('GET', '/expenses', 'id-exp-b')).body).rows,
    ).toEqual([]);
    expect(
      (
        await call('POST', `/expenses/${id}/change`, 'id-exp-b', {
          amount: '5',
          effectiveFrom: '2026-09-01',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/expenses/${id}/stop`, 'id-exp-b', { lastDay: '2026-09-30' }))
        .statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/expenses/${id}`, 'id-exp-b')).statusCode).toBe(404);
    expect(
      (await call('PUT', `/expenses/${id}/months/2026-09-01`, 'id-exp-b', { skip: true }))
        .statusCode,
    ).toBe(404);
    expect(
      expenseListResponseSchema.parse((await json('GET', '/expenses')).body).rows,
    ).toHaveLength(1);
    expect(
      auditResponseSchema.parse((await json('GET', '/expenses/history', 'id-exp-b')).body).rows,
    ).toEqual([]);
  });

  it('a change from September leaves August as it was and September at the new amount', async () => {
    const id = (await addExpense()).body.id;
    expect((await opex(AUG)).operatingExpenses).toBe('1000.0000');
    const change = await json('POST', `/expenses/${id}/change`, 'id-exp-a', {
      amount: '1500',
      effectiveFrom: '2026-09-01',
    });
    expect(change.res.statusCode).toBe(201);
    expect((await opex(AUG)).operatingExpenses).toBe('1000.0000');
    expect((await opex(SEP)).operatingExpenses).toBe('1500.0000');
    const list = expenseListResponseSchema.parse((await json('GET', '/expenses')).body);
    expect(list.rows.filter((r) => r.status === 'active')).toHaveLength(1);
    // history says what happened
    const hist = auditResponseSchema.parse((await json('GET', '/expenses/history')).body);
    expect(hist.rows[0]!.summary).toMatch(
      /Changed expense "Warehouse rent" to 1500 from 2026-09-01 \(was 1000\)/,
    );
  });

  it('a change that covers the whole life replaces the expense, with no duplicate charge', async () => {
    const id = (await addExpense()).body.id;
    await json('POST', `/expenses/${id}/change`, 'id-exp-a', {
      name: 'Rent (new lease)',
      effectiveFrom: '2025-01-01',
    });
    const rows = expenseListResponseSchema.parse((await json('GET', '/expenses')).body).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Rent (new lease)');
    expect((await opex(AUG)).operatingExpenses).toBe('1000.0000');
  });

  it('a one-time expense can be moved or re-amounted', async () => {
    const id = (
      await addExpense({ kind: 'one_time', frequency: undefined, startDate: '2026-08-10' })
    ).body.id;
    expect((await opex(AUG)).operatingExpenses).toBe('1000.0000');
    await json('POST', `/expenses/${id}/change`, 'id-exp-a', {
      amount: '700',
      effectiveFrom: '2026-09-10',
    });
    expect((await opex(AUG)).operatingExpenses).toBe('0.0000');
    expect((await opex(SEP)).operatingExpenses).toBe('700.0000');
  });

  it('month-specific edits change only that month and can be cleared', async () => {
    const id = (await addExpense()).body.id;
    expect(
      (await call('PUT', `/expenses/${id}/months/2026-09-01`, 'id-exp-a', { amount: '800' }))
        .statusCode,
    ).toBe(200);
    expect((await opex(SEP)).operatingExpenses).toBe('800.0000');
    expect((await opex(AUG)).operatingExpenses).toBe('1000.0000');
    expect(
      (await call('PUT', `/expenses/${id}/months/2026-08-01`, 'id-exp-a', { skip: true }))
        .statusCode,
    ).toBe(200);
    expect((await opex(AUG)).operatingExpenses).toBe('0.0000');
    const row = expenseListResponseSchema.parse((await json('GET', '/expenses')).body).rows[0]!;
    expect(row.overrides.map((o) => o.month)).toEqual(['2026-09-01', '2026-08-01']);
    expect((await call('DELETE', `/expenses/${id}/months/2026-09-01`)).statusCode).toBe(200);
    expect((await opex(SEP)).operatingExpenses).toBe('1000.0000');
    // saving the same month twice replaces, never adds
    await call('PUT', `/expenses/${id}/months/2026-09-01`, 'id-exp-a', { amount: '1' });
    await call('PUT', `/expenses/${id}/months/2026-09-01`, 'id-exp-a', { amount: '2' });
    expect((await opex(SEP)).operatingExpenses).toBe('2.0000');
  });

  it.each([
    ['not the first of the month', '2026-09-15', { amount: '5' }],
    ['negative amount', '2026-09-01', { amount: '-5' }],
    ['neither amount nor skip', '2026-09-01', {}],
    ['skip false', '2026-09-01', { skip: false }],
  ])('rejects a month edit that is %s', async (_l, month, body) => {
    const id = (await addExpense()).body.id;
    expect(
      (await call('PUT', `/expenses/${id}/months/${month}`, 'id-exp-a', body)).statusCode,
    ).toBe(400);
  });

  it('month edits only make sense for recurring expenses', async () => {
    const id = (
      await addExpense({ kind: 'one_time', frequency: undefined, startDate: '2026-09-02' })
    ).body.id;
    expect(
      (await call('PUT', `/expenses/${id}/months/2026-09-01`, 'id-exp-a', { skip: true }))
        .statusCode,
    ).toBe(400);
  });

  it('stopping ends it after the last day; removing erases it from every period', async () => {
    const id = (await addExpense()).body.id;
    expect(
      (await call('POST', `/expenses/${id}/stop`, 'id-exp-a', { lastDay: '2026-08-31' }))
        .statusCode,
    ).toBe(200);
    expect((await opex(AUG)).operatingExpenses).toBe('1000.0000');
    expect((await opex(SEP)).operatingExpenses).toBe('0.0000');
    expect(
      expenseListResponseSchema.parse((await json('GET', '/expenses')).body).rows[0]!.status,
    ).toBe('ended');
    expect((await call('DELETE', `/expenses/${id}`)).statusCode).toBe(200);
    expect((await opex(AUG)).operatingExpenses).toBeNull();
    expect((await call('DELETE', `/expenses/${id}`)).statusCode).toBe(404);
  });

  it('operating profit is contribution profit minus advertising and expenses, and says so when none are entered', async () => {
    await calculateAll(a);
    const none = await opex(ALL);
    expect(none.operatingProfitBasis).toBe('contribution_only');
    expect(none.estimatedOperatingProfit).toBeNull();
    expect(none.operatingMargin).toBeNull();
    await addExpense({ amount: '500' });
    const withExp = await opex(ALL);
    expect(withExp.operatingProfitBasis).toBe('full');
    expect(cents(withExp.estimatedOperatingProfit!)).toBe(
      cents(withExp.contributionProfit) - cents(withExp.operatingExpenses!),
    );
    expect(withExp.contributionProfit).toBe(none.contributionProfit);
  });

  it('the summary reports this month, recurring per month, the last six months and the share of revenue', async () => {
    await calculateAll(a);
    await addExpense({ amount: '1200' });
    await addExpense({
      name: 'Insurance',
      amount: '1200',
      frequency: 'yearly',
      startDate: '2026-03-01',
    });
    const s = expenseSummaryResponseSchema.parse((await json('GET', '/expenses/summary')).body);
    expect(s.months).toHaveLength(6);
    expect(s.months.at(-1)!.month.slice(0, 7)).toBe(s.today.slice(0, 7));
    expect(s.recurringCount).toBe(2);
    expect(s.recurringPerMonth).toBe('1300.0000'); // 1200 + 1200/12
    expect(
      s.months.every(
        (m) =>
          m.total === m.byCategory.reduce((x, c) => (x + cents(c.amount)) / 1, 0).toFixed(0) ||
          true,
      ),
    ).toBe(true);
    for (const m of s.months) {
      expect(cents(m.total)).toBe(m.byCategory.reduce((x, c) => x + cents(c.amount), 0));
    }
  });

  it('each month splits into recurring and one-time, and has its own share of revenue', async () => {
    await calculateAll(a);
    await addExpense({ amount: '1200' });
    await addExpense({
      name: 'Photos',
      kind: 'one_time',
      frequency: undefined,
      amount: '300',
      startDate: '2026-09-10',
    });
    const s = expenseSummaryResponseSchema.parse((await json('GET', '/expenses/summary')).body);
    for (const m of s.months) {
      expect(cents(m.recurring) + cents(m.oneTime)).toBe(cents(m.total));
      if (m.shareOfRevenue !== null) expect(Number(m.shareOfRevenue)).toBeGreaterThanOrEqual(0);
    }
    const sept = s.months.find((m) => m.month.startsWith('2026-09'));
    if (sept) {
      expect(sept.oneTime).toBe('300.0000');
      expect(sept.recurring).toBe('1200.0000');
    }
    // this month's card figures are the last point of the month series
    const last = s.months.at(-1)!;
    expect(last.total).toBe(s.thisMonth);
    expect(last.oneTime).toBe(s.oneTimeThisMonth);
  });

  it('each month has a profit and loss equal to the Overview for that month, and says when operating profit is not set up', async () => {
    await calculateAll(a);
    const none = expenseSummaryResponseSchema.parse((await json('GET', '/expenses/summary')).body);
    expect(none.operatingProfitStatus).toBe('not_configured');
    for (const m of none.months) expect(m.operatingProfit).toBeNull();

    await addExpense({ amount: '1200' });
    await addExpense({
      name: 'Photos',
      kind: 'one_time',
      frequency: undefined,
      amount: '300',
      startDate: '2026-09-10',
    });
    const s = expenseSummaryResponseSchema.parse((await json('GET', '/expenses/summary')).body);
    expect(['complete', 'incomplete']).toContain(s.operatingProfitStatus);
    expect(s.operatingProfitStatus === 'incomplete').toBe(s.months.some((m) => m.incomplete));
    for (const m of s.months) {
      const [y, mo] = m.month.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      expect(cents(m.operatingProfit!)).toBe(
        cents(m.contributionProfit) - cents(m.advertising ?? '0') - cents(m.total),
      );
      // a finished month equals the Overview for that month (the current month is still running,
      // so the Overview only counts its days so far)
      if (last >= s.today) continue;
      const o = await opex(`?preset=custom&from=${m.month}&to=${last}`);
      expect(m.revenue).toBe(o.revenue);
      expect(m.contributionProfit).toBe(o.contributionProfit);
      expect(m.operatingProfit).toBe(o.estimatedOperatingProfit);
      expect(m.incomplete).toBe(o.partial);
    }
  });

  it('records who did what in a readable history', async () => {
    const id = (await addExpense()).body.id;
    await call('PUT', `/expenses/${id}/months/2026-09-01`, 'id-exp-a', { amount: '800' });
    const hist = auditResponseSchema.parse((await json('GET', '/expenses/history')).body);
    const text = hist.rows.map((r) => r.summary).join(' | ');
    expect(text).toMatch(/Added expense "Warehouse rent" of 1000 \(monthly\) from 2026-01-01/);
    expect(text).toMatch(/Set "Warehouse rent" to 800 for 2026-09/);
    expect(hist.rows[0]!.actor).toBe('shopify-user:1');
  });
});

describe('expense details: reference, description and other currencies', () => {
  const list = async (qs = '', token?: string) =>
    expenseListResponseSchema.parse((await json('GET', `/expenses${qs}`, token)).body);
  // exchange rates are shared by every shop, so each test starts with none
  beforeEach(() => admin.query('truncate o_exchange_rate'));
  afterAll(() => admin.query('truncate o_exchange_rate'));
  const rate = (day: string, quote: string, value: string) =>
    admin.query(
      'insert into o_exchange_rate (quote, rate_date, rate, source) values ($1, $2, $3, $4) on conflict do nothing',
      [quote, day, value, 'test'],
    );

  it('keeps a reference and a description, finds the expense by them, and exports them', async () => {
    const created = await addExpense({
      name: 'Photo shoot',
      kind: 'one_time',
      frequency: undefined,
      startDate: '2026-09-10',
      reference: 'Invoice 1042',
      description: 'Autumn product photos, studio hire',
    });
    expect(created.res.statusCode).toBe(201);
    const all = await list();
    expect(all.rows[0]).toMatchObject({
      reference: 'Invoice 1042',
      description: 'Autumn product photos, studio hire',
      currency: 'USD',
      originalAmount: null,
      originalCurrency: null,
      fxEstimated: false,
    });
    expect((await list('?search=invoice%201042')).rows).toHaveLength(1);
    expect((await list('?search=studio')).rows).toHaveLength(1);
    expect((await list('?search=nothing-like-this')).rows).toHaveLength(0);

    const file = await json('GET', '/expenses/export');
    expect(file.res.statusCode).toBe(200);
    const lines = (file.body.csv as string).replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toContain('Reference');
    expect(lines[0]).toContain('Amount (USD)');
    expect(lines[1]).toContain('Photo shoot');
    expect(lines[1]).toContain('Invoice 1042');
  });

  it('refuses a reference or description that is empty or too long', async () => {
    for (const bad of [{ reference: 'x'.repeat(61) }, { description: 'y'.repeat(501) }]) {
      expect((await addExpense(bad)).res.statusCode).toBe(400);
    }
  });

  it('converts an expense in another currency once, at the rate of its date, and keeps the original', async () => {
    await rate('2026-09-10', 'USD', '1.1000000000'); // 1 EUR = 1.10 USD
    const res = await addExpense({
      name: 'EU supplier',
      kind: 'one_time',
      frequency: undefined,
      startDate: '2026-09-10',
      amount: '100',
      currency: 'EUR',
    });
    expect(res.res.statusCode).toBe(201);
    const row = (await list()).rows.find((r) => r.name === 'EU supplier')!;
    expect(row).toMatchObject({
      amount: '110.0000',
      currency: 'USD',
      originalAmount: '100.0000',
      originalCurrency: 'EUR',
      fxRateDate: '2026-09-10',
      fxEstimated: false,
    });
    expect(Number(row.fxRate)).toBeCloseTo(1.1, 8);
    // it counts in the month it is dated, in the shop currency
    const sep = expenseSummaryResponseSchema.parse((await json('GET', '/expenses/summary')).body);
    expect(sep.months.find((m) => m.month.startsWith('2026-09'))!.total).toBe('110.0000');
    // and the export shows both amounts and the rate
    const csv = (await json('GET', '/expenses/export')).body.csv as string;
    expect(csv).toContain('110.0000');
    expect(csv).toContain('EUR');
  });

  it('marks the conversion as an estimate when the rate is not from the day itself', async () => {
    await rate('2026-09-07', 'USD', '1.2000000000');
    const res = await addExpense({
      name: 'Old rate',
      kind: 'one_time',
      frequency: undefined,
      startDate: '2026-09-10',
      amount: '50',
      currency: 'EUR',
    });
    expect(res.res.statusCode).toBe(201);
    const row = (await list()).rows.find((r) => r.name === 'Old rate')!;
    expect(row.amount).toBe('60.0000');
    expect(row.fxRateDate).toBe('2026-09-07');
    expect(row.fxEstimated).toBe(true);
  });

  it('says so when there is no rate, and is not fooled by a bad code or the shop currency', async () => {
    const none = await addExpense({ amount: '10', currency: 'GBP', startDate: '2026-09-10' });
    expect(none.res.statusCode).toBe(400);
    expect(none.body.error.code).toBe('no_exchange_rate');
    expect((await addExpense({ currency: 'eur' })).res.statusCode).toBe(400);
    const same = await addExpense({ name: 'Same currency', currency: 'USD', amount: '25' });
    expect(same.res.statusCode).toBe(201);
    const row = (await list()).rows.find((r) => r.name === 'Same currency')!;
    expect(row).toMatchObject({ amount: '25.0000', originalAmount: null, originalCurrency: null });
  });

  it('changing the amount drops the foreign details; keeping it keeps them; the reference stays', async () => {
    await rate('2026-09-10', 'USD', '1.1000000000');
    const id = (
      await addExpense({
        name: 'Foreign monthly',
        amount: '100',
        currency: 'EUR',
        startDate: '2026-09-10',
        reference: 'PO-7',
      })
    ).body.id;
    const kept = await json('POST', `/expenses/${id}/change`, 'id-exp-a', {
      name: 'Foreign monthly (renamed)',
      effectiveFrom: '2026-10-01',
    });
    expect(kept.res.statusCode).toBeLessThan(300);
    let rows = (await list()).rows.filter((r) => r.name.startsWith('Foreign monthly'));
    const renamed = rows.find((r) => r.name.endsWith('(renamed)'))!;
    expect(renamed.reference).toBe('PO-7');
    expect(renamed.originalCurrency).toBe('EUR');
    const changed = await json('POST', `/expenses/${kept.body.id}/change`, 'id-exp-a', {
      amount: '130',
      effectiveFrom: '2026-11-01',
    });
    expect(changed.res.statusCode).toBeLessThan(300);
    rows = (await list()).rows.filter((r) => r.name.startsWith('Foreign monthly'));
    const latest = rows.find((r) => r.amount === '130.0000')!;
    expect(latest.reference).toBe('PO-7');
    expect(latest.originalCurrency).toBeNull();
  });

  it('filters by category and by status, and everything is per shop', async () => {
    await addExpense({
      name: 'Past',
      kind: 'one_time',
      frequency: undefined,
      startDate: '2026-01-05',
    });
    await addExpense({ name: 'Running', startDate: '2026-01-01' });
    const softwareId = await category('Software');
    await addExpense({ name: 'Tool', categoryId: softwareId, startDate: '2026-01-01' });
    const software = await list(`?categoryId=${softwareId}`);
    expect(software.rows.map((r) => r.name)).toEqual(['Tool']);
    const scheduled = await addExpense({ name: 'Soon', startDate: '2026-10-20' });
    expect(scheduled.res.statusCode).toBe(201);
    expect((await list('?status=scheduled')).rows.map((r) => r.name)).toEqual(['Soon']);
    expect((await list('?status=active')).rows.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Running', 'Tool']),
    );
    expect((await list('', 'id-exp-b')).rows).toEqual([]);
    expect((await call('GET', '/expenses?status=bogus')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/expenses/export' })).statusCode).toBe(
      401,
    );
  });
});

describe('what kind of cost a category holds', () => {
  const categories = async (token?: string) =>
    categoryListResponseSchema.parse((await json('GET', '/expenses/categories', token)).body)
      .categories;

  it('starts from the name: marketing is advertising, everything standard else is operating', async () => {
    const byName = Object.fromEntries((await categories()).map((c) => [c.name, c.class]));
    expect(byName.Marketing).toBe('advertising');
    expect(byName.Premises).toBe('operating');
    expect(byName.Salaries).toBe('operating');
  });

  it('a new category takes its class from its name unless one is given', async () => {
    await json('POST', '/expenses/categories', 'id-exp-a', { name: 'Courier and packaging' });
    await json('POST', '/expenses/categories', 'id-exp-a', { name: 'Stock purchases' });
    await json('POST', '/expenses/categories', 'id-exp-a', {
      name: 'Odd jobs',
      class: 'logistics',
    });
    const byName = Object.fromEntries((await categories()).map((c) => [c.name, c.class]));
    expect(byName['Courier and packaging']).toBe('logistics');
    expect(byName['Stock purchases']).toBe('product');
    expect(byName['Odd jobs']).toBe('logistics');
  });

  it('can be changed, is recorded in the history, and refuses an unknown class or another shop', async () => {
    const premises = (await categories()).find((c) => c.name === 'Premises')!;
    const res = await json('PUT', `/expenses/categories/${premises.id}`, 'id-exp-a', {
      class: 'logistics',
    });
    expect(res.res.statusCode).toBe(200);
    expect((await categories()).find((c) => c.id === premises.id)!.class).toBe('logistics');
    const hist = auditResponseSchema.parse((await json('GET', '/expenses/history')).body);
    expect(hist.rows[0]!.summary).toBe(
      'Set the cost class of the category "Premises" to logistics (was operating)',
    );
    expect(
      (await call('PUT', `/expenses/categories/${premises.id}`, 'id-exp-a', { class: 'nonsense' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', `/expenses/categories/${premises.id}`, 'id-exp-b', { class: 'product' }))
        .statusCode,
    ).toBe(404);
    // the other shop's category is untouched
    expect((await categories('id-exp-b')).find((c) => c.name === 'Premises')!.class).toBe(
      'operating',
    );
  });

  it('this month by class adds up to this month, and a class change moves the amount', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const premises = await category('Premises');
    const marketing = await category('Marketing');
    await addExpense({
      name: 'Rent',
      amount: '1000',
      categoryId: premises,
      kind: 'one_time',
      frequency: undefined,
      startDate: today,
    });
    await addExpense({
      name: 'Influencer',
      amount: '300',
      categoryId: marketing,
      kind: 'one_time',
      frequency: undefined,
      startDate: today,
    });
    const read = async () =>
      expenseSummaryResponseSchema.parse((await json('GET', '/expenses/summary')).body);
    const before = await read();
    const byClass = Object.fromEntries(before.thisMonthByClass.map((c) => [c.class, c.amount]));
    expect(byClass.operating).toBe('1000.0000');
    expect(byClass.advertising).toBe('300.0000');
    expect(before.thisMonthByClass.reduce((s, c) => s + cents(c.amount), 0)).toBe(
      cents(before.thisMonth),
    );
    await json('PUT', `/expenses/categories/${premises}`, 'id-exp-a', { class: 'product' });
    const after = await read();
    expect(after.thisMonthByClass.find((c) => c.class === 'product')!.amount).toBe('1000.0000');
    expect(after.thisMonth).toBe(before.thisMonth); // reclassifying never changes the total
  });
});

describe('advertising', () => {
  const account = async (name = 'Meta manual', token?: string) =>
    (await json('POST', '/marketing/accounts', token, { provider: 'manual', name })).body;
  const spend = (id: string, rows: unknown[], token?: string) =>
    json('POST', `/marketing/accounts/${id}/spend`, token, { rows });
  const marketing = async (qs = SEP, token?: string) =>
    marketingResponseSchema.parse((await json('GET', `/marketing/overview${qs}`, token)).body);

  it('lists providers and says plainly which cannot be connected yet', async () => {
    const { body } = await json('GET', '/marketing/providers');
    const by = (id: string) => body.providers.find((p: { id: string }) => p.id === id);
    for (const id of ['manual', 'meta', 'google']) expect(by(id).available).toBe(true);
    expect(by('tiktok').available).toBe(false);
    expect(by('tiktok').note.length).toBeGreaterThan(10);
  });

  it('refuses TikTok, asks Meta and Google for an account id and token, and does not duplicate an account', async () => {
    const tiktok = await json('POST', '/marketing/accounts', 'id-exp-a', {
      provider: 'tiktok',
      name: 'TikTok',
    });
    expect(tiktok.res.statusCode).toBe(400);
    expect(tiktok.body.error.code).toBe('provider_not_available');
    const meta = await json('POST', '/marketing/accounts', 'id-exp-a', {
      provider: 'meta',
      name: 'Meta',
    });
    expect(meta.res.statusCode).toBe(400);
    expect(meta.body.error.code).toBe('invalid_input');
    const one = await account('Manual spend');
    const two = await account('manual SPEND');
    expect(one.created).toBe(true);
    expect(two.created).toBe(false);
    expect((await marketing()).accounts).toHaveLength(1);
  });

  it('saves daily spend and reports totals, channels, campaigns and a full daily series', async () => {
    const { id } = await account();
    const res = await spend(id, [
      {
        date: '2026-09-01',
        campaign: 'Autumn',
        spend: '100.50',
        reportedSales: '400',
        clicks: 30,
        impressions: 1000,
      },
      { date: '2026-09-02', campaign: 'Autumn', spend: '120', reportedSales: '300' },
      { date: '2026-09-02', campaign: 'Brand', spend: '40' },
    ]);
    expect(res.res.statusCode).toBe(201);
    const m = await marketing();
    expect(m.totals).toMatchObject({
      spend: '260.5000',
      platformReportedSales: '700.0000',
      hasData: true,
    });
    expect(m.channels[0]).toMatchObject({ spend: '260.5000', clicks: 30, impressions: 1000 });
    expect(m.campaigns.map((c) => c.campaign)).toEqual(['Autumn', 'Brand']);
    expect(m.campaigns[0]!.platformReturn).toBe('3.17'); // (400+300) / (100.50+120)
    expect(m.daily).toHaveLength(30);
    expect(m.daily.reduce((s, d) => s + cents(d.spend), 0)).toBe(26050);
    // the next month has none
    expect((await marketing('?preset=custom&from=2026-08-01&to=2026-08-31')).totals.hasData).toBe(
      false,
    );
  });

  it('saving the same days again replaces them: spend is never counted twice', async () => {
    const { id } = await account();
    const rows = [{ date: '2026-09-01', campaign: 'A', spend: '100' }];
    await spend(id, rows);
    await spend(id, rows);
    await spend(id, [{ date: '2026-09-01', campaign: 'A', spend: '60' }]);
    expect((await marketing()).totals.spend).toBe('60.0000');
  });

  it('ad spend lowers operating profit, never contribution profit, and everything still reconciles', async () => {
    await calculateAll(a);
    await addExpense({ amount: '500' });
    const before = await opex(ALL);
    const { id } = await account();
    await spend(id, [
      { date: '2026-09-05', spend: '250.25' },
      { date: '2026-09-06', spend: '100' },
    ]);
    const after = await opex(ALL);
    expect(after.adSpend).toBe('350.2500');
    expect(after.contributionProfit).toBe(before.contributionProfit);
    expect(cents(before.estimatedOperatingProfit!) - cents(after.estimatedOperatingProfit!)).toBe(
      35025,
    );
    expect(cents(after.estimatedOperatingProfit!)).toBe(
      cents(after.contributionProfit) - cents(after.adSpend!) - cents(after.operatingExpenses!),
    );
    // the trend still adds up to the headline
    const o = overviewResponseSchema.parse((await json('GET', `/dashboard/overview${ALL}`)).body);
    expect(o.trend.reduce((s, d) => s + cents(d.contributionProfit), 0)).toBe(
      cents(o.summary.contributionProfit),
    );
    // products plus unallocated items equal contribution profit; advertising is not one of them
    let page = 1;
    let last;
    for (;;) {
      last = productListResponseSchema.parse(
        (
          await json(
            'GET',
            `/profitability/products?preset=custom&from=2026-01-01&to=2026-10-09&pageSize=100&page=${page}`,
          )
        ).body,
      );
      if (page >= last.paging.totalPages) break;
      page++;
    }
    expect(last.reconciliation.unallocated).not.toHaveProperty('advertising');
    expect(last.reconciliation.matches).toBe(true);
    expect(last.reconciliation.dashboardContributionProfit).toBe(after.contributionProfit);
    // marketing shows the same figure
    const m = await marketing(ALL);
    expect(m.totals.contributionProfit).toBe(before.contributionProfit);
    expect(cents(m.totals.contributionProfit) - cents(m.totals.profitAfterAds)).toBe(35025);
    expect(m.totals.blendedReturn).not.toBeNull();
  });

  it('removing an account removes its spend from every figure', async () => {
    await calculateAll(a);
    const { id } = await account();
    await spend(id, [{ date: '2026-09-05', spend: '500' }]);
    expect((await opex(ALL)).adSpend).toBe('500.0000');
    expect((await call('DELETE', `/marketing/accounts/${id}`)).statusCode).toBe(200);
    expect((await opex(ALL)).adSpend).toBeNull();
    expect((await call('DELETE', `/marketing/accounts/${id}`)).statusCode).toBe(404);
    expect((await spend(id, [{ date: '2026-09-05', spend: '1' }])).res.statusCode).toBe(404);
  });

  it.each([
    ['negative spend', [{ date: '2026-09-01', spend: '-1' }]],
    ['text spend', [{ date: '2026-09-01', spend: 'a lot' }]],
    ['bad date', [{ date: '2026-02-31', spend: '1' }]],
    ['future date', [{ date: '2999-01-01', spend: '1' }]],
    ['ancient date', [{ date: '1980-01-01', spend: '1' }]],
    [
      'duplicate day and campaign',
      [
        { date: '2026-09-01', spend: '1' },
        { date: '2026-09-01', spend: '2' },
      ],
    ],
    ['no rows', []],
    ['negative clicks', [{ date: '2026-09-01', spend: '1', clicks: -3 }]],
    ['fractional clicks', [{ date: '2026-09-01', spend: '1', clicks: 1.5 }]],
  ])('rejects %s', async (_l, rows) => {
    const { id } = await account();
    const res = await spend(id, rows as unknown[]);
    expect(res.res.statusCode).toBe(400);
    expect((await marketing()).totals.hasData).toBe(false);
  });

  it('rejects more rows than the limit', async () => {
    const { id } = await account();
    const rows = Array.from({ length: 401 }, (_, i) => ({
      date: '2026-09-01',
      campaign: `c${i}`,
      spend: '1',
    }));
    expect((await spend(id, rows)).res.statusCode).toBe(400);
  });

  it('keeps accounts and spend per shop', async () => {
    const { id } = await account();
    await spend(id, [{ date: '2026-09-01', spend: '100' }]);
    expect((await marketing(SEP, 'id-exp-b')).accounts).toEqual([]);
    expect((await marketing(SEP, 'id-exp-b')).totals.spend).toBe('0.0000');
    expect(
      (await spend(id, [{ date: '2026-09-01', spend: '999' }], 'id-exp-b')).res.statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/marketing/accounts/${id}`, 'id-exp-b')).statusCode).toBe(404);
    expect((await marketing()).totals.spend).toBe('100.0000');
  });

  it('rejects bad queries and ids and requires a session', async () => {
    expect((await call('GET', '/marketing/overview?preset=custom')).statusCode).toBe(400);
    expect(
      (await call('POST', '/marketing/accounts/abc/spend', 'id-exp-a', { rows: [] })).statusCode,
    ).toBe(400);
    expect((await call('POST', '/marketing/accounts', 'id-exp-a', { name: '' })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/marketing/overview' })).statusCode,
    ).toBe(401);
  });
});
