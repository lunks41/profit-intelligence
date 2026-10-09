import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createDb,
  createPool,
  createSyncJob,
  getWebhookEvent,
  installShop,
  recordWebhookEvent,
  upsertOrders,
  upsertProducts,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import {
  ShopifyAccessError,
  ShopifyApiError,
  createTokenCrypto,
  mapOrder,
  mapProduct,
} from '@pi/shopify';
import type { ShopifyGraphql } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { processWebhook, runPurge } from './process-webhook.js';
import type { WebhookDeps } from './process-webhook.js';

type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (n: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/shopify/test/fixtures/${n}`, import.meta.url),
      'utf8',
    ),
  );
const orderNodes: Node[] = load('orders-page.json').orders.nodes;
const productNodes: Node[] = load('products-page.json').products.nodes;
const idOf = (gid: string) => Number(gid.split('/').pop());

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 6);
const db = createDb(appPool);
const crypto = createTokenCrypto({ k1: randomBytes(32).toString('base64') }, 'k1');
const silent = { info() {}, warn() {}, error() {} };

let shop: InstallResult;
let other: InstallResult;

interface FakeOptions {
  orders?: Record<string, Node | null>;
  products?: Record<string, Node | null>;
  throwError?: Error;
}
function fakeShopify(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const gql: ShopifyGraphql = {
    async query(q, v = {}) {
      calls.push(
        q.includes('SyncOrderById')
          ? 'order'
          : q.includes('SyncProductById')
            ? 'product'
            : q.includes('SyncInventoryItem')
              ? 'inventory'
              : 'shop',
      );
      if (opts.throwError) throw opts.throwError;
      if (q.includes('SyncOrderById')) {
        const o = (opts.orders ?? {})[v.id as string];
        return { order: o === undefined ? null : o };
      }
      if (q.includes('SyncProductById')) {
        const p = (opts.products ?? {})[v.id as string];
        return { product: p === undefined ? null : p };
      }
      if (q.includes('SyncInventoryItem')) {
        const p = productNodes[0]!;
        return {
          inventoryItem: {
            id: v.id,
            variant: { id: p.variants.nodes[0].id, product: { id: p.id } },
          },
        };
      }
      if (q.includes('shop {'))
        return { shop: { name: 'Renamed', currencyCode: 'EUR', ianaTimezone: 'Europe/Berlin' } };
      throw new Error(`unexpected query ${q.slice(0, 40)}`);
    },
  };
  return { gql, calls };
}

const purgeScheduler = vi.fn(async (..._a: unknown[]) => 'purge-job');
const deps = (gql: ShopifyGraphql): WebhookDeps => ({
  db,
  crypto,
  createGraphql: () => gql,
  schedulePurge: purgeScheduler,
  log: silent,
  historyDays: 3650, // fixtures span several months; the window rule has its own tests
});

async function newEvent(
  topic: string,
  resourceId: number | null,
  who: InstallResult = shop,
  webhookId = `w-${Math.random()}`,
) {
  const { id } = await recordWebhookEvent(db, who, {
    webhookId,
    topic,
    resourceId,
    triggeredAt: new Date(),
  });
  return { ...who, eventId: id };
}
const run = (
  d: WebhookDeps,
  p: Awaited<ReturnType<typeof newEvent>>,
  retryCount = 0,
  retryLimit = 8,
) =>
  processWebhook(
    d,
    { tenantId: p.tenantId, shopId: p.shopId, eventId: p.eventId },
    { retryCount, retryLimit },
  );
const count = async (t: string, where = 'true') =>
  Number((await admin.query(`select count(*)::int n from ${t} where ${where}`)).rows[0].n);
const event = (id: string, who: InstallResult = shop) => getWebhookEvent(db, who, id);

const withRefund = orderNodes.find((o) => o.refunds.length > 0 && !o.cancelledAt)!;
const plain = orderNodes.find((o) => o.refunds.length === 0)!;
const gidOrder = (n: Node) => n.id as string;

beforeEach(async () => {
  purgeScheduler.mockClear();
  await admin.query('truncate m_tenant cascade');
  const mk = (domain: string) =>
    installShop(db, {
      shopDomain: domain,
      name: domain,
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: crypto.encrypt('shpat_x').value,
      keyId: 'k1',
      scopes: 'read_orders',
    });
  shop = await mk('pw-a.myshopify.com');
  other = await mk('pw-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('orders and refunds', () => {
  it('orders/updated fetches the current order and stores it', async () => {
    const fake = fakeShopify({ orders: { [gidOrder(plain)]: plain } });
    const ev = await newEvent('orders/updated', idOf(plain.id));
    await run(deps(fake.gql), ev);
    expect(await count('t_order')).toBe(1);
    expect((await admin.query('select name from t_order')).rows[0].name).toBe(plain.name);
    expect(await event(ev.eventId)).toMatchObject({ status: 'processed', attempts: 1 });
    expect(fake.calls).toEqual(['order']);
  });

  it('refunds/create refreshes the order together with its refund', async () => {
    const fake = fakeShopify({ orders: { [gidOrder(withRefund)]: withRefund } });
    const ev = await newEvent('refunds/create', idOf(withRefund.id)); // resource id is the ORDER id
    await run(deps(fake.gql), ev);
    expect(await count('t_refund')).toBe(withRefund.refunds.length);
    expect(
      Number((await admin.query('select refunded_amount::numeric n from t_order')).rows[0].n),
    ).toBeGreaterThan(0);
  });

  it('is idempotent when the same event is processed twice (job redelivery)', async () => {
    const fake = fakeShopify({ orders: { [gidOrder(plain)]: plain } });
    const ev = await newEvent('orders/create', idOf(plain.id));
    await run(deps(fake.gql), ev);
    await run(deps(fake.gql), ev); // already processed: no second fetch
    expect(fake.calls).toEqual(['order']);
    expect(await count('t_order')).toBe(1);
  });

  it('two different webhooks for the same order converge on one row', async () => {
    const fake = fakeShopify({ orders: { [gidOrder(plain)]: plain } });
    await run(deps(fake.gql), await newEvent('orders/create', idOf(plain.id)));
    await run(deps(fake.gql), await newEvent('orders/updated', idOf(plain.id)));
    expect(await count('t_order')).toBe(1);
    expect(await count('t_order_line_item')).toBe(plain.lineItems.nodes.length);
  });

  it('out-of-order delivery cannot roll data back: an older fetched state is skipped', async () => {
    const newer = structuredClone(plain);
    newer.updatedAt = new Date(new Date(plain.updatedAt).getTime() + 60_000).toISOString();
    newer.displayFinancialStatus = 'REFUNDED';
    await withTenant(db, shop.tenantId, (tx) => upsertOrders(tx, shop, [mapOrder(newer)]));
    const fake = fakeShopify({ orders: { [gidOrder(plain)]: plain } }); // Shopify answers with an older copy
    await run(deps(fake.gql), await newEvent('orders/updated', idOf(plain.id)));
    expect(
      (await admin.query('select financial_status from t_order')).rows[0].financial_status,
    ).toBe('REFUNDED');
  });

  it('removes a local order that no longer exists in Shopify', async () => {
    await withTenant(db, shop.tenantId, (tx) => upsertOrders(tx, shop, [mapOrder(plain)]));
    const fake = fakeShopify({ orders: {} }); // order(id) -> null
    await run(deps(fake.gql), await newEvent('orders/updated', idOf(plain.id)));
    expect(await count('t_order')).toBe(0);
  });

  it('orders/delete removes the order without calling Shopify', async () => {
    await withTenant(db, shop.tenantId, (tx) => upsertOrders(tx, shop, [mapOrder(plain)]));
    const fake = fakeShopify();
    await run(deps(fake.gql), await newEvent('orders/delete', idOf(plain.id)));
    expect(await count('t_order')).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('ignores an order event without a resource id', async () => {
    const ev = await newEvent('orders/updated', null);
    await run(deps(fakeShopify().gql), ev);
    expect((await event(ev.eventId))?.status).toBe('ignored');
  });
});

describe('history window', () => {
  const NOW = new Date('2026-10-09T12:00:00Z');
  const windowed = (gql: ShopifyGraphql): WebhookDeps => ({
    ...deps(gql),
    historyDays: 90,
    now: () => NOW,
  });
  const old = orderNodes.find((o) => new Date(o.processedAt) < new Date('2026-07-01'))!;
  const recent = {
    ...structuredClone(orderNodes[0]!),
    processedAt: '2026-10-01T10:00:00Z',
  } as Node;

  it('ignores a webhook about an order older than the window that we do not hold', async () => {
    const ev = await newEvent('orders/updated', idOf(old.id));
    await run(windowed(fakeShopify({ orders: { [gidOrder(old)]: old } }).gql), ev);
    expect(await count('t_order')).toBe(0);
    expect(await event(ev.eventId)).toMatchObject({
      status: 'ignored',
      error: 'Order is outside the history window',
    });
  });

  it('still updates an old order we already hold (e.g. a late refund)', async () => {
    await withTenant(db, shop.tenantId, (tx) => upsertOrders(tx, shop, [mapOrder(old)]));
    const changed = structuredClone(old);
    changed.updatedAt = new Date(new Date(old.updatedAt).getTime() + 60_000).toISOString();
    changed.displayFinancialStatus = 'REFUNDED';
    await run(
      windowed(fakeShopify({ orders: { [gidOrder(old)]: changed } }).gql),
      await newEvent('refunds/create', idOf(old.id)),
    );
    expect(
      (await admin.query('select financial_status from t_order')).rows[0].financial_status,
    ).toBe('REFUNDED');
  });

  it('stores an order inside the window', async () => {
    await run(
      windowed(fakeShopify({ orders: { [gidOrder(recent)]: recent } }).gql),
      await newEvent('orders/create', idOf(recent.id)),
    );
    expect(await count('t_order')).toBe(1);
  });
});

describe('products and inventory', () => {
  const product = productNodes[0]!;

  it('products/update stores the product and its variants', async () => {
    const fake = fakeShopify({ products: { [product.id]: product } });
    await run(deps(fake.gql), await newEvent('products/update', idOf(product.id)));
    expect(await count('t_product')).toBe(1);
    expect(await count('t_product_variant')).toBe(product.variants.nodes.length);
  });

  it('products/delete soft-deletes (order history still refers to the product)', async () => {
    await withTenant(db, shop.tenantId, (tx) => upsertProducts(tx, shop, [mapProduct(product)]));
    await run(deps(fakeShopify().gql), await newEvent('products/delete', idOf(product.id)));
    expect(await count('t_product', 'deleted_at is not null')).toBe(1);
    expect(await count('t_product_variant')).toBe(product.variants.nodes.length);
  });

  it('a product that vanished from Shopify is marked deleted', async () => {
    await withTenant(db, shop.tenantId, (tx) => upsertProducts(tx, shop, [mapProduct(product)]));
    await run(
      deps(fakeShopify({ products: {} }).gql),
      await newEvent('products/update', idOf(product.id)),
    );
    expect(await count('t_product', 'deleted_at is not null')).toBe(1);
  });

  it('inventory_items/update picks up a changed unit cost', async () => {
    const changed = structuredClone(product);
    changed.variants.nodes[0].inventoryItem.unitCost = { amount: '12.34' };
    const fake = fakeShopify({ products: { [product.id]: changed } });
    await run(deps(fake.gql), await newEvent('inventory_items/update', 123));
    const { rows } = await admin.query(
      'select unit_cost_amount::text c from t_product_variant where shopify_id = $1',
      [idOf(changed.variants.nodes[0].id)],
    );
    expect(rows[0].c).toBe('12.3400');
    expect(fake.calls).toEqual(['inventory', 'product']);
  });

  it('shop/update refreshes currency and time zone', async () => {
    await run(deps(fakeShopify().gql), await newEvent('shop/update', null));
    const { rows } = await admin.query('select currency, iana_timezone from m_shop where id = $1', [
      shop.shopId,
    ]);
    expect(rows[0]).toEqual({ currency: 'EUR', iana_timezone: 'Europe/Berlin' });
  });
});

describe('uninstall and privacy', () => {
  it('app/uninstalled marks the shop, removes the token, cancels syncs and schedules the purge', async () => {
    await createSyncJob(db, shop, { kind: 'initial', windowStart: null });
    const fake = fakeShopify();
    const ev = await newEvent('app/uninstalled', null);
    await run(deps(fake.gql), ev);

    expect(
      (await admin.query('select status from m_shop where id = $1', [shop.shopId])).rows[0].status,
    ).toBe('uninstalled');
    expect(await count('s_shop_credential', `shop_id = '${shop.shopId}'`)).toBe(0);
    expect(await count('o_sync_job', "status = 'cancelled'")).toBe(1);
    expect(purgeScheduler).toHaveBeenCalledTimes(1);
    const arg = purgeScheduler.mock.calls[0]![0] as { shopId: string; uninstalledAt: string };
    expect(arg.shopId).toBe(shop.shopId);
    expect(new Date(arg.uninstalledAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await event(ev.eventId))?.status).toBe('processed');
    expect(fake.calls).toEqual([]); // no Shopify call needed (the token is already gone)
    // the other shop is untouched
    expect(await count('s_shop_credential', `shop_id = '${other.shopId}'`)).toBe(1);
  });

  it('webhooks arriving after the uninstall are ignored, not retried', async () => {
    await run(deps(fakeShopify().gql), await newEvent('app/uninstalled', null));
    const late = await newEvent('orders/updated', 5);
    const fake = fakeShopify();
    await run(deps(fake.gql), late);
    expect(await event(late.eventId)).toMatchObject({
      status: 'ignored',
      error: 'Shop is not active',
    });
    expect(fake.calls).toEqual([]);
  });

  it('shop/redact deletes all shop data immediately (overrides the grace period)', async () => {
    await withTenant(db, shop.tenantId, (tx) => upsertOrders(tx, shop, orderNodes.map(mapOrder)));
    await withTenant(db, other.tenantId, (tx) => upsertOrders(tx, other, [mapOrder(plain)]));
    await run(deps(fakeShopify().gql), await newEvent('shop/redact', null));
    expect(await count('m_shop', `id = '${shop.shopId}'`)).toBe(0);
    expect(await count('m_tenant', `id = '${shop.tenantId}'`)).toBe(0);
    expect(await count('t_order', `tenant_id = '${shop.tenantId}'`)).toBe(0);
    expect(await count('t_order', `tenant_id = '${other.tenantId}'`)).toBe(1);
  });

  it('customer privacy requests are acknowledged: no customer personal data is stored', async () => {
    for (const topic of ['customers/redact', 'customers/data_request']) {
      const fake = fakeShopify();
      const ev = await newEvent(topic, 99);
      await run(deps(fake.gql), ev);
      expect(await event(ev.eventId)).toMatchObject({
        status: 'ignored',
        error: 'No customer personal data is stored',
      });
      expect(fake.calls).toEqual([]);
    }
  });

  it('an unknown topic is ignored', async () => {
    const ev = await newEvent('carts/create', 1);
    await run(deps(fakeShopify().gql), ev);
    expect((await event(ev.eventId))?.status).toBe('ignored');
  });
});

describe('failures', () => {
  it('a transient Shopify error is recorded and rethrown so the queue retries', async () => {
    const ev = await newEvent('orders/updated', idOf(plain.id));
    const fake = fakeShopify({
      throwError: new ShopifyApiError('Shopify request failed (status 502)'),
    });
    await expect(run(deps(fake.gql), ev, 0)).rejects.toThrow();
    expect(await event(ev.eventId)).toMatchObject({ status: 'processing', attempts: 1 });
    expect((await event(ev.eventId))?.error).toMatch(/502/);

    // the retry succeeds
    const ok = fakeShopify({ orders: { [gidOrder(plain)]: plain } });
    await run(deps(ok.gql), ev, 1);
    expect(await event(ev.eventId)).toMatchObject({
      status: 'processed',
      attempts: 2,
      error: null,
    });
  });

  it('gives up after the last retry and marks the event failed', async () => {
    const ev = await newEvent('orders/updated', idOf(plain.id));
    const fake = fakeShopify({ throwError: new ShopifyApiError('Shopify throttled the request') });
    await expect(run(deps(fake.gql), ev, 8, 8)).rejects.toThrow();
    const row = await event(ev.eventId);
    expect(row?.status).toBe('failed');
    expect(row?.error).toMatch(/Gave up after 9 attempts/);
  });

  it('a rejected token flags the shop for reconnection and is not retried', async () => {
    const ev = await newEvent('orders/updated', idOf(plain.id));
    const fake = fakeShopify({ throwError: new ShopifyAccessError(401) });
    await expect(run(deps(fake.gql), ev)).resolves.toBeUndefined();
    expect(
      (await admin.query('select status from m_shop where id = $1', [shop.shopId])).rows[0].status,
    ).toBe('reauth_required');
    expect((await event(ev.eventId))?.status).toBe('failed');
  });

  it('does nothing for an event that belongs to another tenant', async () => {
    const ev = await newEvent('orders/updated', idOf(plain.id), other);
    const fake = fakeShopify({ orders: { [gidOrder(plain)]: plain } });
    await processWebhook(
      deps(fake.gql),
      { tenantId: shop.tenantId, shopId: shop.shopId, eventId: ev.eventId },
      { retryCount: 0, retryLimit: 8 },
    );
    expect(fake.calls).toEqual([]);
    expect(await count('t_order')).toBe(0);
    expect((await event(ev.eventId, other))?.status).toBe('received');
  });
});

describe('delayed purge', () => {
  it('deletes the shop when it is still uninstalled after the grace period', async () => {
    await run(deps(fakeShopify().gql), await newEvent('app/uninstalled', null));
    const arg = purgeScheduler.mock.calls[0]![0] as {
      tenantId: string;
      shopId: string;
      uninstalledAt: string;
    };
    await runPurge({ db, log: silent }, arg);
    expect(await count('m_shop', `id = '${shop.shopId}'`)).toBe(0);
  });

  it('keeps the shop when the merchant re-installed meanwhile', async () => {
    await run(deps(fakeShopify().gql), await newEvent('app/uninstalled', null));
    const arg = purgeScheduler.mock.calls[0]![0] as {
      tenantId: string;
      shopId: string;
      uninstalledAt: string;
    };
    await installShop(db, {
      shopDomain: 'pw-a.myshopify.com',
      name: 'a',
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: 'x',
      keyId: 'k1',
      scopes: 'read_orders',
    });
    await runPurge({ db, log: silent }, arg);
    expect(await count('m_shop', `id = '${shop.shopId}'`)).toBe(1);
  });
});

describe('profit recalculation trigger', () => {
  const queued = vi.fn(async (..._a: unknown[]) => 'id');
  const withQueue = (gql: ShopifyGraphql): WebhookDeps => ({
    ...deps(gql),
    enqueueProfitRecalc: queued,
  });
  beforeEach(() => queued.mockClear());

  it('an order webhook queues a recalculation of that order only', async () => {
    const fake = fakeShopify({ orders: { [gidOrder(plain)]: plain } });
    await run(withQueue(fake.gql), await newEvent('orders/updated', idOf(plain.id)));
    expect(queued).toHaveBeenCalledWith({
      tenantId: shop.tenantId,
      shopId: shop.shopId,
      orderShopifyIds: [idOf(plain.id)],
    });
  });

  it('a refund webhook queues the refunded order', async () => {
    const fake = fakeShopify({ orders: { [gidOrder(withRefund)]: withRefund } });
    await run(withQueue(fake.gql), await newEvent('refunds/create', idOf(withRefund.id)));
    expect(queued).toHaveBeenCalledWith(
      expect.objectContaining({ orderShopifyIds: [idOf(withRefund.id)] }),
    );
  });

  it('topics that cannot change profit queue nothing (product, shop, deletion, ignored order)', async () => {
    const product = productNodes[0]!;
    await run(
      withQueue(fakeShopify({ products: { [product.id]: product } }).gql),
      await newEvent('products/update', idOf(product.id)),
    );
    await run(withQueue(fakeShopify().gql), await newEvent('shop/update', null));
    await run(withQueue(fakeShopify().gql), await newEvent('orders/delete', idOf(plain.id)));
    expect(queued).not.toHaveBeenCalled();
  });

  it('a failure to queue does not fail or retry the webhook (the nightly run covers it)', async () => {
    const broken: WebhookDeps = {
      ...deps(fakeShopify({ orders: { [gidOrder(plain)]: plain } }).gql),
      enqueueProfitRecalc: async () => {
        throw new Error('queue down');
      },
    };
    const ev = await newEvent('orders/updated', idOf(plain.id));
    await run(broken, ev);
    expect((await event(ev.eventId))?.status).toBe('processed');
  });
});

describe('app_subscriptions/update', () => {
  const subsGql = (subs: Array<Record<string, unknown>>) => {
    const calls: string[] = [];
    const gql: ShopifyGraphql = {
      async query(q) {
        calls.push(q);
        if (q.includes('activeSubscriptions')) {
          return { currentAppInstallation: { activeSubscriptions: subs } };
        }
        throw new Error('unexpected query');
      },
    };
    return { gql, calls };
  };
  const sub = (name: string, status = 'ACTIVE') => ({
    id: 'gid://shopify/AppSubscription/5',
    name,
    status,
    test: true,
    currentPeriodEnd: '2026-11-09T00:00:00Z',
  });
  const billingOn = { mode: 'managed' as const, betaPlan: 'pro' as const };
  const stored = async (who: InstallResult = shop) =>
    (
      await admin.query(
        'select plan, status, plan_name, is_test from s_subscription where shop_id = $1',
        [who.shopId],
      )
    ).rows[0];

  it('asks Shopify what the subscription is and stores that, not what the payload says', async () => {
    const { gql, calls } = subsGql([sub('Growth')]);
    const ev = await newEvent('app_subscriptions/update', null);
    await run({ ...deps(gql), billing: billingOn }, ev);
    expect(calls).toHaveLength(1);
    expect(await stored()).toMatchObject({
      plan: 'growth',
      status: 'active',
      plan_name: 'Growth',
      is_test: true,
    });
    expect((await event(ev.eventId))?.status).toBe('processed');
  });

  it('a cancelled subscription puts the shop back on free, and replaying the event changes nothing', async () => {
    await run(
      { ...deps(subsGql([sub('Pro')]).gql), billing: billingOn },
      await newEvent('app_subscriptions/update', null),
    );
    expect(await stored()).toMatchObject({ plan: 'pro', status: 'active' });
    const none = subsGql([]);
    await run(
      { ...deps(none.gql), billing: billingOn },
      await newEvent('app_subscriptions/update', null),
    );
    expect(await stored()).toMatchObject({ plan: 'free', status: 'none' });
    await run(
      { ...deps(none.gql), billing: billingOn },
      await newEvent('app_subscriptions/update', null),
    );
    expect(await stored()).toMatchObject({ plan: 'free', status: 'none' });
    expect(await count('s_subscription', `shop_id = '${shop.shopId}'`)).toBe(1);
  });

  it('pauses scheduled emails beyond the new plan, without deleting them', async () => {
    await run(
      { ...deps(subsGql([sub('Growth')]).gql), billing: billingOn },
      await newEvent('app_subscriptions/update', null),
    );
    for (const r of ['a', 'b', 'c']) {
      await admin.query(
        `insert into s_report_schedule (tenant_id, shop_id, kind, format, frequency, weekday, hour, recipients)
         values ($1, $2, 'products', 'csv', 'weekly', 1, 8, ARRAY[$3])`,
        [shop.tenantId, shop.shopId, `${r}@x.com`],
      );
    }
    await run(
      { ...deps(subsGql([]).gql), billing: billingOn },
      await newEvent('app_subscriptions/update', null),
    );
    expect(await count('s_report_schedule', `shop_id = '${shop.shopId}'`)).toBe(3);
    expect(await count('s_report_schedule', `shop_id = '${shop.shopId}' and enabled`)).toBe(0);
  });

  it('only changes the shop the event belongs to', async () => {
    await run(
      { ...deps(subsGql([sub('Pro')]).gql), billing: billingOn },
      await newEvent('app_subscriptions/update', null),
    );
    expect(await stored(other)).toBeUndefined();
  });

  it('with billing off it stores what Shopify says but the shop keeps the beta plan', async () => {
    await run(deps(subsGql([sub('Growth')]).gql), await newEvent('app_subscriptions/update', null));
    expect(await stored()).toMatchObject({ plan: 'growth', status: 'active' });
    expect(await count('s_report_schedule')).toBe(0);
  });

  it('a Shopify failure is retried by the queue, and nothing is changed meanwhile', async () => {
    const broken: ShopifyGraphql = {
      query: async () => {
        throw new ShopifyApiError('boom', 500);
      },
    };
    const ev = await newEvent('app_subscriptions/update', null);
    await expect(run({ ...deps(broken), billing: billingOn }, ev, 0, 8)).rejects.toThrow();
    expect(await stored()).toBeUndefined();
  });
});
