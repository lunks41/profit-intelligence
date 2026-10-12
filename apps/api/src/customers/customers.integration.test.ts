import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ltvResponseSchema, overviewResponseSchema } from '@pi/contracts';
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

// four customers share the eleven orders of the fixture
const withCustomers = orderNodes.map((n, i) => ({
  ...n,
  customer: { id: `gid://shopify/Customer/${(i % 4) + 1}` },
}));

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
let b: InstallResult;

const get = (url: string, token = 'id-cust-a') =>
  app.inject({
    method: 'GET',
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
  });
const ALL = 'preset=custom&from=2026-01-01&to=2026-10-09';

const config: EngineConfig = {
  timezone: 'UTC',
  merchantCosts: new Map(),
  shopifyCosts: new Map(),
  feeRules: [],
  shippingRules: [],
};

async function calculateAll(who: InstallResult, nodes: Record<string, unknown>[]) {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, nodes.map(mapOrder)));
  const loaded = await withTenant(db, who.tenantId, (tx) =>
    loadOrdersForProfit(tx, who, { limit: 1000 }),
  );
  for (const { orderId, order } of loaded) {
    const r = calculateOrder(order as EngineOrder, config);
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
          partial: false,
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
  a = await mk('cust-a.myshopify.com');
  b = await mk('cust-b.myshopify.com');
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

describe('GET /api/v1/customers/ltv', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/customers/ltv' })).statusCode).toBe(
      401,
    );
  });

  it('stores only a one-way key, never the customer id', async () => {
    await calculateAll(a, withCustomers);
    const rows = await admin.query(
      'select customer_key from t_order where shop_id = $1 and customer_key is not null',
      [a.shopId],
    );
    expect(rows.rowCount).toBe(orderNodes.length);
    for (const r of rows.rows) {
      expect(r.customer_key).toMatch(/^[0-9a-f]{32}$/);
      expect(r.customer_key).not.toMatch(/Customer/);
    }
    expect(new Set(rows.rows.map((r) => r.customer_key)).size).toBe(4);
  });

  it('says customers are missing when no order has a customer key', async () => {
    await calculateAll(a, orderNodes);
    const res = await get(`/customers/ltv?${ALL}`);
    expect(res.statusCode).toBe(200);
    const body = ltvResponseSchema.parse(res.json());
    expect(body.customerDataMissing).toBe(true);
    expect(body.cohorts).toEqual([]);
    expect(body.kpis.customers).toBe(0);
    expect(body.kpis.ltv).toBeNull();
  });

  it('groups customers by first-order month, and the money adds up to the Overview', async () => {
    await calculateAll(a, withCustomers);
    const res = await get(`/customers/ltv?${ALL}`);
    expect(res.statusCode).toBe(200);
    const body = ltvResponseSchema.parse(res.json());
    expect(body.customerDataMissing).toBe(false);
    expect(body.orders.withoutCustomer).toBe(0);
    expect(body.kpis.customers).toBe(4);
    expect(body.cohorts.reduce((t, c) => t + c.customers, 0)).toBe(4);
    // the months are in order, and a cohort's last cumulative value is its value to date
    const months = body.cohorts.map((c) => c.month);
    expect(months).toEqual([...months].sort());
    for (const c of body.cohorts) {
      expect(c.cumulative[c.cumulative.length - 1]?.ltv).toBe(c.ltv);
      expect(Number(c.repurchaseRate)).toBeGreaterThanOrEqual(0);
      expect(Number(c.repurchaseRate)).toBeLessThanOrEqual(1);
    }
    // every order has a customer, so the cohorts hold all of the period's revenue
    const overview = overviewResponseSchema.parse((await get(`/dashboard/overview?${ALL}`)).json());
    const cents = (v: string) => Math.round(Number(v) * 100);
    expect(cents(body.kpis.revenue)).toBe(cents(overview.summary.revenue));
  });

  it('shows no ad spend, so no CAC, when none was recorded', async () => {
    await calculateAll(a, withCustomers);
    const body = ltvResponseSchema.parse((await get(`/customers/ltv?${ALL}`)).json());
    expect(body.kpis.cac).toBeNull();
    expect(body.kpis.ratio).toBeNull();
    expect(body.cohorts.every((c) => c.cac === null && c.ratio === null)).toBe(true);
  });

  it("does not show another shop's customers", async () => {
    await calculateAll(a, withCustomers);
    await calculateAll(b, orderNodes);
    const body = ltvResponseSchema.parse((await get(`/customers/ltv?${ALL}`, 'id-cust-b')).json());
    expect(body.customerDataMissing).toBe(true);
    expect(body.cohorts).toEqual([]);
  });

  it('refuses a bad filter', async () => {
    expect((await get(`/customers/ltv?${ALL}&country=USA`)).statusCode).toBe(400);
  });
});
