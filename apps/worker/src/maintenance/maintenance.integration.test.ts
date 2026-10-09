import {
  createDb,
  createPool,
  createSyncJob,
  finishSyncJob,
  installShop,
  recordWebhookEvent,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { cleanupOldData, reconcileAllShops } from './maintenance.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 4);
const db = createDb(appPool);
const silent = { info() {}, warn() {} };
const send = vi.fn(async (..._a: unknown[]) => 'id');
const boss = { send } as never;

const DAY = 86_400_000;
const WEDNESDAY = new Date('2026-10-07T03:00:00Z');
const SUNDAY = new Date('2026-10-11T03:00:00Z');

let a: InstallResult;
let b: InstallResult;
let c: InstallResult;

const mk = (domain: string) =>
  installShop(db, {
    shopDomain: domain,
    name: domain,
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });
const jobs = async () =>
  (
    await admin.query(
      'select shop_id, kind, status, window_start from o_sync_job order by queued_at',
    )
  ).rows;

async function succeededSync(shop: InstallResult, finishedAt: Date) {
  const { job } = await createSyncJob(db, shop, { kind: 'initial', windowStart: null });
  await withTenant(db, shop.tenantId, (tx) =>
    finishSyncJob(tx, shop, job.id, { status: 'succeeded' }),
  );
  await admin.query('update o_sync_job set finished_at = $1 where id = $2', [finishedAt, job.id]);
}

beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue('id');
  await admin.query('truncate m_tenant cascade');
  a = await mk('mt-a.myshopify.com');
  b = await mk('mt-b.myshopify.com');
  c = await mk('mt-c.myshopify.com');
  await admin.query("update m_shop set status = 'uninstalled' where id = $1", [c.shopId]);
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('reconcileAllShops', () => {
  it('nightly: queues a "what changed since the last good sync" job per active shop only', async () => {
    await succeededSync(a, new Date(WEDNESDAY.getTime() - 2 * DAY));
    const result = await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY });
    expect(result).toEqual({ queued: 2, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(2);

    const rows = (await jobs()).filter((r) => r.kind === 'reconcile');
    expect(rows).toHaveLength(2);
    const forA = rows.find((r) => r.shop_id === a.shopId)!;
    // last success minus one day of overlap
    expect(new Date(forA.window_start).getTime()).toBe(WEDNESDAY.getTime() - 3 * DAY);
    // a shop that never synced gets the full 90 day window
    const forB = rows.find((r) => r.shop_id === b.shopId)!;
    expect(new Date(forB.window_start).getTime()).toBe(WEDNESDAY.getTime() - 90 * DAY);
    // the uninstalled shop is left alone
    expect(rows.find((r) => r.shop_id === c.shopId)).toBeUndefined();
  });

  it('never looks back further than the 90 day history window', async () => {
    await succeededSync(a, new Date(WEDNESDAY.getTime() - 200 * DAY));
    await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY });
    const forA = (await jobs()).find((r) => r.shop_id === a.shopId && r.kind === 'reconcile')!;
    expect(new Date(forA.window_start).getTime()).toBe(WEDNESDAY.getTime() - 90 * DAY);
  });

  it('on Sundays re-checks the whole 90 day window', async () => {
    await succeededSync(a, new Date(SUNDAY.getTime() - DAY));
    await reconcileAllShops({ db, boss, log: silent, now: () => SUNDAY });
    const rows = (await jobs()).filter((r) => r.status === 'queued');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.kind).toBe('incremental');
      expect(new Date(r.window_start).getTime()).toBe(SUNDAY.getTime() - 90 * DAY);
    }
  });

  it('skips a shop that already has a sync queued or running', async () => {
    await createSyncJob(db, a, { kind: 'initial', windowStart: null });
    const result = await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY });
    expect(result).toEqual({ queued: 1, skipped: 1 });
  });

  it('one shop failing does not stop the others, and leaves no blocking job behind', async () => {
    send.mockRejectedValueOnce(new Error('queue hiccup'));
    const result = await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY });
    expect(result).toEqual({ queued: 1, skipped: 0 });
    const failed = (await jobs()).filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    // the next night can queue that shop again
    send.mockResolvedValue('id');
    expect((await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY })).queued).toBe(
      1,
    );
  });

  it('is safe to run twice in a row (no duplicate active jobs)', async () => {
    await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY });
    const second = await reconcileAllShops({ db, boss, log: silent, now: () => WEDNESDAY });
    expect(second).toEqual({ queued: 0, skipped: 2 });
  });
});

describe('cleanupOldData', () => {
  it('removes webhook events older than the retention period across tenants', async () => {
    const ev = (id: string) => ({
      webhookId: id,
      topic: 'orders/updated',
      resourceId: 1,
      triggeredAt: null,
    });
    await recordWebhookEvent(db, a, ev('old-a'));
    await recordWebhookEvent(db, b, ev('old-b'));
    await recordWebhookEvent(db, a, ev('fresh'));
    await admin.query(
      "update o_webhook_event set received_at = now() - interval '20 days' where webhook_id like 'old-%'",
    );
    expect(await cleanupOldData({ db, log: silent })).toBe(2);
    expect(
      Number((await admin.query('select count(*)::int n from o_webhook_event')).rows[0].n),
    ).toBe(1);
  });
});
