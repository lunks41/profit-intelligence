import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mapOrder } from '../../shopify/src/sync-mappers.js';
import { createDb, createPool, withSystem, withTenant } from '../src/client.js';
import { installShop } from '../src/installations.js';
import type { InstallResult } from '../src/installations.js';
import { createSyncJob, upsertOrders } from '../src/sync.js';
import type { OrderInput } from '../src/sync.js';
import {
  claimWebhookEvent,
  getWebhookHealth,
  deleteExpiredWebhookEvents,
  deleteOrderByShopifyId,
  finishWebhookEvent,
  getLastWebhookAt,
  getWebhookEvent,
  listActiveShops,
  markShopUninstalled,
  purgeShopData,
  recordWebhookEvent,
} from '../src/webhooks.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const orderNodes = JSON.parse(
  readFileSync(new URL('../../shopify/test/fixtures/orders-page.json', import.meta.url), 'utf8'),
).orders.nodes as Record<string, unknown>[];
const orders = (): OrderInput[] => orderNodes.map(mapOrder);

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 6);
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
const count = async (table: string, where = 'true') =>
  Number((await admin.query(`select count(*)::int n from ${table} where ${where}`)).rows[0].n);
const event = (id: string, topic = 'orders/updated') => ({
  webhookId: id,
  topic,
  resourceId: 123,
  triggeredAt: new Date(),
});

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await install('wh-a.myshopify.com');
  b = await install('wh-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('webhook events', () => {
  it('records a delivery once and reports redeliveries as duplicates', async () => {
    const first = await recordWebhookEvent(db, a, event('wh-1'));
    const again = await recordWebhookEvent(db, a, event('wh-1'));
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ id: first.id, duplicate: true });
    expect(await count('o_webhook_event')).toBe(1);
  });

  it('survives concurrent deliveries of the same webhook id', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recordWebhookEvent(db, a, event('wh-race'))),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await count('o_webhook_event')).toBe(1);
  });

  it('uses the webhook id per shop (two shops may receive the same id)', async () => {
    await recordWebhookEvent(db, a, event('same'));
    const other = await recordWebhookEvent(db, b, event('same'));
    expect(other.duplicate).toBe(false);
    expect(await count('o_webhook_event')).toBe(2);
  });

  it('tracks processing state and attempts', async () => {
    const { id } = await recordWebhookEvent(db, a, event('wh-2'));
    await withTenant(db, a.tenantId, (tx) => claimWebhookEvent(tx, a, id));
    await withTenant(db, a.tenantId, (tx) => claimWebhookEvent(tx, a, id));
    expect(await getWebhookEvent(db, a, id)).toMatchObject({ status: 'processing', attempts: 2 });
    await withTenant(db, a.tenantId, (tx) =>
      finishWebhookEvent(tx, a, id, { status: 'processed' }),
    );
    const done = await getWebhookEvent(db, a, id);
    expect(done?.status).toBe('processed');
    expect(done?.processedAt).toBeInstanceOf(Date);
    expect(await getLastWebhookAt(db, a)).toBeInstanceOf(Date);
  });

  it("keeps tenants apart: B cannot read A's events", async () => {
    const { id } = await recordWebhookEvent(db, a, event('wh-3'));
    expect(await getWebhookEvent(db, { tenantId: b.tenantId, shopId: a.shopId }, id)).toBeNull();
  });

  it('deletes expired events across tenants and keeps recent ones', async () => {
    await recordWebhookEvent(db, a, event('old-a'));
    await recordWebhookEvent(db, b, event('old-b'));
    await recordWebhookEvent(db, a, event('fresh'));
    await admin.query(
      "update o_webhook_event set received_at = now() - interval '20 days' where webhook_id like 'old-%'",
    );
    const deleted = await deleteExpiredWebhookEvents(db, new Date(Date.now() - 14 * 86_400_000));
    expect(deleted).toBe(2);
    expect(await count('o_webhook_event')).toBe(1);
  });
});

describe('order deletion', () => {
  it('removes an order and its children, leaving other orders', async () => {
    await withTenant(db, a.tenantId, (tx) => upsertOrders(tx, a, orders()));
    const target = orders().find((o) => o.refunds.length > 0)!;
    await withTenant(db, a.tenantId, (tx) => deleteOrderByShopifyId(tx, a, target.order.shopifyId));
    expect(await count('t_order')).toBe(orderNodes.length - 1);
    expect(await count('t_refund', `order_id not in (select id from t_order)`)).toBe(0);
  });
});

describe('uninstall and purge', () => {
  it('uninstall drops the credential, cancels active sync jobs and starts the grace period', async () => {
    await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    const at = await markShopUninstalled(db, a);
    expect(at).toBeInstanceOf(Date);
    const shop = (
      await admin.query('select status, uninstalled_at from m_shop where id = $1', [a.shopId])
    ).rows[0];
    expect(shop.status).toBe('uninstalled');
    expect(await count('s_shop_credential', `shop_id = '${a.shopId}'`)).toBe(0);
    expect(await count('o_sync_job', `shop_id = '${a.shopId}' and status = 'cancelled'`)).toBe(1);
    // the other shop is untouched
    expect(await count('s_shop_credential', `shop_id = '${b.shopId}'`)).toBe(1);
  });

  it('purge removes every row of the shop and the tenant, and nothing of other tenants', async () => {
    await withTenant(db, a.tenantId, (tx) => upsertOrders(tx, a, orders()));
    await withTenant(db, b.tenantId, (tx) => upsertOrders(tx, b, orders().slice(0, 3)));
    await recordWebhookEvent(db, a, event('p-1'));
    await createSyncJob(db, a, { kind: 'initial', windowStart: null });

    expect(await purgeShopData(db, a)).toEqual({ purged: true });
    for (const t of [
      't_order',
      't_order_line_item',
      't_refund',
      't_refund_line_item',
      't_order_transaction',
      't_product',
      't_product_variant',
      'o_webhook_event',
      'o_sync_job',
      's_shop_credential',
    ]) {
      expect(await count(t, `tenant_id = '${a.tenantId}'`), t).toBe(0);
    }
    expect(await count('m_shop', `id = '${a.shopId}'`)).toBe(0);
    expect(await count('m_tenant', `id = '${a.tenantId}'`)).toBe(0);
    // tenant B intact
    expect(await count('t_order', `tenant_id = '${b.tenantId}'`)).toBe(3);
    expect(await count('m_tenant', `id = '${b.tenantId}'`)).toBe(1);
  });

  it('delayed purge is skipped when the merchant re-installed during the grace period', async () => {
    const uninstalledAt = await markShopUninstalled(db, a);
    await install('wh-a.myshopify.com'); // re-install: shop becomes active again
    expect(await purgeShopData(db, a, { onlyIfUninstalledAt: uninstalledAt })).toEqual({
      purged: false,
    });
    expect(await count('m_shop', `id = '${a.shopId}'`)).toBe(1);
  });

  it('delayed purge runs when the shop is still uninstalled', async () => {
    const uninstalledAt = await markShopUninstalled(db, a);
    expect(await purgeShopData(db, a, { onlyIfUninstalledAt: uninstalledAt })).toEqual({
      purged: true,
    });
    expect(await count('m_shop', `id = '${a.shopId}'`)).toBe(0);
  });

  it('purge of an unknown shop does nothing', async () => {
    expect(await purgeShopData(db, { tenantId: a.tenantId, shopId: b.shopId })).toEqual({
      purged: false,
    });
    expect(await count('m_shop')).toBe(2);
  });
});

describe('system context', () => {
  it('lists active shops across tenants (ids only) but not uninstalled ones', async () => {
    await markShopUninstalled(db, b);
    const shops = await listActiveShops(db);
    expect(shops).toEqual([{ tenantId: a.tenantId, shopId: a.shopId }]);
  });

  it('is not available without being asked for: plain queries still see nothing', async () => {
    const rows = await appPool.query('select * from m_shop');
    expect(rows.rowCount).toBe(0);
  });

  it('exposes no business data and allows no writes to shops', async () => {
    await withTenant(db, a.tenantId, (tx) => upsertOrders(tx, a, orders()));
    const result = await withSystem(db, async (tx) => ({
      orders: (await tx.execute(sql`select count(*)::int n from t_order`)).rows[0],
      credentials: (await tx.execute(sql`select count(*)::int n from s_shop_credential`)).rows[0],
      updated: (await tx.execute(sql`update m_shop set status = 'uninstalled'`)).rowCount,
      deleted: (await tx.execute(sql`delete from m_shop`)).rowCount,
    }));
    expect(result.orders).toEqual({ n: 0 });
    expect(result.credentials).toEqual({ n: 0 });
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
    expect(await count('m_shop')).toBe(2);
  });
});

describe('webhook health', () => {
  it('reports nothing for a shop without events', async () => {
    expect(await getWebhookHealth(db, a)).toEqual({ lastReceivedAt: null, failedLast24h: 0 });
  });

  it('reports the last delivery and only counts recent permanent failures', async () => {
    const first = await recordWebhookEvent(db, a, event('h-1'));
    const second = await recordWebhookEvent(db, a, event('h-2'));
    const third = await recordWebhookEvent(db, a, event('h-3'));
    await withTenant(db, a.tenantId, (tx) =>
      finishWebhookEvent(tx, a, first.id, { status: 'failed', error: 'x' }),
    );
    await withTenant(db, a.tenantId, (tx) =>
      finishWebhookEvent(tx, a, second.id, { status: 'failed', error: 'x' }),
    );
    await withTenant(db, a.tenantId, (tx) =>
      finishWebhookEvent(tx, a, third.id, { status: 'processed' }),
    );
    await admin.query(
      "update o_webhook_event set received_at = now() - interval '3 days' where id = $1",
      [first.id],
    );
    const health = await getWebhookHealth(db, a);
    expect(health.failedLast24h).toBe(1); // the 3-day-old failure no longer counts
    expect(health.lastReceivedAt).toBeInstanceOf(Date);
    // another tenant sees none of it
    expect(await getWebhookHealth(db, b)).toEqual({ lastReceivedAt: null, failedLast24h: 0 });
  });
});
