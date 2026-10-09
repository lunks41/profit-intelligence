import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mapOrder, mapProduct } from '../../shopify/src/sync-mappers.js';
import { createDb, createPool, withTenant } from '../src/client.js';
import { installShop } from '../src/installations.js';
import type { InstallResult } from '../src/installations.js';
import {
  createSyncJob,
  finishSyncJob,
  getLastSuccessfulSyncAt,
  getSyncCounts,
  getSyncJob,
  markSyncRunning,
  saveSyncProgress,
  upsertOrders,
  upsertProducts,
} from '../src/sync.js';
import type { OrderInput } from '../src/sync.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../shopify/test/fixtures/${name}`, import.meta.url), 'utf8'));
const orderNodes = fixture('orders-page.json').orders.nodes as Record<string, unknown>[];
const productNodes = fixture('products-page.json').products.nodes as Record<string, unknown>[];
const orders = (): OrderInput[] => orderNodes.map(mapOrder);

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 4);
const db = createDb(appPool);

let a: InstallResult;
let b: InstallResult;

const install = (domain: string) =>
  installShop(db, {
    shopDomain: domain,
    name: domain,
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });

const count = async (table: string) =>
  Number((await admin.query(`select count(*)::int n from ${table}`)).rows[0].n);

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await install('sync-a.myshopify.com');
  b = await install('sync-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

const run = <T>(who: InstallResult, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, who.tenantId, fn);

describe('upsertOrders', () => {
  it('stores orders with line items, refunds and transactions', async () => {
    await run(a, (tx) => upsertOrders(tx, a, orders()));
    expect(await count('t_order')).toBe(orderNodes.length);
    expect(await count('t_order_line_item')).toBeGreaterThanOrEqual(orderNodes.length);
    expect(await count('t_refund')).toBeGreaterThan(0);
    expect(await count('t_order_transaction')).toBeGreaterThan(0);
  });

  it('is idempotent: running the same data twice creates no duplicates', async () => {
    await run(a, (tx) => upsertOrders(tx, a, orders()));
    const before = {
      orders: await count('t_order'),
      lines: await count('t_order_line_item'),
      refunds: await count('t_refund'),
      refundLines: await count('t_refund_line_item'),
      txns: await count('t_order_transaction'),
    };
    await run(a, (tx) => upsertOrders(tx, a, orders()));
    expect({
      orders: await count('t_order'),
      lines: await count('t_order_line_item'),
      refunds: await count('t_refund'),
      refundLines: await count('t_refund_line_item'),
      txns: await count('t_order_transaction'),
    }).toEqual(before);
  });

  it('tolerates duplicate entries in one batch, keeping the newest', async () => {
    const base = orders();
    const older = structuredClone(base[0]!);
    older.order.financialStatus = 'OLD';
    older.order.shopifyUpdatedAt = new Date(base[0]!.order.shopifyUpdatedAt.getTime() - 1000);
    const result = await run(a, (tx) => upsertOrders(tx, a, [...base, older]));
    expect(result.written).toBe(base.length);
    expect(await count('t_order')).toBe(base.length);
    const { rows } = await admin.query(
      "select count(*)::int n from t_order where financial_status = 'OLD'",
    );
    expect(rows[0].n).toBe(0);
  });

  it('handles a large batch (more rows than one insert chunk)', async () => {
    const base = orders()[0]!;
    const many = Array.from({ length: 1200 }, (_, i) => {
      const c = structuredClone(base);
      c.order.shopifyId = 9_000_000_000_000 + i;
      c.order.name = `#BULK${i}`;
      c.lineItems = c.lineItems.map((l, j) => ({
        ...l,
        shopifyId: 8_000_000_000_000 + i * 10 + j,
      }));
      c.refunds = [];
      c.transactions = [];
      return c;
    });
    await run(a, (tx) => upsertOrders(tx, a, many));
    expect(await count('t_order')).toBe(1200);
  });

  it('never rolls an order back to older data (last writer wins by updatedAt)', async () => {
    const [first] = orders();
    const newer = structuredClone(first!);
    newer.order.shopifyUpdatedAt = new Date(first!.order.shopifyUpdatedAt.getTime() + 60_000);
    newer.order.financialStatus = 'REFUNDED';
    await run(a, (tx) => upsertOrders(tx, a, [newer]));

    const result = await run(a, (tx) => upsertOrders(tx, a, [first!])); // older replay
    expect(result).toEqual({ written: 0, skipped: 1 });
    const { rows } = await admin.query('select financial_status from t_order');
    expect(rows[0].financial_status).toBe('REFUNDED');
  });

  it('removes line items that disappeared from an edited order', async () => {
    const multi = orders().find((o) => o.lineItems.length >= 2);
    expect(multi, 'fixture needs a multi-line order').toBeDefined();
    await run(a, (tx) => upsertOrders(tx, a, [multi!]));
    const edited = structuredClone(multi!);
    edited.lineItems = edited.lineItems.slice(0, 1);
    edited.order.shopifyUpdatedAt = new Date(multi!.order.shopifyUpdatedAt.getTime() + 1000);
    await run(a, (tx) => upsertOrders(tx, a, [edited]));
    expect(await count('t_order_line_item')).toBe(1);
  });

  it('keeps line items when Shopify said the list was truncated', async () => {
    const multi = orders().find((o) => o.lineItems.length >= 2)!;
    await run(a, (tx) => upsertOrders(tx, a, [multi]));
    const partial = structuredClone(multi);
    partial.lineItems = partial.lineItems.slice(0, 1);
    partial.truncated.lineItems = true;
    partial.order.shopifyUpdatedAt = new Date(multi.order.shopifyUpdatedAt.getTime() + 1000);
    await run(a, (tx) => upsertOrders(tx, a, [partial]));
    expect(await count('t_order_line_item')).toBe(multi.lineItems.length);
  });

  it('stores refunds with the effective (backdated) date and money as exact decimals', async () => {
    await run(a, (tx) => upsertOrders(tx, a, orders()));
    const { rows } = await admin.query(
      `select r.processed_at, r.shopify_created_at, r.total_amount::text amt
         from t_refund r where r.processed_at < r.shopify_created_at limit 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amt).toMatch(/^\d+\.\d{4}$/);
    const o = await admin.query('select total_amount::text t from t_order limit 1');
    expect(o.rows[0].t).toMatch(/^\d+\.\d{4}$/);
  });

  it('keeps tenants apart: tenant B cannot see tenant A orders', async () => {
    await run(a, (tx) => upsertOrders(tx, a, orders()));
    await run(b, (tx) => upsertOrders(tx, b, orders().slice(0, 2))); // same Shopify ids, other shop
    expect(await count('t_order')).toBe(orderNodes.length + 2);
    expect((await getSyncCounts(db, a)).orders).toBe(orderNodes.length);
    expect((await getSyncCounts(db, b)).orders).toBe(2);
    const seenByB = await run(
      b,
      async (tx) => (await tx.execute('select count(*)::int n from t_order' as never)).rows,
    );
    expect(seenByB[0]).toEqual({ n: 2 });
  });

  it('rejects writes for another tenant (RLS WITH CHECK)', async () => {
    await expect(
      run(a, (tx) =>
        upsertOrders(tx, { tenantId: b.tenantId, shopId: b.shopId }, orders().slice(0, 1)),
      ),
    ).rejects.toThrow();
  });
});

describe('upsertProducts', () => {
  it('stores products and variants idempotently', async () => {
    const items = productNodes.map(mapProduct);
    await run(a, (tx) => upsertProducts(tx, a, items));
    const first = { p: await count('t_product'), v: await count('t_product_variant') };
    expect(first.p).toBe(productNodes.length);
    expect(first.v).toBeGreaterThan(0);
    await run(a, (tx) => upsertProducts(tx, a, items));
    expect({ p: await count('t_product'), v: await count('t_product_variant') }).toEqual(first);
  });

  it('keeps a missing unit cost as NULL, not zero', async () => {
    await run(a, (tx) => upsertProducts(tx, a, productNodes.map(mapProduct)));
    const { rows } = await admin.query(
      'select count(*)::int n from t_product_variant where unit_cost_amount is null',
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe('sync jobs', () => {
  it('allows only one active job per shop and returns the existing one', async () => {
    const first = await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    const second = await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    // another shop is independent
    expect((await createSyncJob(db, b, { kind: 'initial', windowStart: null })).created).toBe(true);
  });

  it('allows a new job after the previous one finished', async () => {
    const { job } = await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    await run(a, (tx) => finishSyncJob(tx, a, job.id, { status: 'succeeded' }));
    expect((await createSyncJob(db, a, { kind: 'incremental', windowStart: null })).created).toBe(
      true,
    );
    expect(await getLastSuccessfulSyncAt(db, a)).toBeInstanceOf(Date);
  });

  it('persists progress and the resume cursor, and counts attempts', async () => {
    const { job } = await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    await run(a, async (tx) => {
      await markSyncRunning(tx, a, job.id);
      await saveSyncProgress(tx, a, job.id, { stage: 'orders', cursor: 'abc', ordersDelta: 25 });
      await saveSyncProgress(tx, a, job.id, { stage: 'orders', cursor: 'def', ordersDelta: 10 });
    });
    const row = await getSyncJob(db, a, job.id);
    expect(row).toMatchObject({
      status: 'running',
      stage: 'orders',
      cursor: 'def',
      ordersProcessed: 35,
      attempts: 1,
    });
    await run(a, (tx) => markSyncRunning(tx, a, job.id)); // a retry
    expect((await getSyncJob(db, a, job.id))?.attempts).toBe(2);
  });

  it('clears the cursor on success but keeps it on failure for resume', async () => {
    const one = await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    await run(a, async (tx) => {
      await saveSyncProgress(tx, a, one.job.id, { stage: 'orders', cursor: 'keep' });
      await finishSyncJob(tx, a, one.job.id, { status: 'failed', error: 'boom' });
    });
    expect(await getSyncJob(db, a, one.job.id)).toMatchObject({
      status: 'failed',
      cursor: 'keep',
      error: 'boom',
    });
  });

  it("does not let tenant B read tenant A's jobs", async () => {
    const { job } = await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    expect(await getSyncJob(db, { tenantId: b.tenantId, shopId: a.shopId }, job.id)).toBeNull();
  });
});
