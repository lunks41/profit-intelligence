import { readFileSync } from 'node:fs';
import {
  createDb,
  createExport,
  createDeliveries,
  createPool,
  createSchedule,
  deleteExpiredExports,
  getExport,
  getProfitAggregate,
  installShop,
  listDeliveries,
  listExports,
  listNotifications,
  loadOrdersForProfit,
  replaceProfitEntries,
  upsertOrders,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { calculateOrder, summarizePeriod } from '@pi/profit-engine';
import type { EngineConfig, EngineOrder } from '@pi/profit-engine';
import { buildReport } from '@pi/reports';
import { mapOrder } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { deliverExport, processExport } from './export.js';
import { MailNotConfigured } from './mail.js';
import type { Mail, MailSender } from './mail.js';
import { runDueSchedules } from './schedule.js';
import type * as realTypes from '@pi/reports';

// One test makes the report builder fail; the others use the real one.
const failNext = vi.hoisted(() => ({ on: false }));
vi.mock('@pi/reports', async (orig) => {
  const real = (await orig()) as Record<string, unknown> & typeof realTypes;
  return {
    ...real,
    buildReport: async (...args: Parameters<typeof real.buildReport>) => {
      if (failNext.on) {
        failNext.on = false;
        throw new Error('Something broke while building the report');
      }
      return real.buildReport(...args);
    },
  };
});

const orderNodes = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shopify/test/fixtures/orders-page.json', import.meta.url),
    'utf8',
  ),
).orders.nodes as Record<string, unknown>[];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pool = createPool(APP_URL, 4);
const db = createDb(pool);
const silent = { info() {}, warn() {} };
const send = vi.fn(async (..._a: unknown[]) => 'job');
const boss = { send } as never;

let a: InstallResult;
let b: InstallResult;

const mk = (d: string, tz = 'UTC') =>
  installShop(db, {
    shopDomain: d,
    name: d,
    currency: 'USD',
    ianaTimezone: tz,
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });

async function seed(who: InstallResult) {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, orderNodes.map(mapOrder)));
  const loaded = await withTenant(db, who.tenantId, (tx) =>
    loadOrdersForProfit(tx, who, { limit: 1000 }),
  );
  const cfg: EngineConfig = {
    timezone: 'UTC',
    merchantCosts: new Map(),
    shopifyCosts: new Map(),
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

const fakeMail = () => {
  const sent: Mail[] = [];
  const sender: MailSender = { send: async (m) => void sent.push(m) };
  return { sent, sender };
};

const exportFor = (who: InstallResult, over: Partial<{ kind: string; format: string }> = {}) =>
  createExport(db, who, {
    kind: over.kind ?? 'products',
    format: over.format ?? 'csv',
    from: '2026-01-01',
    to: '2026-10-09',
    requestedBy: 'test',
  });
const payload = (who: InstallResult, exportId: string) => ({
  tenantId: who.tenantId,
  shopId: who.shopId,
  exportId,
});
const fileOf = async (id: string) =>
  (
    await admin.query(
      'select content, status, size_bytes, expires_at from o_report_export where id = $1',
      [id],
    )
  ).rows[0];

beforeEach(async () => {
  send.mockClear();
  failNext.on = false;
  await admin.query('truncate m_tenant cascade');
  a = await mk('rw-a.myshopify.com');
  b = await mk('rw-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

describe('building an export', () => {
  it.each(['profit_loss', 'products', 'orders', 'marketing', 'expenses'])(
    'builds the %s report as CSV and as PDF',
    async (kind) => {
      await seed(a);
      for (const format of ['csv', 'pdf']) {
        const exp = await exportFor(a, { kind, format });
        const mail = fakeMail();
        const r = await processExport(
          { db, boss, log: silent, mail: mail.sender },
          payload(a, exp.id),
        );
        expect(r).toBe('done');
        const row = await fileOf(exp.id);
        expect(row.status).toBe('ready');
        expect(row.size_bytes).toBe(row.content.length);
        if (format === 'pdf') expect(row.content.subarray(0, 5).toString()).toBe('%PDF-');
        else expect(row.content.toString('utf8').startsWith('﻿')).toBe(true);
        const done = (await getExport(db, a, exp.id))!;
        expect(done.expiresAt).not.toBeNull();
      }
    },
  );

  it('the order CSV has one row per counted order and its totals add up', async () => {
    await seed(a);
    const exp = await exportFor(a, { kind: 'orders' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    const lines = (await fileOf(exp.id)).content.toString('utf8').trim().split('\r\n');
    const { rows } = await admin.query(
      "select count(*)::int n, coalesce(sum(contribution_amount),0)::numeric(19,4)::text p from f_order_profit where shop_id = $1 and recognized and order_date between '2026-01-01' and '2026-10-09'",
      [a.shopId],
    );
    expect(lines.length - 2).toBe(rows[0].n); // header and total row
    const total = lines.at(-1)!.split(',');
    expect(total[0]).toBe(`Total (${rows[0].n} orders)`);
    expect(Number(total[7]).toFixed(2)).toBe(Number(rows[0].p).toFixed(2));
  });

  it('the product CSV total row equals the Overview figure', async () => {
    await seed(a);
    const exp = await exportFor(a, { kind: 'products' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    const text = (await fileOf(exp.id)).content.toString('utf8');
    const last = text.trim().split('\r\n').at(-1)!;
    expect(last).toMatch(/^Contribution profit \(matches the Overview\)/);
    const { rows } = await admin.query(
      "select coalesce(sum(amount),0)::numeric(19,4)::text p from f_profit_entry where shop_id = $1 and not memo and component not in ('tax_collected','tax_refunded')",
      [a.shopId],
    );
    expect(Number(last.split(',')[8]).toFixed(2)).toBe(Number(rows[0].p).toFixed(2));
  });

  it('announces a requested report and leaves a scheduled one to its email', async () => {
    await seed(a);
    const asked = await exportFor(a);
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, asked.id));
    const s = await createSchedule(db, a, {
      kind: 'products',
      format: 'csv',
      frequency: 'weekly',
      weekday: 1,
      hour: 8,
      recipients: ['o@x.com'],
      createdBy: 't',
    });
    const sched = await createExport(db, a, {
      kind: 'products',
      format: 'csv',
      from: '2026-09-01',
      to: '2026-09-30',
      requestedBy: 'schedule',
      scheduleId: s.id,
    });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, sched.id));
    const n = await listNotifications(db, a);
    expect(n.rows.map((x) => x.kind)).toEqual(['export_ready']);
    expect(n.rows[0]!.body).toMatch(/7 days/);
  });

  it('a second worker on the same export does nothing', async () => {
    await seed(a);
    const exp = await exportFor(a);
    const deps = { db, boss, log: silent, mail: fakeMail().sender };
    const [x, y] = await Promise.all([
      processExport(deps, payload(a, exp.id)),
      processExport(deps, payload(a, exp.id)),
    ]);
    expect([x, y].sort()).toEqual(['done', 'skipped']);
    expect((await getExport(db, a, exp.id))!.attempts).toBe(1);
    expect(await processExport(deps, payload(a, exp.id))).toBe('skipped'); // already ready
  });

  it('a failure is stored on the export, announced, and a retry can then succeed', async () => {
    await seed(a);
    const exp = await exportFor(a);
    failNext.on = true;
    const deps = { db, boss, log: silent, mail: fakeMail().sender };
    expect(await processExport(deps, payload(a, exp.id))).toBe('failed');
    const failed = (await getExport(db, a, exp.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Something broke/);
    expect((await fileOf(exp.id)).content).toBeNull();
    const n = (await listNotifications(db, a)).rows;
    expect(n[0]).toMatchObject({ kind: 'export_failed', severity: 'critical' });
    expect(n[0]!.body).toMatch(/retry/i);

    await admin.query("update o_report_export set status = 'queued', error = null where id = $1", [
      exp.id,
    ]);
    expect(await processExport(deps, payload(a, exp.id))).toBe('done');
    expect((await getExport(db, a, exp.id))!.attempts).toBe(2);
  });

  it('only builds an export for its own shop', async () => {
    await seed(a);
    const exp = await exportFor(a);
    const deps = { db, boss, log: silent, mail: fakeMail().sender };
    expect(await processExport(deps, payload(b, exp.id))).toBe('skipped');
    expect((await getExport(db, a, exp.id))!.status).toBe('queued');
  });

  it('queues the email once the file is ready', async () => {
    await seed(a);
    const exp = await exportFor(a);
    await createDeliveries(db, a, exp.id, null, ['o@x.com']);
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    expect(send).toHaveBeenCalledWith('report.deliver', payload(a, exp.id));
  });
});

describe('sending by email', () => {
  async function readyExport(recipients: string[]) {
    await seed(a);
    const exp = await exportFor(a, { kind: 'profit_loss', format: 'pdf' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    await createDeliveries(db, a, exp.id, null, recipients);
    send.mockClear();
    return exp;
  }

  it('sends the file to each recipient once, with a clear name and the right type', async () => {
    const exp = await readyExport(['one@x.com', 'two@x.com']);
    const mail = fakeMail();
    const r = await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(a, exp.id));
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['one@x.com', 'two@x.com']);
    expect(mail.sent[0]!.subject).toBe('Profit and loss: 2026-01-01 to 2026-10-09');
    expect(mail.sent[0]!.attachments[0]).toMatchObject({
      filename: 'Profit-and-loss-2026-01-01-to-2026-10-09.pdf',
      contentType: 'application/pdf',
    });
    expect(mail.sent[0]!.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
    const rows = await listDeliveries(db, a);
    expect(rows.every((d) => d.status === 'sent' && d.sentAt !== null)).toBe(true);
  });

  it('running delivery again, or after a retry of the job, never sends twice', async () => {
    const exp = await readyExport(['one@x.com']);
    const mail = fakeMail();
    await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(a, exp.id));
    await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(a, exp.id));
    expect(mail.sent).toHaveLength(1);
    // the same recipient cannot even be added twice for one export
    await createDeliveries(db, a, exp.id, null, ['one@x.com']);
    await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(a, exp.id));
    expect(mail.sent).toHaveLength(1);
  });

  it('one bad address is kept as a failed delivery with a message, and the others still go out', async () => {
    const exp = await readyExport(['bad@x.com', 'good@x.com']);
    const sent: string[] = [];
    const sender: MailSender = {
      send: async (m) => {
        if (m.to === 'bad@x.com') throw new Error('550 mailbox unavailable');
        sent.push(m.to);
      },
    };
    const r = await deliverExport({ db, boss, log: silent, mail: sender }, payload(a, exp.id));
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(sent).toEqual(['good@x.com']);
    const rows = await listDeliveries(db, a);
    const bad = rows.find((d) => d.recipient === 'bad@x.com')!;
    expect(bad).toMatchObject({ status: 'failed', attempts: 1 });
    expect(bad.error).toMatch(/550/);
    const n = (await listNotifications(db, a)).rows.find((x) => x.kind === 'delivery_failed')!;
    expect(n.body).toMatch(/bad@x.com/);
    expect(n.severity).toBe('warning');
  });

  it('with no mail server every delivery fails visibly and can be retried later', async () => {
    const exp = await readyExport(['one@x.com']);
    const none: MailSender = {
      send: async () => {
        throw new MailNotConfigured();
      },
    };
    await deliverExport({ db, boss, log: silent, mail: none }, payload(a, exp.id));
    const failed = (await listDeliveries(db, a))[0]!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Email sending is not set up on this server');
    // put it back in the queue (what the retry endpoint does) and send for real
    await admin.query(
      "update o_report_delivery set status = 'queued', error = null where id = $1",
      [failed.id],
    );
    const mail = fakeMail();
    await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(a, exp.id));
    expect(mail.sent).toHaveLength(1);
    expect((await listDeliveries(db, a))[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('a second failure after a retry is announced again, not hidden by the first', async () => {
    const exp = await readyExport(['one@x.com']);
    const none: MailSender = {
      send: async () => {
        throw new Error('down');
      },
    };
    await deliverExport({ db, boss, log: silent, mail: none }, payload(a, exp.id));
    const id = (await listDeliveries(db, a))[0]!.id;
    await admin.query("update o_report_delivery set status = 'queued' where id = $1", [id]);
    await deliverExport({ db, boss, log: silent, mail: none }, payload(a, exp.id));
    expect(
      (await listNotifications(db, a)).rows.filter((x) => x.kind === 'delivery_failed'),
    ).toHaveLength(2);
  });

  it('an expired file is reported as unavailable instead of sending nothing silently', async () => {
    const exp = await readyExport(['one@x.com']);
    await admin.query(
      "update o_report_export set expires_at = now() - interval '1 hour' where id = $1",
      [exp.id],
    );
    const mail = fakeMail();
    const r = await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(a, exp.id));
    expect(r).toEqual({ sent: 0, failed: 1 });
    expect((await listDeliveries(db, a))[0]!.error).toMatch(/no longer available/);
    expect(mail.sent).toEqual([]);
  });

  it('sends nothing for another shop', async () => {
    const exp = await readyExport(['one@x.com']);
    const mail = fakeMail();
    const r = await deliverExport({ db, boss, log: silent, mail: mail.sender }, payload(b, exp.id));
    expect(r).toEqual({ sent: 0, failed: 0 });
    expect(mail.sent).toEqual([]);
  });
});

describe('scheduled reports', () => {
  const weeklyMonday8 = (who: InstallResult, over: Record<string, unknown> = {}) =>
    createSchedule(db, who, {
      kind: 'profit_loss',
      format: 'pdf',
      frequency: 'weekly',
      weekday: 1,
      hour: 8,
      recipients: ['o@x.com'],
      createdBy: 't',
      lastPeriodEnd: '2026-10-04', // the Sunday before the 5th: the 5th's firing already happened
      ...over,
    } as never);
  // 2026-10-12 is a Monday
  const MON_9 = new Date('2026-10-12T09:00:00Z');

  it('queues the report for the last full week once its hour has come, with its recipients', async () => {
    const s = await weeklyMonday8(a);
    const r = await runDueSchedules({ db, boss, log: silent, now: () => MON_9 });
    expect(r).toEqual({ queued: 1, skipped: 0 });
    const exp = (await listExports(db, a))[0]!;
    expect(exp).toMatchObject({
      kind: 'profit_loss',
      format: 'pdf',
      periodFrom: '2026-10-05',
      periodTo: '2026-10-11',
      scheduleId: s.id,
    });
    expect((await listDeliveries(db, a)).map((d) => d.recipient)).toEqual(['o@x.com']);
    expect(send).toHaveBeenCalledWith('report.export', payload(a, exp.id), {
      singletonKey: exp.id,
    });
  });

  it('is not due before its hour, nor when the period was already sent', async () => {
    await weeklyMonday8(a);
    expect(
      await runDueSchedules({ db, boss, log: silent, now: () => new Date('2026-10-12T07:00:00Z') }),
    ).toEqual({ queued: 0, skipped: 1 });
    await runDueSchedules({ db, boss, log: silent, now: () => MON_9 });
    send.mockClear();
    expect(
      await runDueSchedules({ db, boss, log: silent, now: () => new Date('2026-10-12T09:10:00Z') }),
    ).toEqual({ queued: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await listExports(db, a)).toHaveLength(1);
  });

  it('two schedulers running at once still send the period only once', async () => {
    await weeklyMonday8(a);
    const deps = { db, boss, log: silent, now: () => MON_9 };
    const [x, y] = await Promise.all([runDueSchedules(deps), runDueSchedules(deps)]);
    expect(x.queued + y.queued).toBe(1);
    expect(await listExports(db, a)).toHaveLength(1);
  });

  it('catches up after downtime, once, and moves on to the next week on time', async () => {
    await weeklyMonday8(a);
    // the worker was down all Monday and wakes on Wednesday
    await runDueSchedules({ db, boss, log: silent, now: () => new Date('2026-10-14T12:00:00Z') });
    expect((await listExports(db, a))[0]).toMatchObject({
      periodFrom: '2026-10-05',
      periodTo: '2026-10-11',
    });
    await runDueSchedules({ db, boss, log: silent, now: () => new Date('2026-10-19T09:00:00Z') });
    const periods = (await listExports(db, a)).map((e) => e.periodTo).sort();
    expect(periods).toEqual(['2026-10-11', '2026-10-18']);
  });

  it('skips paused schedules and removed schedules', async () => {
    const s = await weeklyMonday8(a);
    await admin.query('update s_report_schedule set enabled = false where id = $1', [s.id]);
    expect((await runDueSchedules({ db, boss, log: silent, now: () => MON_9 })).queued).toBe(0);
    await admin.query(
      'update s_report_schedule set enabled = true, deleted_at = now() where id = $1',
      [s.id],
    );
    expect((await runDueSchedules({ db, boss, log: silent, now: () => MON_9 })).queued).toBe(0);
  });

  it('skips shops that have uninstalled', async () => {
    await weeklyMonday8(a);
    await admin.query("update m_shop set status = 'uninstalled' where id = $1", [a.shopId]);
    expect((await runDueSchedules({ db, boss, log: silent, now: () => MON_9 })).queued).toBe(0);
  });

  it('uses each shop time zone for the day and hour', async () => {
    const dubai = await mk('rw-dubai.myshopify.com', 'Asia/Dubai');
    await weeklyMonday8(dubai, { hour: 0, lastPeriodEnd: '2026-10-04' });
    // Sunday 21:00 UTC is already Monday 01:00 in Dubai: due there
    expect(
      (
        await runDueSchedules({
          db,
          boss,
          log: silent,
          now: () => new Date('2026-10-11T21:00:00Z'),
        })
      ).queued,
    ).toBe(1);
    await weeklyMonday8(a, { hour: 0 });
    // the same instant is still Sunday in UTC: not due for the UTC shop
    expect(await listExports(db, a)).toHaveLength(0);
  });

  it('monthly schedules report the previous calendar month', async () => {
    await createSchedule(db, a, {
      kind: 'products',
      format: 'csv',
      frequency: 'monthly',
      weekday: null,
      hour: 8,
      recipients: ['o@x.com'],
      createdBy: 't',
      lastPeriodEnd: '2026-08-31',
    });
    await runDueSchedules({ db, boss, log: silent, now: () => new Date('2026-10-01T09:00:00Z') });
    expect((await listExports(db, a))[0]).toMatchObject({
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
    });
  });

  it('one shop failing does not stop the others', async () => {
    await weeklyMonday8(a);
    await weeklyMonday8(b);
    send.mockRejectedValueOnce(new Error('queue down'));
    const r = await runDueSchedules({ db, boss, log: silent, now: () => MON_9 });
    expect(r.queued).toBe(1);
  });
});

describe('retention', () => {
  it('deletes expired export files, and their deliveries, and keeps the rest', async () => {
    await seed(a);
    const old = await exportFor(a);
    const fresh = await exportFor(a);
    const deps = { db, boss, log: silent, mail: fakeMail().sender };
    await processExport(deps, payload(a, old.id));
    await processExport(deps, payload(a, fresh.id));
    await createDeliveries(db, a, old.id, null, ['o@x.com']);
    await admin.query(
      "update o_report_export set expires_at = now() - interval '1 day' where id = $1",
      [old.id],
    );
    expect(await deleteExpiredExports(db)).toBe(1);
    expect((await listExports(db, a)).map((e) => e.id)).toEqual([fresh.id]);
    expect(await listDeliveries(db, a)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The file a merchant downloads or receives by email carries the same figures as the screen
// ---------------------------------------------------------------------------------------------

describe('exports and scheduled reports carry the same figures as the screen', () => {
  const ctx = { shopName: 'rw-a', currency: 'USD', timezone: 'UTC' };
  /** RFC 4180: quoted cells may contain commas, quotes and line breaks. */
  const csvCells = (content: Buffer): string[][] => {
    const text = content.toString('utf8').replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
      } else cell += ch;
    }
    if (cell !== '' || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  };

  it('the profit and loss CSV equals the report table cell for cell', async () => {
    await seed(a);
    const spec = { kind: 'profit_loss' as const, from: '2026-01-01', to: '2026-10-09' };
    const table = await buildReport(db, a, spec, ctx);
    const exp = await exportFor(a, { kind: 'profit_loss' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    const cells = csvCells((await fileOf(exp.id)).content);
    expect(cells[0]).toEqual(table.columns.map((c) => c.label));
    expect(cells.slice(1)).toEqual([...table.rows, ...table.totalRows]);
  });

  it('the CSV totals equal the shared figures, and unknown figures are words, not zero', async () => {
    await seed(a);
    const range = { from: '2026-01-01', to: '2026-10-09' };
    const agg = await getProfitAggregate(db, a, range);
    const summary = summarizePeriod({
      totals: agg.totals,
      coverage: agg.coverage,
      anyMissing: agg.anyMissing,
      orderCount: agg.orderCount,
      ads: { configured: false, hasData: false, spend: '0.0000' },
      operatingExpenses: null,
    });
    const exp = await exportFor(a, { kind: 'profit_loss' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    const rows = csvCells((await fileOf(exp.id)).content);
    const total = (label: string) => rows.find((r) => r[0] === label)!.at(-2)!;
    const status = (label: string) => rows.find((r) => r[0] === label)!.at(-1)!;
    expect(total('Revenue')).toBe(summary.revenue);
    expect(total('Contribution before advertising')).toBe(summary.contributionBeforeAds);
    expect(total('Contribution profit')).toBe(summary.contributionProfit);
    expect(total('Advertising')).toBe('Not configured');
    expect(total('Operating expenses')).toBe('Not set up');
    expect(total('Estimated net profit')).toBe('Not available');
    expect(status('Contribution profit')).toMatch(/excludes advertising/);
    // shipping cost has no rule in this fixture, so it is not a confirmed zero
    expect(summary.statuses.shippingCost).toBe('missing');
    expect(status('Shipping cost')).not.toBe('Confirmed');
  });

  it('the product and order CSV totals equal the shared contribution figure', async () => {
    await seed(a);
    const range = { from: '2026-01-01', to: '2026-10-09' };
    const agg = await getProfitAggregate(db, a, range);
    const overview = summarizePeriod({
      totals: agg.totals,
      coverage: agg.coverage,
      anyMissing: agg.anyMissing,
      orderCount: agg.orderCount,
      ads: { configured: false, hasData: false, spend: '0.0000' },
      operatingExpenses: null,
    }).contributionProfit;
    for (const kind of ['products', 'orders'] as const) {
      const exp = await exportFor(a, { kind });
      await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
      const rows = csvCells((await fileOf(exp.id)).content);
      const last = rows.at(-1)!;
      // products: the last row is the contribution line; orders: the profit column of the total row
      const figure = kind === 'products' ? last[8]! : last[7]!;
      expect(Number(figure).toFixed(2)).toBe(Number(overview).toFixed(2));
    }
  });

  it('an order with a missing cost says Missing in the order CSV, not 0.00', async () => {
    await seed(a);
    const exp = await exportFor(a, { kind: 'orders' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    const rows = csvCells((await fileOf(exp.id)).content);
    const body = rows.slice(1, -1);
    expect(body.some((r) => r[6] === 'Missing')).toBe(true); // no shipping rule in this fixture
    expect(body.some((r) => /^Incomplete/.test(r[9]!))).toBe(true);
  });

  it('a scheduled monthly report has the same figures as building that month on the screen', async () => {
    await seed(a);
    await createSchedule(db, a, {
      kind: 'profit_loss',
      format: 'csv',
      frequency: 'monthly',
      weekday: null,
      hour: 8,
      recipients: ['o@x.com'],
      createdBy: 't',
      lastPeriodEnd: '2026-08-31',
    });
    await runDueSchedules({ db, boss, log: silent, now: () => new Date('2026-10-01T09:00:00Z') });
    const exp = (await listExports(db, a))[0]!;
    expect(exp).toMatchObject({ periodFrom: '2026-09-01', periodTo: '2026-09-30' });
    await processExport({ db, boss, log: silent, mail: fakeMail().sender }, payload(a, exp.id));
    const table = await buildReport(
      db,
      a,
      { kind: 'profit_loss', from: '2026-09-01', to: '2026-09-30' },
      ctx,
    );
    const cells = csvCells((await fileOf(exp.id)).content);
    expect(cells[0]).toEqual(table.columns.map((c) => c.label));
    expect(cells.slice(1)).toEqual([...table.rows, ...table.totalRows]);
  });
});
