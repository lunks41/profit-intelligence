import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  orderDetailResponseSchema,
  orderListResponseSchema,
  overviewResponseSchema,
  productDetailResponseSchema,
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

const get = (url: string, token = 'id-prof-a') =>
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

async function calculateAll(who: InstallResult, nodes: Record<string, unknown>[] = orderNodes) {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, nodes.map(mapOrder)));
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
  a = await mk('prof-a.myshopify.com');
  await mk('prof-b.myshopify.com');
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

const api = async (path: string, token?: string) => {
  const res = await get(`/api/v1/profitability${path}`, token);
  return { res, body: res.json() };
};
const cents = (s: string) => Math.round(Number(s) * 100);
const PERIOD = ALL.slice(1);

/* eslint-disable @typescript-eslint/no-explicit-any */
async function allPages(path: string, parse: (x: unknown) => any, pageSize = 100) {
  const rows: any[] = [];
  for (let page = 1; ; page++) {
    const { res, body } = await api(`${path}&page=${page}&pageSize=${pageSize}`);
    expect(res.statusCode).toBe(200);
    const parsed = parse(body);
    rows.push(...parsed.rows);
    if (page >= parsed.paging.totalPages) return { rows, last: parsed };
  }
}
const parseProducts = (x: unknown) => productListResponseSchema.parse(x);
const parseOrders = (x: unknown) => orderListResponseSchema.parse(x);
const parseLines = (x: unknown) => {
  const d = productDetailResponseSchema.parse(x);
  return { ...d, rows: d.lines };
};

describe('product profitability', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/profitability/products' });
    expect(res.statusCode).toBe(401);
  });

  it('products plus unallocated items add up exactly to the dashboard contribution profit', async () => {
    await calculateAll(a);
    const { rows, last } = await allPages(`/products?${PERIOD}`, parseProducts);
    const dash = overviewResponseSchema.parse((await overview(ALL)).body);
    expect(rows.length).toBeGreaterThan(2);
    expect(last.reconciliation.matches).toBe(true);
    expect(last.reconciliation.dashboardContributionProfit).toBe(dash.summary.contributionProfit);
    const products = rows.reduce((s, r) => s + cents(r.profit), 0);
    expect(products).toBe(cents(last.reconciliation.productProfit));
    const un = Object.values(last.reconciliation.unallocated).reduce(
      (s, v) => s + cents(v as string),
      0,
    );
    expect(products + un).toBe(cents(dash.summary.contributionProfit));
  });

  it('every product row is explained by its own components', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/products?${PERIOD}`, parseProducts);
    for (const r of rows) {
      expect(cents(r.netSales)).toBe(cents(r.grossSales) + cents(r.discounts) + cents(r.refunds));
      expect(cents(r.profit)).toBe(cents(r.netSales) + cents(r.cogs));
    }
  });

  it('a product drill-down lists the order lines that make up its row', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/products?${PERIOD}`, parseProducts);
    const row = rows.find((r) => /^\d+$/.test(r.key)) ?? rows[0];
    const lines = await allPages(
      `/products/detail?key=${encodeURIComponent(row.key)}&${PERIOD}`,
      parseLines,
      5,
    );
    expect(lines.rows.length).toBeGreaterThan(0);
    expect(lines.rows.reduce((s, l) => s + cents(l.profit), 0)).toBe(cents(row.profit));
    expect(lines.rows.reduce((s, l) => s + cents(l.cogs), 0)).toBe(cents(row.cogs));
    expect(lines.last.product.key).toBe(row.key);
  });

  it('sorts, filters, searches and paginates', async () => {
    await calculateAll(a);
    const list = async (qs: string) =>
      productListResponseSchema.parse((await api(`/products?${PERIOD}&${qs}`)).body);

    const desc = await list('sort=profit&dir=desc&pageSize=100');
    const asc = await list('sort=profit&dir=asc&pageSize=100');
    const p = desc.rows.map((r) => cents(r.profit));
    expect(p).toEqual([...p].sort((x, y) => y - x));
    const pa = asc.rows.map((r) => cents(r.profit));
    expect(pa).toEqual([...pa].sort((x, y) => x - y));

    const byTitle = await list('sort=title&dir=asc&pageSize=100');
    const titles = byTitle.rows.map((r) => r.title.toLowerCase());
    expect(titles).toEqual([...titles].sort((x, y) => x.localeCompare(y)));

    const first = await list('pageSize=2&page=1');
    const second = await list('pageSize=2&page=2');
    expect(first.rows).toHaveLength(2);
    expect(first.paging.totalPages).toBe(Math.ceil(first.paging.total / 2));
    expect(second.rows.map((r) => r.key)).not.toEqual(first.rows.map((r) => r.key));

    const missing = await list('filter=missing_cost&pageSize=100');
    expect(missing.rows.length).toBeGreaterThan(0);
    expect(missing.rows.every((r) => r.missingCostLines > 0)).toBe(true);
    const loss = await list('filter=loss&pageSize=100');
    expect(loss.rows.every((r) => cents(r.profit) < 0)).toBe(true);

    const one = desc.rows[0]!;
    const found = await list(`search=${encodeURIComponent(one.title.slice(0, 4))}&pageSize=100`);
    expect(found.rows.some((r) => r.key === one.key)).toBe(true);
    expect((await list('search=zzzz-no-such-product')).rows).toEqual([]);
  });

  it('a product with no cost is flagged as missing, not treated as known', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/products?${PERIOD}`, parseProducts);
    const missing = rows.filter((r) => r.costQuality === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((r) => r.missingCostLines > 0)).toBe(true);
  });

  it.each([
    ['page size over the limit', '/products?pageSize=500'],
    ['page zero', '/products?page=0'],
    ['unknown sort', '/products?sort=secret'],
    ['unknown filter', '/products?filter=all;drop'],
    ['missing key', '/products/detail'],
    ['bad key', '/products/detail?key=1%20or%201=1'],
    ['bad period', '/products?preset=custom'],
  ])('rejects %s', async (_l, path) => {
    const { res, body } = await api(path);
    expect(res.statusCode).toBe(400);
    expect(body.error.code).toMatch(/invalid_/);
  });

  it('an unknown product is a 404', async () => {
    await calculateAll(a);
    const { res } = await api(`/products/detail?key=999999999&${PERIOD}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('order profitability', () => {
  it('order profits add up to the dashboard contribution profit', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/orders?${PERIOD}&filter=all`, parseOrders);
    const dash = overviewResponseSchema.parse((await overview(ALL)).body);
    const counted = rows.filter((r) => r.recognized);
    expect(counted.length).toBe(dash.summary.orders);
    expect(counted.reduce((s, r) => s + cents(r.profit), 0)).toBe(
      cents(dash.summary.contributionProfit),
    );
    expect(rows.some((r) => !r.recognized && r.exclusionReason && r.profit === null)).toBe(true);
  });

  it('sorts, filters, searches and paginates', async () => {
    await calculateAll(a);
    const list = async (qs: string) =>
      orderListResponseSchema.parse((await api(`/orders?${PERIOD}&${qs}`)).body);

    const asc = await list('sort=profit&dir=asc&filter=all&pageSize=100');
    const profits = asc.rows.filter((r) => r.profit !== null).map((r) => cents(r.profit!));
    expect(profits).toEqual([...profits].sort((x, y) => x - y));

    const recent = await list('sort=date&dir=desc&pageSize=100');
    const dates = recent.rows.map((r) => r.orderDate);
    expect(dates).toEqual([...dates].sort().reverse());

    const p1 = await list('pageSize=3&page=1');
    const p2 = await list('pageSize=3&page=2');
    expect(p1.rows).toHaveLength(3);
    expect(p1.paging.totalPages).toBe(Math.ceil(p1.paging.total / 3));
    expect(p2.rows.map((r) => r.orderShopifyId)).not.toEqual(p1.rows.map((r) => r.orderShopifyId));

    const excluded = await list('filter=excluded&pageSize=100');
    expect(excluded.rows.every((r) => !r.recognized)).toBe(true);
    const refunded = await list('filter=refunded&pageSize=100');
    expect(refunded.rows.every((r) => /REFUNDED/.test(r.financialStatus))).toBe(true);
    const partial = await list('filter=missing_cost&pageSize=100');
    expect(partial.rows.every((r) => r.partial)).toBe(true);

    const name = recent.rows[0]!.name;
    const found = await list(`search=${encodeURIComponent(name)}`);
    expect(found.rows.some((r) => r.name === name)).toBe(true);
  });

  it('lists orders by where their fee came from, and flags partly imported refunds', async () => {
    const list = async (qs: string) =>
      orderListResponseSchema.parse((await api(`/orders?${PERIOD}&${qs}`)).body);
    const nodes = JSON.parse(JSON.stringify(orderNodes)) as Record<string, unknown>[];
    const refunded = nodes.filter((n) => ((n.refunds as unknown[]) ?? []).length > 0) as Array<{
      name: string;
      refunds: Array<{ refundLineItems: { pageInfo: { hasNextPage: boolean } } }>;
    }>;
    for (const n of refunded) n.refunds[0]!.refundLineItems.pageInfo.hasNextPage = true;
    await calculateAll(a, nodes);

    // counted orders with a refund are flagged; orders that are not counted have no profit to doubt
    const everyone = await list('filter=all&pageSize=100');
    const expected = everyone.rows
      .filter((r) => r.recognized && refunded.some((n) => n.name === r.name))
      .map((r) => r.name)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    const incomplete = await list('filter=incomplete_refunds&pageSize=100');
    expect(incomplete.rows.map((r) => r.name).sort()).toEqual(expected);
    expect(incomplete.rows.every((r) => r.flags.includes('refund_lines_incomplete'))).toBe(true);
    const detail = await api(`/orders/${incomplete.rows[0]!.orderShopifyId}`);
    expect(orderDetailResponseSchema.parse(detail.body).order.flags).toContain(
      'refund_lines_incomplete',
    );

    // the fixture has a fee rule for every payment, so counted orders show estimated fees
    const estimated = await list('filter=estimated_fees&pageSize=100');
    expect(estimated.rows.length).toBeGreaterThan(0);
    expect(
      estimated.rows.every((r) => r.recognized && r.statuses.paymentFees === 'estimated'),
    ).toBe(true);
    const missing = await list('filter=missing_fees&pageSize=100');
    expect(missing.rows.every((r) => r.recognized && r.statuses.paymentFees === 'missing')).toBe(
      true,
    );
    const all = await list('filter=all&pageSize=100');
    const counted = all.rows.filter((r) => r.recognized);
    // every counted order is in exactly one fee bucket
    const bucket = (s: string) => counted.filter((r) => r.statuses.paymentFees === s).length;
    expect(bucket('estimated')).toBe(estimated.rows.length);
    expect(bucket('missing')).toBe(missing.rows.length);
  });

  it('an order detail explains every component and reconciles to the list', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/orders?${PERIOD}&filter=all`, parseOrders);
    const refunded = rows.find((r) => r.recognized && /REFUNDED/.test(r.financialStatus));
    const missing = rows.find((r) => r.recognized && r.partial);
    for (const row of [refunded, missing, rows.find((r) => r.recognized)]) {
      expect(row).toBeDefined();
      const { res, body } = await api(`/orders/${row.orderShopifyId}`);
      expect(res.statusCode).toBe(200);
      const d = orderDetailResponseSchema.parse(body);
      expect(d.summary.profit).toBe(row.profit);
      const money = d.entries.filter((e) => !e.memo).reduce((s, e) => s + cents(e.amount), 0);
      expect(money).toBe(cents(d.summary.profit!));
      for (const e of d.entries) {
        expect(e.explanation.length).toBeGreaterThan(10);
        expect(e.label.length).toBeGreaterThan(2);
      }
      // the per-product view plus unallocated items equals the order profit
      const prods = d.products.reduce((s, p) => s + cents(p.profit), 0);
      const un = Object.values(d.unallocated).reduce((s, v) => s + cents(v), 0);
      expect(prods + un).toBe(cents(d.summary.profit!));
    }
  });

  it('an order with a missing cost says so in plain words', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/orders?${PERIOD}&filter=missing_cost`, parseOrders);
    const d = orderDetailResponseSchema.parse(
      (await api(`/orders/${rows[0].orderShopifyId}`)).body,
    );
    expect(
      d.entries.some((e) => e.status === 'missing' && /unknown|not zero/.test(e.explanation)),
    ).toBe(true);
    expect(d.order.partial).toBe(true);
  });

  it('an excluded order has no profit and no product split', async () => {
    await calculateAll(a);
    const { rows } = await allPages(`/orders?${PERIOD}&filter=excluded`, parseOrders);
    const d = orderDetailResponseSchema.parse(
      (await api(`/orders/${rows[0].orderShopifyId}`)).body,
    );
    expect(d.summary.profit).toBeNull();
    expect(d.products).toEqual([]);
    expect(d.order.exclusionReason).toBeTruthy();
  });

  it('rejects bad ids and returns 404 for unknown orders', async () => {
    expect((await api('/orders/abc')).res.statusCode).toBe(400);
    expect((await api('/orders/1%20or%201=1')).res.statusCode).toBe(400);
    expect((await api('/orders/999999999999')).res.statusCode).toBe(404);
    expect((await api('/orders?sort=drop')).res.statusCode).toBe(400);
    expect((await api('/orders?pageSize=101')).res.statusCode).toBe(400);
  });
});

describe('tenant isolation', () => {
  it('another shop sees nothing and cannot open this shop order or product', async () => {
    await calculateAll(a);
    const mine = orderListResponseSchema.parse((await api(`/orders?${PERIOD}`)).body);
    expect(mine.rows.length).toBeGreaterThan(0);
    const products = productListResponseSchema.parse((await api(`/products?${PERIOD}`)).body);
    expect(products.rows.length).toBeGreaterThan(0);

    const theirs = orderListResponseSchema.parse(
      (await api(`/orders?${PERIOD}`, 'id-prof-b')).body,
    );
    expect(theirs.rows).toEqual([]);
    const theirProducts = productListResponseSchema.parse(
      (await api(`/products?${PERIOD}`, 'id-prof-b')).body,
    );
    expect(theirProducts.rows).toEqual([]);
    expect(theirProducts.reconciliation.matches).toBe(true);

    const order = mine.rows[0]!.orderShopifyId;
    expect((await api(`/orders/${order}`, 'id-prof-b')).res.statusCode).toBe(404);
    const key = products.rows.find((r) => /^\d+$/.test(r.key))!.key;
    expect((await api(`/products/detail?key=${key}&${PERIOD}`, 'id-prof-b')).res.statusCode).toBe(
      404,
    );
  });
});
