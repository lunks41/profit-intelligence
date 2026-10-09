import { createDb, createPool, getOpsStatus, installShop, listNotifications } from '@pi/db';
import type { InstallResult } from '@pi/db';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { problemsOf, runMonitor } from './monitor.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pool = createPool(APP_URL, 4);
const db = createDb(pool);
const lines: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
const log = {
  info: (msg: string, fields?: Record<string, unknown>) =>
    void lines.push({ level: 'info', msg, fields }),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    void lines.push({ level: 'warn', msg, fields }),
};
const NOW = new Date('2026-10-09T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let a: InstallResult;
let b: InstallResult;
let c: InstallResult;
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
const job = (
  s: InstallResult,
  status: string,
  finished: string | null,
  started: string | null = null,
) =>
  admin.query(
    `insert into o_sync_job (tenant_id, shop_id, kind, status, started_at, finished_at) values ($1,$2,'incremental',$3,$4,$5)`,
    [s.tenantId, s.shopId, status, started, finished],
  );

beforeEach(async () => {
  lines.length = 0;
  await admin.query('truncate m_tenant cascade');
  a = await mk('mon-a.myshopify.com');
  b = await mk('mon-b.myshopify.com');
  c = await mk('mon-c.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

describe('operations status', () => {
  it('reports all clear when every shop imported recently and nothing is waiting', async () => {
    for (const s of [a, b, c]) await job(s, 'succeeded', hoursAgo(2));
    const r = await runMonitor({ db, log, now: () => NOW });
    expect(r.problems).toEqual([]);
    expect(lines.map((l) => l.fields?.event)).toEqual(['monitor_ok']);
    expect(r.status.shops).toEqual({ active: 3, uninstalled: 0 });
  });

  it('counts stale shops, never-imported shops, failed and stuck imports', async () => {
    await job(a, 'succeeded', hoursAgo(40)); // stale
    await job(b, 'succeeded', hoursAgo(1)); // fine
    // c has never imported
    await job(b, 'failed', hoursAgo(3));
    await job(b, 'running', null, hoursAgo(5)); // stuck
    const s = await getOpsStatus(db, NOW);
    expect(s.sync).toEqual({ neverImported: 1, stale: 1, failedLast24h: 1, stuckRunning: 1 });
    expect(
      problemsOf(s)
        .map((p) => p.event)
        .sort(),
    ).toEqual(['sync_failed', 'sync_never', 'sync_stale', 'sync_stuck']);
  });

  it('a recent running import is not stuck, an old failure is not recent, a partial import counts as imported', async () => {
    await job(a, 'running', null, hoursAgo(0.5));
    await job(b, 'failed', hoursAgo(30));
    await job(b, 'partial', hoursAgo(1));
    await job(a, 'succeeded', hoursAgo(1));
    await job(c, 'partial', hoursAgo(2));
    const s = await getOpsStatus(db, NOW);
    expect(s.sync).toEqual({ neverImported: 0, stale: 0, failedLast24h: 0, stuckRunning: 0 });
  });

  it('counts webhook, export, delivery and advertising problems', async () => {
    const t = a.tenantId;
    const sh = a.shopId;
    await admin.query(
      `insert into o_webhook_event (tenant_id, shop_id, webhook_id, topic, status, received_at) values ($1,$2,'w1','orders/create','failed',$3)`,
      [t, sh, hoursAgo(1)],
    );
    await admin.query(
      `insert into o_webhook_event (tenant_id, shop_id, webhook_id, topic, status, received_at) values ($1,$2,'w2','orders/create','received',$3)`,
      [t, sh, hoursAgo(1)],
    ); // waiting an hour
    await admin.query(
      `insert into o_webhook_event (tenant_id, shop_id, webhook_id, topic, status, received_at) values ($1,$2,'w3','orders/create','received',$3)`,
      [t, sh, NOW.toISOString()],
    ); // just arrived: fine
    const ex = (kind: string, status: string, created: string, finished: string | null) =>
      admin.query(
        `insert into o_report_export (tenant_id, shop_id, kind, format, period_from, period_to, status, created_at, finished_at) values ($1,$2,$3,'csv','2026-09-01','2026-09-30',$4,$5,$6) returning id`,
        [t, sh, kind, status, created, finished],
      );
    await ex('products', 'failed', hoursAgo(2), hoursAgo(2));
    const waiting = await ex('orders', 'queued', hoursAgo(1), null);
    await ex('expenses', 'queued', NOW.toISOString(), null); // just queued: fine
    await admin.query(
      `insert into o_report_delivery (tenant_id, shop_id, export_id, recipient, status, created_at) values ($1,$2,$3,'x@y.com','failed',$4)`,
      [t, sh, waiting.rows[0].id, hoursAgo(1)],
    );
    await admin.query(
      `insert into f_ad_account (tenant_id, shop_id, provider, name, currency, status) values ($1,$2,'meta','M','USD','error')`,
      [t, sh],
    );
    await admin.query(
      `insert into f_ad_account (tenant_id, shop_id, provider, name, currency, status, archived_at) values ($1,$2,'meta','Old','USD','error', now())`,
      [t, sh],
    ); // removed: ignored
    const s = await getOpsStatus(db, NOW);
    expect(s.webhooks).toEqual({ failedLast24h: 1, backlog: 1 });
    expect(s.exports).toEqual({ failedLast24h: 1, backlog: 1 });
    expect(s.deliveries).toEqual({ failedLast24h: 1 });
    expect(s.adAccounts).toEqual({ inError: 1 });
  });

  it('uninstalled shops are not counted as stale or never imported', async () => {
    await admin.query("update m_shop set status = 'uninstalled' where id in ($1, $2)", [
      b.shopId,
      c.shopId,
    ]);
    await job(a, 'succeeded', hoursAgo(1));
    const s = await getOpsStatus(db, NOW);
    expect(s.shops).toEqual({ active: 1, uninstalled: 2 });
    expect(s.sync.neverImported).toBe(0);
    expect(s.sync.stale).toBe(0);
  });

  it('writes one structured warning per problem, with an event name a monitor can alert on', async () => {
    await job(a, 'succeeded', hoursAgo(50));
    await job(b, 'succeeded', hoursAgo(1));
    await job(c, 'succeeded', hoursAgo(1));
    await runMonitor({ db, log, now: () => NOW });
    const warns = lines.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.fields).toEqual({ event: 'sync_stale', count: 1 });
    expect(warns[0]!.msg).toContain('36 hours');
  });

  it('what it writes names no shop, order or customer', async () => {
    await job(a, 'succeeded', hoursAgo(50));
    await runMonitor({ db, log, now: () => NOW });
    const text = JSON.stringify(lines);
    for (const s of [a, b, c]) {
      expect(text).not.toContain(s.shopId);
      expect(text).not.toContain(s.tenantId);
    }
    expect(text).not.toContain('myshopify.com');
  });
});

describe('telling shops their data is stale', () => {
  it('tells only the stale shop, once a day, in plain words with where to go', async () => {
    await job(a, 'succeeded', hoursAgo(50));
    await job(b, 'succeeded', hoursAgo(2));
    await job(c, 'succeeded', hoursAgo(2));
    const first = await runMonitor({ db, log, now: () => NOW });
    expect(first.notified).toBe(1);
    const again = await runMonitor({ db, log, now: () => new Date(NOW.getTime() + 3_600_000) });
    expect(again.notified).toBe(0);
    const n = (await listNotifications(db, a)).rows;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: 'data_stale', severity: 'warning', link: '/settings' });
    expect(n[0]!.body).toMatch(/Re-sync now/);
    expect((await listNotifications(db, b)).rows).toEqual([]);
    // still stale the next day: told again
    const next = await runMonitor({ db, log, now: () => new Date(NOW.getTime() + 24 * 3_600_000) });
    expect(next.notified).toBe(1);
    expect((await listNotifications(db, a)).rows).toHaveLength(2);
  });

  it('a shop that imports again is not told', async () => {
    await job(a, 'succeeded', hoursAgo(50));
    await job(a, 'succeeded', hoursAgo(1));
    expect((await runMonitor({ db, log, now: () => NOW })).notified).toBe(0);
  });
});
