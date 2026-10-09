import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createDb,
  createPool,
  createSyncJob,
  getSyncCounts,
  getSyncJob,
  installShop,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { ShopifyAccessError, ShopifyApiError, createTokenCrypto } from '@pi/shopify';
import type { ShopifyGraphql } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { runSync } from './run-sync.js';
import type { SyncDeps } from './run-sync.js';

const load = (n: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/shopify/test/fixtures/${n}`, import.meta.url),
      'utf8',
    ),
  );
type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const orderNodes: Node[] = load('orders-page.json').orders.nodes;
const productNodes: Node[] = load('products-page.json').products.nodes;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 6);
const db = createDb(appPool);
const crypto = createTokenCrypto({ k1: randomBytes(32).toString('base64') }, 'k1');
const silent = { info() {}, warn() {}, error() {} };

let shop: InstallResult;

/** Fake Shopify serving the fixtures as cursor-paged GraphQL responses. */
function fakeShopify(
  opts: { failOnOrdersPage?: number; revoked?: boolean; ordersPageSize?: number } = {},
) {
  const calls: { kind: string; after: unknown; query?: unknown }[] = [];
  let failed = false;
  const size = opts.ordersPageSize ?? 4;
  const page = (nodes: Node[], after: string | null, pageSize: number) => {
    const start = after ? Number(after.slice(1)) : 0;
    const slice = nodes.slice(start, start + pageSize);
    const end = start + slice.length;
    return {
      nodes: slice,
      pageInfo: { hasNextPage: end < nodes.length, endCursor: `c${end}` },
    };
  };
  const gql: ShopifyGraphql = {
    async query(q, v = {}) {
      if (opts.revoked) throw new ShopifyAccessError(401);
      const after = (v.after as string | null) ?? null;
      if (q.includes('SyncProducts')) {
        calls.push({ kind: 'products', after });
        return { products: page(productNodes, after, 3) };
      }
      if (q.includes('SyncOrders')) {
        calls.push({ kind: 'orders', after, query: v.query });
        if (
          opts.failOnOrdersPage !== undefined &&
          !failed &&
          after === `c${opts.failOnOrdersPage * size}`
        ) {
          failed = true;
          throw new ShopifyApiError('Network error calling Shopify');
        }
        return { orders: page(orderNodes, after, size) };
      }
      if (q.includes('SyncMoreLineItems')) {
        calls.push({ kind: 'moreLineItems', after });
        const parent = orderNodes.find((o) => o.id === v.id)!;
        return {
          order: {
            lineItems: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: parent.__extraLines ?? [],
            },
          },
        };
      }
      throw new Error(`unexpected query ${q.slice(0, 40)}`);
    },
  };
  return { gql, calls };
}

const deps = (gql: ShopifyGraphql): SyncDeps => ({
  db,
  crypto,
  createGraphql: () => gql,
  log: silent,
});

async function newJob(windowStart: Date | null = new Date('2026-04-01T00:00:00Z')) {
  const { job } = await createSyncJob(db, shop, { kind: 'initial', windowStart });
  return job;
}
const payload = (id: string) => ({ ...shop, syncJobId: id });
const count = async (t: string) =>
  Number((await admin.query(`select count(*)::int n from ${t}`)).rows[0].n);

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  shop = await installShop(db, {
    shopDomain: 'run-sync.myshopify.com',
    name: 'Run Sync',
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: crypto.encrypt('shpat_test').value,
    keyId: 'k1',
    scopes: 'read_orders',
  });
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('runSync', () => {
  it('imports products then orders page by page and finishes', async () => {
    const job = await newJob();
    const fake = fakeShopify();
    await runSync(deps(fake.gql), payload(job.id), { retryCount: 0, retryLimit: 5 });

    expect(await count('t_order')).toBe(orderNodes.length);
    expect(await count('t_product')).toBe(productNodes.length);
    const done = await getSyncJob(db, shop, job.id);
    expect(done).toMatchObject({
      status: 'succeeded',
      ordersProcessed: orderNodes.length,
      productsProcessed: productNodes.length,
      cursor: null,
      attempts: 1,
    });
    expect(done?.finishedAt).toBeInstanceOf(Date);
    // 11 fixture orders at 4 per page = 3 pages
    expect(fake.calls.filter((c) => c.kind === 'orders')).toHaveLength(3);
  });

  it('passes the history window to Shopify as a processed_at filter', async () => {
    const job = await newJob(new Date('2026-07-12T00:00:00Z'));
    const fake = fakeShopify();
    await runSync(deps(fake.gql), payload(job.id), { retryCount: 0, retryLimit: 5 });
    expect(fake.calls.find((c) => c.kind === 'orders')?.query).toBe(
      "processed_at:>='2026-07-12T00:00:00.000Z'",
    );
  });

  it('resumes after a mid-run failure without re-fetching or duplicating pages', async () => {
    const job = await newJob();
    const flaky = fakeShopify({ failOnOrdersPage: 1 }); // fails fetching the second orders page once
    await expect(
      runSync(deps(flaky.gql), payload(job.id), { retryCount: 0, retryLimit: 5 }),
    ).rejects.toThrow();

    const mid = await getSyncJob(db, shop, job.id);
    expect(mid?.status).toBe('running');
    expect(mid?.cursor).toBe('c4'); // checkpoint after the first orders page
    expect(mid?.error).toMatch(/Network error/);
    expect(await count('t_order')).toBe(4);

    const retry = fakeShopify();
    await runSync(deps(retry.gql), payload(job.id), { retryCount: 1, retryLimit: 5 });
    expect(await count('t_order')).toBe(orderNodes.length);
    // the retry started at the checkpoint: no products, no first order page
    expect(retry.calls.map((c) => `${c.kind}:${c.after}`)).toEqual(['orders:c4', 'orders:c8']);
    expect(await getSyncJob(db, shop, job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('can be run twice on the same data without duplicates (replay)', async () => {
    const first = await newJob();
    await runSync(deps(fakeShopify().gql), payload(first.id), { retryCount: 0, retryLimit: 5 });
    const second = await newJob();
    await runSync(deps(fakeShopify().gql), payload(second.id), { retryCount: 0, retryLimit: 5 });
    expect(await count('t_order')).toBe(orderNodes.length);
    expect(await count('t_order_line_item')).toBe(
      orderNodes.reduce((n, o) => n + o.lineItems.nodes.length, 0),
    );
  });

  it('fails permanently and flags the shop when Shopify rejects the token (no retry)', async () => {
    const job = await newJob();
    const result = await runSync(deps(fakeShopify({ revoked: true }).gql), payload(job.id), {
      retryCount: 0,
      retryLimit: 5,
    });
    expect(result).toBeUndefined(); // did not throw, so the queue will not retry
    expect((await getSyncJob(db, shop, job.id))?.status).toBe('failed');
    const { rows } = await admin.query('select status from m_shop');
    expect(rows[0].status).toBe('reauth_required');
  });

  it('marks the job failed once retries are exhausted, with a useful message', async () => {
    const job = await newJob();
    const broken: ShopifyGraphql = {
      query: vi.fn().mockRejectedValue(new ShopifyApiError('Shopify throttled the request')),
    };
    await expect(
      runSync(deps(broken), payload(job.id), { retryCount: 5, retryLimit: 5 }),
    ).rejects.toThrow();
    expect(await getSyncJob(db, shop, job.id)).toMatchObject({ status: 'failed' });
    expect((await getSyncJob(db, shop, job.id))?.error).toMatch(/Gave up after 6 attempts/);
  });

  it('ignores a redelivered job that already finished', async () => {
    const job = await newJob();
    await runSync(deps(fakeShopify().gql), payload(job.id), { retryCount: 0, retryLimit: 5 });
    const again = fakeShopify();
    await runSync(deps(again.gql), payload(job.id), { retryCount: 1, retryLimit: 5 });
    expect(again.calls).toHaveLength(0);
  });

  it('fetches additional line items when an order has more than one page', async () => {
    const withMore = structuredClone(orderNodes);
    const target = withMore[0]!;
    const extra = structuredClone(target.lineItems.nodes[0]);
    extra.id = 'gid://shopify/LineItem/999999999999';
    target.lineItems.pageInfo.hasNextPage = true;
    target.__extraLines = [extra];
    const original = orderNodes.splice(0, orderNodes.length, ...withMore);
    try {
      const job = await newJob();
      await runSync(deps(fakeShopify().gql), payload(job.id), { retryCount: 0, retryLimit: 5 });
      const { rows } = await admin.query(
        'select count(*)::int n from t_order_line_item where shopify_id = 999999999999',
      );
      expect(rows[0].n).toBe(1);
    } finally {
      orderNodes.splice(0, orderNodes.length, ...original);
    }
  });

  it('does nothing for a job that belongs to another tenant', async () => {
    const other = await installShop(db, {
      shopDomain: 'other-sync.myshopify.com',
      name: 'Other',
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: crypto.encrypt('shpat_other').value,
      keyId: 'k1',
      scopes: 'read_orders',
    });
    const job = await newJob();
    const fake = fakeShopify();
    await runSync(
      deps(fake.gql),
      { tenantId: other.tenantId, shopId: other.shopId, syncJobId: job.id },
      { retryCount: 0, retryLimit: 5 },
    );
    expect(fake.calls).toHaveLength(0);
    expect(await count('t_order')).toBe(0);
    expect((await getSyncCounts(db, other)).orders).toBe(0);
    expect(
      await withTenant(db, shop.tenantId, async () => (await getSyncJob(db, shop, job.id))?.status),
    ).toBe('queued');
  });
});

describe('runSync reconcile mode', () => {
  it('asks Shopify what changed since the window start (updated_at), not by order date', async () => {
    const { job } = await createSyncJob(db, shop, {
      kind: 'reconcile',
      windowStart: new Date('2026-10-01T00:00:00Z'),
    });
    const fake = fakeShopify();
    await runSync(deps(fake.gql), payload(job.id), { retryCount: 0, retryLimit: 5 });
    const ordersCall = fake.calls.find((c) => c.kind === 'orders');
    expect(String(ordersCall?.query)).toMatch(
      /^updated_at:>='2026-10-01T00:00:00.000Z' processed_at:>='\d{4}-\d{2}-\d{2}T[\d:.]+Z'$/,
    );
    expect((await getSyncJob(db, shop, job.id))?.status).toBe('succeeded');
  });
});

describe('profit recalculation trigger', () => {
  it('queues a whole-shop recalculation after a finished sync', async () => {
    const queued = vi.fn(async (..._a: unknown[]) => 'id');
    const job = await newJob();
    await runSync({ ...deps(fakeShopify().gql), enqueueProfitRecalc: queued }, payload(job.id), {
      retryCount: 0,
      retryLimit: 5,
    });
    expect(queued).toHaveBeenCalledTimes(1);
    expect(queued).toHaveBeenCalledWith({ tenantId: shop.tenantId, shopId: shop.shopId });
  });

  it('a failure to queue does not fail the sync', async () => {
    const queued = vi.fn(async () => {
      throw new Error('queue down');
    });
    const job = await newJob();
    await runSync({ ...deps(fakeShopify().gql), enqueueProfitRecalc: queued }, payload(job.id), {
      retryCount: 0,
      retryLimit: 5,
    });
    expect((await getSyncJob(db, shop, job.id))?.status).toBe('succeeded');
  });

  it('does not queue anything when the sync failed', async () => {
    const queued = vi.fn(async (..._a: unknown[]) => 'id');
    const job = await newJob();
    await runSync(
      { ...deps(fakeShopify({ revoked: true }).gql), enqueueProfitRecalc: queued },
      payload(job.id),
      { retryCount: 0, retryLimit: 5 },
    );
    expect(queued).not.toHaveBeenCalled();
  });
});
