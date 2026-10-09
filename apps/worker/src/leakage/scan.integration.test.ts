import { readFileSync } from 'node:fs';
import {
  createDb,
  createPool,
  installShop,
  listNotifications,
  loadOrdersForProfit,
  replaceProfitEntries,
  setLeakageSettings,
  upsertOrders,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { calculateOrder } from '@pi/profit-engine';
import type { EngineConfig, EngineOrder } from '@pi/profit-engine';
import { mapOrder } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { scanLeakage, weekKey } from './scan.js';

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

// Seeded activity is placed on 2026-10-05, inside the 30 days before a scan on the 12th.
const MON = new Date('2026-10-12T05:00:00Z');
const NEXT_MON = new Date('2026-10-19T05:00:00Z');

let a: InstallResult;
let b: InstallResult;

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

/** The fixture orders again under new ids so the period has enough orders to be judged. */
function clones(copies: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let k = 0; k < copies; k++) {
    const text = JSON.stringify(orderNodes).replace(
      /gid:\/\/shopify\/(\w+)\/(\d+)/g,
      (m, type: string, id: string) =>
        ['Product', 'ProductVariant', 'InventoryItem', 'Location'].includes(type) || k === 0
          ? m
          : `gid://shopify/${type}/${BigInt(id) + BigInt(k) * 1_000_000_000_000n}`,
    );
    out.push(...(JSON.parse(text) as Record<string, unknown>[]));
  }
  return out;
}

/** Seeds the fixture orders (copies times) and puts all of their activity on one date. */
async function seed(who: InstallResult, copies: number, on = '2026-10-05') {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, clones(copies).map(mapOrder)));
  const loaded = await withTenant(db, who.tenantId, (tx) =>
    loadOrdersForProfit(tx, who, { limit: 1000 }),
  );
  const cfg: EngineConfig = {
    timezone: 'UTC',
    merchantCosts: new Map(),
    shopifyCosts: new Map(),
    feeRules: [],
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
  await admin.query('update f_profit_entry set entry_date = $2::date where shop_id = $1', [
    who.shopId,
    on,
  ]);
  await admin.query('update f_order_profit set order_date = $2::date where shop_id = $1', [
    who.shopId,
    on,
  ]);
}

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await mk('lw-a.myshopify.com');
  b = await mk('lw-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

const kinds = async (who: InstallResult) =>
  (await listNotifications(db, who)).rows.map((n) => n.kind).sort();

describe('weekKey', () => {
  it('is the Monday that starts the week', () => {
    expect(weekKey('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekKey('2026-10-14')).toBe('2026-10-12');
    expect(weekKey('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekKey('2026-10-19')).toBe('2026-10-19');
    expect(weekKey('2027-01-01')).toBe('2026-12-28'); // across the year end
  });
});

describe('daily leakage scan', () => {
  it('tells the merchant about warnings and critical findings, and nothing about information', async () => {
    await seed(a, 3);
    const r = await scanLeakage({ db, log: silent, now: () => MON });
    expect(r.shops).toBe(2);
    expect(r.notified).toBeGreaterThan(0);
    const list = (await listNotifications(db, a)).rows;
    expect(list.length).toBe(r.notified);
    for (const n of list) {
      expect(['warning', 'critical']).toContain(n.severity);
      expect(n.kind).toMatch(/^leakage_/);
      expect(n.body.length).toBeGreaterThan(10);
      expect(n.link).toBe('/profit');
    }
    expect(list.map((n) => n.kind)).toContain('leakage_missing_costs');
  });

  it('does not repeat the same problem every day, but does in a new week', async () => {
    await seed(a, 3);
    const first = await scanLeakage({ db, log: silent, now: () => MON });
    const again = await scanLeakage({
      db,
      log: silent,
      now: () => new Date('2026-10-13T05:00:00Z'),
    });
    expect(first.notified).toBeGreaterThan(0);
    expect(again.notified).toBe(0);
    const count = (await listNotifications(db, a)).rows.length;
    const later = await scanLeakage({ db, log: silent, now: () => NEXT_MON });
    expect(later.notified).toBeGreaterThan(0);
    expect((await listNotifications(db, a)).rows.length).toBe(count + later.notified);
  });

  it('a shop without sales gets nothing', async () => {
    await seed(a, 3);
    await scanLeakage({ db, log: silent, now: () => MON });
    expect(await kinds(b)).toEqual([]);
  });

  it('follows the merchant limits: a lenient limit stays quiet', async () => {
    await seed(a, 3);
    await setLeakageSettings(
      db,
      a,
      { marginPct: '0', refundRatePct: '100', costChangePct: '1000' },
      't',
    );
    await admin.query(
      'update s_app_setting set missing_cogs_warning_pct = 100 where shop_id = $1',
      [a.shopId],
    );
    await scanLeakage({ db, log: silent, now: () => MON });
    const k = await kinds(a);
    expect(k).not.toContain('leakage_refund_rate');
    expect(k).not.toContain('leakage_low_margin');
    expect(k).not.toContain('leakage_missing_costs');
  });

  it('only looks at the last 30 days', async () => {
    await seed(a, 3, '2026-08-01'); // all activity more than 30 days before the scan
    const r = await scanLeakage({ db, log: silent, now: () => MON });
    expect(r.notified).toBe(0);
    expect(await kinds(a)).toEqual([]);
  });

  it('skips uninstalled shops', async () => {
    await seed(a, 3);
    await admin.query("update m_shop set status = 'uninstalled' where id = $1", [a.shopId]);
    const r = await scanLeakage({ db, log: silent, now: () => MON });
    expect(r.shops).toBe(1);
    expect(await kinds(a)).toEqual([]);
  });

  it('one shop failing does not stop the others', async () => {
    await seed(a, 3);
    await seed(b, 3);
    // break shop b: its settings row violates nothing, so make its queries fail via a bad timezone
    await admin.query("update m_shop set iana_timezone = 'Not/AZone' where id = $1", [b.shopId]);
    const r = await scanLeakage({ db, log: silent, now: () => MON });
    expect(r.shops).toBe(1);
    expect((await listNotifications(db, a)).rows.length).toBeGreaterThan(0);
    expect(await kinds(b)).toEqual([]);
  });
});
