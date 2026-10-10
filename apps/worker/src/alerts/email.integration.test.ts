import {
  createDb,
  createNotification,
  createPool,
  installShop,
  setAlertEmailRecipients,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import type { Mail, MailSender } from '../reports/mail.js';
import { composeAlertEmail, emailAlerts } from './email.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pool = createPool(APP_URL, 4);
const db = createDb(pool);
const silent = { info() {}, warn() {} };
const NOW = new Date('2026-10-09T12:00:00Z');

let a: InstallResult;
let b: InstallResult;
const mk = (d: string) =>
  installShop(db, {
    shopDomain: d,
    name: `Shop ${d.split('.')[0]}`,
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });

function fakeMail(failFor: string[] = []) {
  const sent: Mail[] = [];
  const mail: MailSender = {
    send: async (m) => {
      if (failFor.includes(m.to)) throw new Error('mailbox unavailable');
      sent.push(m);
    },
  };
  return { sent, mail };
}
const run = (mail: MailSender, now = NOW) =>
  emailAlerts({ db, log: silent, mail, now: () => now, apiKey: 'key123' });

const note = (who: InstallResult, over: Record<string, unknown> = {}) =>
  createNotification(db, who, {
    kind: 'leakage_loss_orders',
    severity: 'critical',
    title: '3 orders lost money',
    body: 'These 3 orders lost $450.00 in total.',
    link: '/orders',
    dedupeKey: `k:${Math.random()}`,
    ...over,
  } as never);
const unemailed = async (who: InstallResult) =>
  (
    await admin.query(
      'select count(*)::int n from o_notification where shop_id = $1 and emailed_at is null',
      [who.shopId],
    )
  ).rows[0].n as number;

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await mk('em-a.myshopify.com');
  b = await mk('em-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

describe('emailing alerts', () => {
  it('does nothing for a shop with no addresses, and leaves its alerts for the app only', async () => {
    await note(a);
    const m = fakeMail();
    expect(await run(m.mail)).toEqual({ shops: 0, emails: 0, alerts: 0 });
    expect(m.sent).toEqual([]);
    expect(await unemailed(a)).toBe(1);
  });

  it('sends one email per address listing everything new, then marks the alerts as sent', async () => {
    await setAlertEmailRecipients(db, a, ['owner@example.com', 'ops@example.com'], 't');
    await note(a, { kind: 'leakage_loss_orders', title: '3 orders lost money' });
    await note(a, {
      kind: 'leakage_refund_rate',
      severity: 'warning',
      title: 'Refunds are 14% of sales',
      body: 'Customers were refunded $900.',
      link: '/profit',
    });
    await note(a, {
      kind: 'data_stale',
      severity: 'warning',
      title: 'Your data may be out of date',
      body: 'Re-sync.',
      link: '/settings',
    });
    const m = fakeMail();
    const r = await run(m.mail);
    expect(r).toEqual({ shops: 1, emails: 2, alerts: 3 });
    expect(m.sent.map((x) => x.to).sort()).toEqual(['ops@example.com', 'owner@example.com']);
    const text = m.sent[0]!.text;
    expect(m.sent[0]!.subject).toBe('3 profit alerts for Shop em-a (1 serious)');
    expect(text).toContain('[Serious] 3 orders lost money');
    expect(text).toContain('Refunds are 14% of sales');
    expect(text).toContain('Open: https://em-a.myshopify.com/admin/apps/key123/orders');
    expect(text).toContain('Open: https://em-a.myshopify.com/admin/apps/key123/profit');
    expect(await unemailed(a)).toBe(0);
  });

  it('never sends the same alert twice, even when run again', async () => {
    await setAlertEmailRecipients(db, a, ['owner@example.com'], 't');
    await note(a);
    const m = fakeMail();
    await run(m.mail);
    await run(m.mail);
    await run(m.mail);
    expect(m.sent).toHaveLength(1);
  });

  it('a new alert after the first email goes in the next one', async () => {
    await setAlertEmailRecipients(db, a, ['owner@example.com'], 't');
    await note(a);
    const m = fakeMail();
    await run(m.mail);
    await note(a, { kind: 'leakage_low_margin', severity: 'warning', title: 'Margin is 12%' });
    await run(m.mail);
    expect(m.sent).toHaveLength(2);
    expect(m.sent[1]!.subject).toBe('Profit alert for Shop em-a: Margin is 12%');
  });

  it('only warnings and serious findings of the profit check and stale data are emailed', async () => {
    await setAlertEmailRecipients(db, a, ['owner@example.com'], 't');
    await note(a, { kind: 'leakage_possible_loss', severity: 'info', title: 'Info only' });
    await note(a, { kind: 'export_ready', severity: 'success', title: 'Report ready' });
    await note(a, { kind: 'export_failed', severity: 'critical', title: 'Report failed' });
    await note(a, { kind: 'delivery_failed', severity: 'warning', title: 'Delivery failed' });
    const m = fakeMail();
    expect(await run(m.mail)).toEqual({ shops: 0, emails: 0, alerts: 0 });
    expect(m.sent).toEqual([]);
  });

  it('does not email alerts older than 48 hours', async () => {
    await setAlertEmailRecipients(db, a, ['owner@example.com'], 't');
    await note(a);
    await admin.query(`update o_notification set created_at = $1 where shop_id = $2`, [
      new Date(NOW.getTime() - 49 * 3_600_000).toISOString(),
      a.shopId,
    ]);
    const m = fakeMail();
    expect(await run(m.mail)).toEqual({ shops: 0, emails: 0, alerts: 0 });
  });

  it('if one address cannot be reached the alert stays unsent and is tried again, without resending to the others', async () => {
    await setAlertEmailRecipients(db, a, ['good@example.com', 'bad@example.com'], 't');
    await note(a);
    const m = fakeMail(['bad@example.com']);
    const first = await run(m.mail);
    expect(first.shops).toBe(0);
    expect(await unemailed(a)).toBe(1);
    expect(m.sent.map((x) => x.to)).toEqual(['good@example.com']);
  });

  it('with no mail server the alerts wait, and nothing is lost', async () => {
    await setAlertEmailRecipients(db, a, ['owner@example.com'], 't');
    await note(a);
    const down: MailSender = {
      send: async () => {
        throw new Error('Email sending is not set up on this server');
      },
    };
    expect((await run(down)).shops).toBe(0);
    expect(await unemailed(a)).toBe(1);
    const m = fakeMail();
    expect((await run(m.mail)).alerts).toBe(1);
  });

  it('keeps shops apart: each gets only its own alerts', async () => {
    await setAlertEmailRecipients(db, a, ['a@example.com'], 't');
    await setAlertEmailRecipients(db, b, ['b@example.com'], 't');
    await note(a, { title: 'Only for A' });
    await note(b, { title: 'Only for B' });
    const m = fakeMail();
    await run(m.mail);
    const toA = m.sent.find((x) => x.to === 'a@example.com')!;
    const toB = m.sent.find((x) => x.to === 'b@example.com')!;
    expect(toA.text).toContain('Only for A');
    expect(toA.text).not.toContain('Only for B');
    expect(toB.text).toContain('Only for B');
    expect(toB.text).not.toContain('Only for A');
  });
});

describe('the email text', () => {
  it('has a short subject for one alert and a count for several', () => {
    const one = composeAlertEmail(
      'Acme',
      [
        {
          id: '1',
          kind: 'k',
          severity: 'warning',
          title: 'Margin is 12%',
          body: 'b',
          link: null,
          createdAt: '',
        },
      ],
      (p) => `https://x${p ?? ''}`,
    );
    expect(one.subject).toBe('Profit alert for Acme: Margin is 12%');
    expect(one.text).toContain('Open: https://x');
  });
});
