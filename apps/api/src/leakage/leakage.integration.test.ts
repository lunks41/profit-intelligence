import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  auditResponseSchema,
  leakageResponseSchema,
  overviewResponseSchema,
  rulesResponseSchema,
} from '@pi/contracts';
import {
  createDb,
  createPool,
  installShop,
  loadOrdersForProfit,
  replaceProfitEntries,
  upsertOrders,
  upsertProducts,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { calculateOrder } from '@pi/profit-engine';
import type { EngineConfig, EngineOrder } from '@pi/profit-engine';
import { AuthError, mapOrder, mapProduct } from '@pi/shopify';
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

const productNodes = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shopify/test/fixtures/products-page.json', import.meta.url),
    'utf8',
  ),
).products.nodes as Record<string, unknown>[];

/** The fixture orders again under new Shopify ids (products and variants are kept, so costs still apply). */
function cloneNodes(nodes: Record<string, unknown>[], copies: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let k = 0; k < copies; k++) {
    const text = JSON.stringify(nodes).replace(
      /gid:\/\/shopify\/(\w+)\/(\d+)/g,
      (m, type: string, id: string) =>
        ['Product', 'ProductVariant', 'InventoryItem', 'Location'].includes(type) || k === 0
          ? m
          : `gid://shopify/${type}/${BigInt(id) + BigInt(k) * 1_000_000_000_000n}`,
    );
    out.push(...(JSON.parse(text) as Record<string, unknown>[]));
  }
  return out;
}

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
const send = vi.fn(async (..._a: unknown[]) => 'job');
const fakeBoss = { send, stop: async () => {} };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);

let app: NestFastifyApplication;
let a: InstallResult;

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

async function calculateAll(who: InstallResult, copies = 1) {
  await withTenant(db, who.tenantId, (tx) =>
    upsertOrders(tx, who, cloneNodes(orderNodes, copies).map(mapOrder)),
  );
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
  a = await mk('lk-a.myshopify.com');
  await mk('lk-b.myshopify.com');
  send.mockClear();
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

const call = (
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  token = 'id-lk-a',
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
const P = 'preset=custom&from=2026-01-01&to=2026-10-09';
const leak = async (qs = P, token?: string) =>
  leakageResponseSchema.parse((await json('GET', `/leakage?${qs}`, token)).body);
const overview = async () =>
  overviewResponseSchema.parse((await json('GET', `/dashboard/overview?${P}`)).body);
const setLimits = (over: Record<string, string> = {}, token = 'id-lk-a') =>
  call('PUT', '/settings/limits', token, {
    marginPct: '20',
    refundRatePct: '10',
    costChangePct: '10',
    ...over,
  });
const byId = (f: { findings: Array<{ id: string }> }, id: string) =>
  f.findings.find((x) => x.id === id) as ReturnType<
    typeof leakageResponseSchema.parse
  >['findings'][number];

describe('profit leakage findings', () => {
  it('requires a session and a valid period', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/leakage' })).statusCode).toBe(401);
    expect((await call('GET', '/leakage?preset=custom')).statusCode).toBe(400);
    expect((await call('GET', '/leakage?preset=fortnight')).statusCode).toBe(400);
    expect(
      (await call('GET', '/leakage?preset=custom&from=2026-09-30&to=2026-09-01')).statusCode,
    ).toBe(400);
  });

  it('a shop with no orders has no findings, and says how little was checked', async () => {
    const f = await leak(P, 'id-lk-b');
    expect(f.findings).toEqual([]);
    expect(f.checked).toEqual({ orders: 0, products: 0 });
  });

  it('what was checked matches the Overview', async () => {
    await calculateAll(a);
    const f = await leak();
    const o = await overview();
    expect(f.checked.orders).toBeGreaterThan(0);
    expect(f.checked.orders).toBeLessThanOrEqual(o.summary.orders);
    expect(f.checked.products).toBeGreaterThan(0);
    expect(f.limits).toEqual({
      missingCostPct: '10.00',
      marginPct: '20.00',
      refundRatePct: '10.00',
      costChangePct: '10.00',
    });
  });

  it('data quality findings quote the same figures as the Overview', async () => {
    await calculateAll(a);
    const f = await leak();
    const o = await overview();
    const missing = byId(f, 'missing_costs');
    expect(missing).toBeDefined();
    expect(missing.evidence).toContain('10%'); // the merchant limit
    expect(missing.title).toContain(`${(Number(o.summary.missingCostShare) * 100).toFixed(1)}%`);
    expect(byId(f, 'missing_shipping_cost')).toBeDefined(); // no shipping rule in the fixture
    expect(missing.impact).toBeNull();
  });

  it('every finding explains itself and any money figure is a loss with a reason', async () => {
    await calculateAll(a);
    await setLimits({ marginPct: '99', refundRatePct: '0' });
    const f = await leak();
    expect(f.findings.length).toBeGreaterThan(3);
    for (const x of f.findings) {
      expect(x.evidence.length).toBeGreaterThan(10);
      expect(x.why.length).toBeGreaterThan(10);
      expect(x.action?.href).toMatch(/^\//);
      if (x.impact) {
        expect(Number(x.impact.amount)).toBeLessThan(0);
        expect(x.impact.note.length).toBeGreaterThan(10);
      }
    }
    const order = { critical: 0, warning: 1, info: 2 } as const;
    const sev = f.findings.map((x) => order[x.severity]);
    expect(sev).toEqual([...sev].sort());
  });

  it('the refund finding quotes the refunded money and follows the merchant limit', async () => {
    await calculateAll(a, 3); // enough counted orders for a rate to be judged
    const o = await overview();
    expect(o.summary.orders).toBeGreaterThanOrEqual(10);
    const rate = Number(o.summary.refundRate) * 100;
    expect(rate).toBeGreaterThan(10);
    // above the default 10% limit: a finding, and critical when more than twice the limit
    const x = byId(await leak(), 'refund_rate');
    expect(x).toBeDefined();
    expect(x.severity).toBe(rate >= 20 ? 'critical' : 'warning');
    expect(x.impact?.amount).toBe(`-${o.summary.productRefunds}`);
    expect(x.title).toBe(`Refunds are ${rate.toFixed(1)}% of sales`);
    expect(x.items.length).toBeGreaterThan(0);
    // a limit above the actual rate removes it, and so does a limit exactly at the rate
    await setLimits({ refundRatePct: '100' });
    expect(byId(await leak(), 'refund_rate')).toBeUndefined();
    await setLimits({ refundRatePct: rate.toFixed(2) });
    expect(byId(await leak(), 'refund_rate')).toBeUndefined();
  });

  it('too few orders are never judged, however strict the limits', async () => {
    await calculateAll(a, 1);
    const o = await overview();
    expect(o.summary.orders).toBeLessThan(10);
    await setLimits({ marginPct: '100', refundRatePct: '0' });
    const f = await leak();
    for (const id of ['refund_rate', 'low_margin', 'shipping_subsidy']) {
      expect(byId(f, id)).toBeUndefined();
    }
  });

  it('the margin finding appears only below the merchant limit', async () => {
    await calculateAll(a, 3);
    const o = await overview();
    const margin = Number(o.summary.contributionMargin) * 100;
    await setLimits({ marginPct: String(Math.max(0, Math.floor(margin))) });
    expect(byId(await leak(), 'low_margin')).toBeUndefined();
    await setLimits({ marginPct: String(Math.min(100, Math.ceil(margin) + 1)) });
    const x = byId(await leak(), 'low_margin');
    expect(x).toBeDefined();
    expect(x.evidence).toContain(`${margin.toFixed(1)}%`);
    expect(x.impact).toBeNull();
    // costs are missing in the fixture, so the finding must say the real margin is lower
    expect(x.disclosure).toMatch(/lower than shown/);
  });

  it('a shop with no sales in the period has no findings even with strict limits', async () => {
    await calculateAll(a);
    await setLimits({ marginPct: '100', refundRatePct: '0' });
    const f = await leak('preset=custom&from=2026-02-01&to=2026-02-02');
    expect(f.findings).toEqual([]);
  });

  it('detects a cost change and shows its effect on margin', async () => {
    await withTenant(db, a.tenantId, (tx) => upsertProducts(tx, a, productNodes.map(mapProduct)));
    const list = (await json('GET', '/settings/costs?filter=missing&pageSize=100')).body.rows;
    const v = list.find((r: { price: string }) => Number(r.price) > 50) ?? list[0];
    const put = (amount: string, effectiveFrom: string) =>
      json('PUT', `/settings/costs/${v.variantShopifyId}`, 'id-lk-a', { amount, effectiveFrom });
    await put('10.00', '2026-08-01');
    await put('15.00', '2026-09-10');
    const f = await leak('preset=custom&from=2026-09-01&to=2026-09-30');
    const x = byId(f, 'cost_change');
    expect(x).toBeDefined();
    expect(x.items[0]!.label).toContain(v.productTitle);
    expect(x.items[0]!.detail).toContain('$10.00 to $15.00');
    expect(x.items[0]!.detail).toContain('+50.0%');
    expect(x.items[0]!.detail).toContain('2026-09-10');
    // a period that ends before the change does not show it
    expect(
      byId(await leak('preset=custom&from=2026-08-01&to=2026-08-31'), 'cost_change'),
    ).toBeUndefined();
  });

  it('a cost that was entered and then removed is not a change', async () => {
    await withTenant(db, a.tenantId, (tx) => upsertProducts(tx, a, productNodes.map(mapProduct)));
    const v = (await json('GET', '/settings/costs?filter=missing&pageSize=100')).body.rows[0];
    await json('PUT', `/settings/costs/${v.variantShopifyId}`, 'id-lk-a', {
      amount: '10',
      effectiveFrom: '2026-08-01',
    });
    await json('PUT', `/settings/costs/${v.variantShopifyId}`, 'id-lk-a', {
      amount: '99',
      effectiveFrom: '2026-09-10',
    });
    const rows = (await json('GET', `/settings/costs/${v.variantShopifyId}/history`)).body
      .rows as Array<{ id: string; amount: string }>;
    const mistake = rows.find((r) => r.amount === '99.0000')!;
    await call('DELETE', `/settings/costs/entry/${mistake.id}`);
    expect(
      byId(await leak('preset=custom&from=2026-09-01&to=2026-09-30'), 'cost_change'),
    ).toBeUndefined();
  });

  it('shows only this shop findings', async () => {
    await calculateAll(a);
    expect((await leak(P, 'id-lk-b')).findings).toEqual([]);
  });
});

describe('alert limits', () => {
  it('start at sensible defaults, can be changed, and are listed with the other settings', async () => {
    const before = rulesResponseSchema.parse((await json('GET', '/settings/rules')).body);
    expect(before.limits).toEqual({
      missingCostPct: '10.00',
      marginPct: '20.00',
      refundRatePct: '10.00',
      costChangePct: '10.00',
    });
    const res = await json('PUT', '/settings/limits', 'id-lk-a', {
      marginPct: '35.5',
      refundRatePct: '7',
      costChangePct: '25',
    });
    expect(res.res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      marginPct: '35.50',
      refundRatePct: '7.00',
      costChangePct: '25.00',
    });
    const after = rulesResponseSchema.parse((await json('GET', '/settings/rules')).body);
    expect(after.limits.marginPct).toBe('35.50');
    // the missing-cost limit is untouched by this change
    expect(after.limits.missingCostPct).toBe('10.00');
  });

  it('changing the missing-cost limit keeps the others', async () => {
    await setLimits({ marginPct: '30' });
    await call('PUT', '/settings/threshold', 'id-lk-a', { missingCostWarningPct: '40' });
    const r = rulesResponseSchema.parse((await json('GET', '/settings/rules')).body);
    expect(r.limits).toMatchObject({ missingCostPct: '40.00', marginPct: '30.00' });
  });

  it('records the change in plain words', async () => {
    await setLimits({ marginPct: '30', refundRatePct: '5', costChangePct: '15' });
    const audit = auditResponseSchema.parse((await json('GET', '/settings/audit')).body);
    expect(audit.rows[0]!.summary).toBe(
      'Changed alert limits: margin 30%, refund rate 5%, cost change 15%',
    );
  });

  it.each([
    ['margin over 100', { marginPct: '101' }],
    ['negative margin limit', { marginPct: '-1' }],
    ['text', { refundRatePct: 'ten' }],
    ['exponent', { marginPct: '1e2' }],
    ['too many decimals', { marginPct: '20.123' }],
    ['empty', { costChangePct: '' }],
    ['cost change over 1000', { costChangePct: '1001' }],
  ])('rejects %s', async (_l, over) => {
    expect((await setLimits(over)).statusCode).toBe(400);
    expect(
      rulesResponseSchema.parse((await json('GET', '/settings/rules')).body).limits.marginPct,
    ).toBe('20.00');
  });

  it('rejects a body with a missing field or an unknown one being trusted', async () => {
    expect((await call('PUT', '/settings/limits', 'id-lk-a', { marginPct: '20' })).statusCode).toBe(
      400,
    );
    expect((await call('PUT', '/settings/limits', 'id-lk-a', {})).statusCode).toBe(400);
  });

  it('are per shop', async () => {
    await setLimits({ marginPct: '55' });
    const theirs = rulesResponseSchema.parse(
      (await json('GET', '/settings/rules', 'id-lk-b')).body,
    );
    expect(theirs.limits.marginPct).toBe('20.00');
    expect(
      auditResponseSchema.parse((await json('GET', '/settings/audit', 'id-lk-b')).body).rows,
    ).toEqual([]);
  });

  it('require a session', async () => {
    expect(
      (await app.inject({ method: 'PUT', url: '/api/v1/settings/limits', payload: {} })).statusCode,
    ).toBe(401);
  });
});

describe('alert emails setting', () => {
  const put = (recipients: unknown, token = 'id-lk-a') =>
    call('PUT', '/settings/alert-emails', token, { recipients });
  const rules = async (token?: string) =>
    rulesResponseSchema.parse((await json('GET', '/settings/rules', token)).body);

  it('is off by default, can be set, and is listed with the other settings', async () => {
    expect((await rules()).alertEmails).toEqual([]);
    const res = await json('PUT', '/settings/alert-emails', 'id-lk-a', {
      recipients: ['owner@example.com', 'ops@example.com'],
    });
    expect(res.res.statusCode).toBe(200);
    expect((await rules()).alertEmails).toEqual(['owner@example.com', 'ops@example.com']);
  });

  it('removes duplicates and can be turned off with an empty list', async () => {
    await put(['a@example.com', 'a@example.com', 'b@example.com']);
    expect((await rules()).alertEmails).toEqual(['a@example.com', 'b@example.com']);
    expect((await put([])).statusCode).toBe(200);
    expect((await rules()).alertEmails).toEqual([]);
  });

  it.each([
    ['more than 5 addresses', Array.from({ length: 6 }, (_, i) => `u${i}@example.com`)],
    ['an address without a domain', ['nobody']],
    ['a value that is not a list', 'a@example.com'],
  ])('rejects %s and keeps the old list', async (_l, bad) => {
    await put(['keep@example.com']);
    expect((await put(bad)).statusCode).toBe(400);
    expect((await rules()).alertEmails).toEqual(['keep@example.com']);
  });

  it('is per shop, is recorded in the audit trail, and needs a session', async () => {
    await put(['mine@example.com']);
    expect((await rules('id-lk-b')).alertEmails).toEqual([]);
    const rows = auditResponseSchema.parse((await json('GET', '/settings/audit')).body).rows;
    expect(JSON.stringify(rows)).toContain('mine@example.com');
    expect(
      (await app.inject({ method: 'PUT', url: '/api/v1/settings/alert-emails', payload: {} }))
        .statusCode,
    ).toBe(401);
  });
});
