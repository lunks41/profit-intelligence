import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createDb, createPool, installShop } from '@pi/db';
import type { InstallResult } from '@pi/db';
import { AuthError } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';

const ORDERS = Number(process.env.LOAD_ORDERS ?? 50_000);
/** the app imports 90 days of orders, so all of them inside the period is the worst real case */
const DAYS = Number(process.env.LOAD_DAYS ?? 90);
const ASSERT = process.env.LOAD_ASSERT !== '0';
const RUNS = Number(process.env.LOAD_RUNS ?? 15);

/**
 * Targets at the 95th percentile: the Overview under 1.5 s and each list under 1 s. The Products
 * list works out every order of the period the first time (the "cold" request) and keeps the answer
 * until an order is recalculated, so its cold request has its own, looser target.
 */
const TARGET_MS = { overview: 1500, orders: 1000, products: 1000, productsCold: 5000 } as const;

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

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);
let app: NestFastifyApplication;
let shop: InstallResult;

/**
 * Synthetic data, inserted with set-based SQL so 50,000 orders take seconds. About 1 in 20 orders is
 * partly refunded, 1 in 33 is unpaid (not counted), every cost status occurs, and the dates spread
 * over the last 360 days. Row level security is bypassed here because the admin role is used.
 */
async function seed(tenantId: string, shopId: string) {
  const t = Date.now();
  await admin.query(
    `insert into t_product (tenant_id, shop_id, shopify_id, title, status, shopify_updated_at)
     select $1, $2, 1000 + g, 'Product ' || g, 'ACTIVE', now() from generate_series(1, 300) g`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into t_product_variant (tenant_id, shop_id, product_id, shopify_id, product_shopify_id, title, price_amount, shopify_updated_at)
     select $1, $2, p.id, p.shopify_id * 10 + v, p.shopify_id, 'Var ' || v, 50, now()
       from t_product p cross join generate_series(1, 3) v where p.shop_id = $2`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into t_order (tenant_id, shop_id, shopify_id, name, processed_at, shopify_created_at, shopify_updated_at,
                          financial_status, taxes_included, currency, subtotal_amount, discounts_amount,
                          shipping_amount, tax_amount, total_amount, refunded_amount, source_name)
     select $1, $2, 5000000 + g, '#' || (1000 + g),
            now() - make_interval(days => (g % $4::int), hours => (g % 24)),
            now() - make_interval(days => (g % $4::int), hours => (g % 24)), now(),
            case when g % 33 = 0 then 'PENDING' when g % 20 = 0 then 'PARTIALLY_REFUNDED' else 'PAID' end,
            false, 'USD', 100, case when g % 7 = 0 then 10 else 0 end, 9.99, 0,
            case when g % 7 = 0 then 99.99 else 109.99 end, case when g % 20 = 0 then 20 else 0 end,
            case g % 4 when 0 then 'web' when 1 then 'pos' when 2 then 'draft_orders' else 'tiktok' end
       from generate_series(1, $3) g`,
    [tenantId, shopId, ORDERS, DAYS],
  );
  await admin.query(
    `insert into t_order_line_item (tenant_id, shop_id, order_id, shopify_id, product_shopify_id, variant_shopify_id,
                                    title, variant_title, sku, quantity, unit_price_amount, discount_amount, tax_amount, requires_shipping)
     select $1, $2, o.id, o.shopify_id * 10 + l, 1000 + ((o.shopify_id + l) % 300) + 1,
            (1000 + ((o.shopify_id + l) % 300) + 1) * 10 + (l % 3) + 1,
            'Product ' || (((o.shopify_id + l) % 300) + 1), 'Var ' || ((l % 3) + 1),
            'SKU-' || (((o.shopify_id + l) % 300) + 1), 1 + (l % 2), 10 + ((o.shopify_id + l) % 8) * 10, 0, 0, true
       from t_order o join generate_series(1, 3) l on l <= 1 + (o.shopify_id % 3)
      where o.shop_id = $2`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into t_order_transaction (tenant_id, shop_id, order_id, shopify_id, kind, status, amount, currency, processed_at, gateway)
     select $1, $2, o.id, o.shopify_id * 10, 'SALE', case when o.financial_status = 'PENDING' then 'PENDING' else 'SUCCESS' end,
            o.total_amount, 'USD', o.processed_at, case when o.shopify_id % 2 = 0 then 'shopify_payments' else 'paypal' end
       from t_order o where o.shop_id = $2`,
    [tenantId, shopId],
  );
  // refunds on 1 in 20 orders: one refund of 20.00 on the first line
  await admin.query(
    `insert into t_refund (tenant_id, shop_id, order_id, shopify_id, processed_at, shopify_created_at, total_amount)
     select $1, $2, o.id, 9000000 + o.shopify_id, o.processed_at + interval '3 days', o.processed_at + interval '3 days', 20
       from t_order o where o.shop_id = $2 and o.financial_status = 'PARTIALLY_REFUNDED'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into t_refund_line_item (tenant_id, shop_id, refund_id, shopify_id, line_item_shopify_id, quantity, subtotal_amount, tax_amount)
     select $1, $2, r.id, r.shopify_id * 10, o.shopify_id * 10 + 1, 1, 20, 0
       from t_refund r join t_order o on o.id = r.order_id where r.shop_id = $2`,
    [tenantId, shopId],
  );

  // the ledger, for counted orders (everything except unpaid)
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, component, occurred_at, entry_date, amount, currency, status, source, engine_version)
     select $1, $2, o.id, 'gross_sales', o.processed_at, o.processed_at::date,
            (select sum(l.quantity * l.unit_price_amount) from t_order_line_item l where l.order_id = o.id),
            'USD', 'actual', 'shopify', 'load'
       from t_order o where o.shop_id = $2 and o.financial_status <> 'PENDING'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, component, occurred_at, entry_date, amount, currency, status, source, engine_version)
     select $1, $2, o.id, 'discounts', o.processed_at, o.processed_at::date,
            -(select sum(l.quantity * l.unit_price_amount) from t_order_line_item l where l.order_id = o.id) * 0.1,
            'USD', 'actual', 'shopify', 'load'
       from t_order o where o.shop_id = $2 and o.financial_status <> 'PENDING' and o.shopify_id % 7 = 0`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, component, occurred_at, entry_date, amount, currency, status, source, engine_version)
     select $1, $2, o.id, 'shipping_revenue', o.processed_at, o.processed_at::date, 9.99, 'USD', 'actual', 'shopify', 'load'
       from t_order o where o.shop_id = $2 and o.financial_status <> 'PENDING'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, line_item_shopify_id, component, occurred_at, entry_date, amount, currency,
                                 status, source, basis_amount, engine_version)
     select $1, $2, o.id, l.shopify_id, 'cogs', o.processed_at, o.processed_at::date,
            case when l.variant_shopify_id % 10 = 0 then 0 else -(l.quantity * l.unit_price_amount * 0.5) end,
            'USD', case when l.variant_shopify_id % 10 = 0 then 'missing' when l.variant_shopify_id % 10 in (1, 2, 3) then 'estimated' else 'actual' end,
            'cost', l.quantity * l.unit_price_amount, 'load'
       from t_order o join t_order_line_item l on l.order_id = o.id
      where o.shop_id = $2 and o.financial_status <> 'PENDING'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, component, occurred_at, entry_date, amount, currency, status, source, engine_version)
     select $1, $2, o.id, 'payment_fees', o.processed_at, o.processed_at::date, -(o.total_amount * 0.029 + 0.3), 'USD',
            case when o.shopify_id % 2 = 0 then 'actual' else 'estimated' end, 'fee', 'load'
       from t_order o where o.shop_id = $2 and o.financial_status <> 'PENDING'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, component, occurred_at, entry_date, amount, currency, status, source, engine_version)
     select $1, $2, o.id, 'shipping_cost', o.processed_at, o.processed_at::date,
            case when o.shopify_id % 2 = 0 then 0 else -4.5 end, 'USD',
            case when o.shopify_id % 2 = 0 then 'missing' else 'estimated' end, 'rule', 'load'
       from t_order o where o.shop_id = $2 and o.financial_status <> 'PENDING'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_profit_entry (tenant_id, shop_id, order_id, refund_shopify_id, line_item_shopify_id, component, occurred_at, entry_date,
                                 amount, currency, status, source, engine_version)
     select $1, $2, o.id, 9000000 + o.shopify_id, o.shopify_id * 10 + 1, 'product_refund', o.processed_at + interval '3 days',
            (o.processed_at + interval '3 days')::date, -20, 'USD', 'actual', 'shopify refund', 'load'
       from t_order o where o.shop_id = $2 and o.financial_status = 'PARTIALLY_REFUNDED'`,
    [tenantId, shopId],
  );
  await admin.query(
    `insert into f_order_profit (tenant_id, shop_id, order_id, order_date, recognized, exclusion_reason, contribution_amount, partial, engine_version)
     select $1, $2, o.id, o.processed_at::date, o.financial_status <> 'PENDING',
            case when o.financial_status = 'PENDING' then 'awaiting_payment' end,
            case when o.financial_status <> 'PENDING'
                 then (select coalesce(sum(e.amount), 0) from f_profit_entry e where e.order_id = o.id) end,
            exists (select 1 from f_profit_entry e where e.order_id = o.id and e.status = 'missing'), 'load'
       from t_order o where o.shop_id = $2`,
    [tenantId, shopId],
  );
  await admin.query('analyze');
  return Date.now() - t;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

interface Result {
  name: string;
  /** the first request, before anything is kept */
  cold: number;
  p50: number;
  p95: number;
  max: number;
}
const results: Result[] = [];

async function time(name: string, url: string, expectOk = true): Promise<Result> {
  const get = () =>
    app.inject({ method: 'GET', url, headers: { authorization: 'Bearer id-load-a' } });
  const t0 = performance.now();
  const first = await get();
  const cold = Math.round(performance.now() - t0);
  if (expectOk) expect(first.statusCode, `${name}: ${first.body.slice(0, 200)}`).toBe(200);
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const res = await get();
    ms.push(performance.now() - t);
    expect(res.statusCode).toBe(200);
  }
  const r = {
    name,
    cold,
    p50: Math.round(pct(ms, 50)),
    p95: Math.round(pct(ms, 95)),
    max: Math.round(Math.max(...ms)),
  };
  results.push(r);
  return r;
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
    .useValue({ send: vi.fn(async () => 'job'), stop: async () => {} })
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  shop = await installShop(db, {
    shopDomain: 'load-a.myshopify.com',
    name: 'Load A',
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });
  const ms = await seed(shop.tenantId, shop.shopId);
  console.log(`seeded ${ORDERS} orders in ${(ms / 1000).toFixed(1)} s`);
});

afterAll(async () => {
  console.table(results);
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('./out/last-run.json', import.meta.url),
    JSON.stringify({ orders: ORDERS, runs: RUNS, at: new Date().toISOString(), results }, null, 2),
  );
  await app.close();
  await admin.end();
  await setupPool.end();
});

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const LONG = `preset=custom&from=${daysAgo(DAYS - 1)}&to=${today}`;
const MONTH = `preset=custom&from=${daysAgo(29)}&to=${today}`;

describe(`${ORDERS} orders over ${DAYS} days`, () => {
  it('Overview, the whole period', async () => {
    const r = await time('overview whole period', `/api/v1/dashboard/overview?${LONG}`);
    if (ASSERT) expect(r.p95).toBeLessThan(TARGET_MS.overview);
  });

  it('Overview, 30 days', async () => {
    const r = await time('overview 30 days', `/api/v1/dashboard/overview?${MONTH}`);
    if (ASSERT) expect(r.p95).toBeLessThan(TARGET_MS.overview);
  });

  it('Orders list, newest first', async () => {
    const r = await time(
      'orders whole period',
      `/api/v1/profitability/orders?${LONG}&page=1&pageSize=25`,
    );
    if (ASSERT) expect(r.p95).toBeLessThan(TARGET_MS.orders);
  });

  it('Orders list, filtered and sorted', async () => {
    const r = await time(
      'orders missing cost by profit',
      `/api/v1/profitability/orders?${LONG}&filter=missing_cost&sort=profit&dir=asc&page=3&pageSize=25`,
    );
    if (ASSERT) expect(r.p95).toBeLessThan(TARGET_MS.orders);
  });

  it('Orders list, search', async () => {
    const r = await time(
      'orders search',
      `/api/v1/profitability/orders?${LONG}&search=%231234&page=1&pageSize=25`,
    );
    if (ASSERT) expect(r.p95).toBeLessThan(TARGET_MS.orders);
  });

  it('Products list, the whole period', async () => {
    const r = await time(
      'products whole period',
      `/api/v1/profitability/products?${LONG}&page=1&pageSize=25`,
    );
    if (ASSERT) {
      expect(r.cold).toBeLessThan(TARGET_MS.productsCold);
      expect(r.p95).toBeLessThan(TARGET_MS.products);
    }
  });

  it('Products list, 30 days', async () => {
    const r = await time(
      'products 30 days',
      `/api/v1/profitability/products?${MONTH}&page=1&pageSize=25`,
    );
    if (ASSERT) {
      expect(r.cold).toBeLessThan(TARGET_MS.productsCold);
      expect(r.p95).toBeLessThan(TARGET_MS.products);
    }
  });
});
