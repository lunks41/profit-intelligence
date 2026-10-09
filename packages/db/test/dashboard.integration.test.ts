import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { calculateOrder, summarize, summarizeFromTotals } from '../../profit-engine/src/index.js';
import type { EngineConfig, EngineOrder, SummaryEntry } from '../../profit-engine/src/index.js';
import { mapOrder } from '../../shopify/src/sync-mappers.js';
import { createDb, createPool, withTenant } from '../src/client.js';
import { getDailyTotals, getOrderAttention, getProfitAggregate } from '../src/dashboard.js';
import { installShop } from '../src/installations.js';
import type { InstallResult } from '../src/installations.js';
import { listProfitEntries, loadOrdersForProfit, replaceProfitEntries } from '../src/profit.js';
import { upsertOrders } from '../src/sync.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const orderNodes = JSON.parse(
  readFileSync(new URL('../../shopify/test/fixtures/orders-page.json', import.meta.url), 'utf8'),
).orders.nodes as Record<string, unknown>[];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 6);
const db = createDb(appPool);

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

/** A config with every status represented: some variants Actual, some Estimated, some Missing; fees by rule. */
function mixedConfig(orders: EngineOrder[]): EngineConfig {
  const variants = [
    ...new Set(
      orders.flatMap((o) =>
        o.lines.map((l) => l.variantShopifyId).filter((v): v is number => v !== null),
      ),
    ),
  ].sort((x, y) => x - y);
  const merchantCosts = new Map<number, { effectiveFrom: string; amount: string }[]>();
  const shopifyCosts = new Map<number, string>();
  variants.forEach((v, i) => {
    if (i % 3 === 0) merchantCosts.set(v, [{ effectiveFrom: '2026-01-01', amount: '12.50' }]);
    else if (i % 3 === 1) shopifyCosts.set(v, '8.00');
    // i % 3 === 2: no cost at all -> Missing
  });
  return {
    timezone: 'UTC',
    merchantCosts,
    shopifyCosts,
    feeRules: [
      {
        gateway: null,
        percent: '2.9',
        fixedAmount: '0.30',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ],
    shippingRules: [], // shipping cost stays Missing
  };
}

async function calculateAll(who: InstallResult) {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, orderNodes.map(mapOrder)));
  const loaded = await withTenant(db, who.tenantId, (tx) =>
    loadOrdersForProfit(tx, who, { limit: 1000 }),
  );
  const cfg = mixedConfig(loaded.map((l) => l.order as EngineOrder));
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

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await mk('dash-a.myshopify.com');
  b = await mk('dash-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

const FULL = { from: '2026-01-01', to: '2026-12-31' };
const NARROW = { from: '2026-04-10', to: '2026-04-25' };

async function bothWays(who: InstallResult, range: { from: string; to: string }) {
  const agg = await getProfitAggregate(db, who, range);
  const fromSql = summarizeFromTotals(agg.totals, {
    orderCount: agg.orderCount,
    coverage: agg.coverage,
    anyMissing: agg.anyMissing,
  });
  const rows = await listProfitEntries(db, who, range);
  const entries = rows.map(
    (r) => ({ ...r, component: r.component, status: r.status }) as unknown as SummaryEntry,
  );
  const fromEntries = summarize(entries, { orderCount: agg.orderCount });
  return { agg, fromSql, fromEntries, rowCount: rows.length };
}

describe('SQL aggregates equal the engine summary of the same entries', () => {
  it('for the whole period, with every status represented', async () => {
    await calculateAll(a);
    const { fromSql, fromEntries, rowCount, agg } = await bothWays(a, FULL);
    expect(rowCount).toBeGreaterThan(30);
    expect(fromSql).toEqual(fromEntries);
    // the data really does mix statuses, otherwise the test proves little
    expect(agg.coverage.cost).not.toBeNull();
    expect(Number(agg.coverage.cost!.actual)).toBeGreaterThan(0);
    expect(Number(agg.coverage.cost!.estimated)).toBeGreaterThan(0);
    expect(Number(agg.coverage.cost!.missing)).toBeGreaterThan(0);
    expect(agg.coverage.fees!.estimated).toBeGreaterThan(0);
    expect(agg.coverage.shipping!.missing).toBeGreaterThan(0);
    expect(agg.anyMissing).toBe(true);
  });

  it('for a narrower period (the date filter really filters)', async () => {
    await calculateAll(a);
    const narrow = await bothWays(a, NARROW);
    const full = await bothWays(a, FULL);
    expect(narrow.fromSql).toEqual(narrow.fromEntries);
    expect(narrow.rowCount).toBeGreaterThan(0);
    expect(narrow.rowCount).toBeLessThan(full.rowCount);
    expect(Number(narrow.fromSql.grossSales)).toBeLessThan(Number(full.fromSql.grossSales));
  });

  it('for an empty period', async () => {
    await calculateAll(a);
    const { fromSql, fromEntries } = await bothWays(a, { from: '2030-01-01', to: '2030-01-31' });
    expect(fromSql).toEqual(fromEntries);
    expect(fromSql.revenue).toBe('0.0000');
    expect(fromSql.confidence.band).toBeNull();
  });

  it('daily totals add up to the period total, and each order counts once', async () => {
    await calculateAll(a);
    const daily = await getDailyTotals(db, a, FULL);
    const agg = await getProfitAggregate(db, a, FULL);
    for (const component of ['gross_sales', 'cogs', 'product_refund', 'payment_fees']) {
      const sum = daily.reduce(
        (s, d) => s + Math.round(Number(d.totals[component] ?? 0) * 10_000),
        0,
      );
      expect(sum, component).toBe(Math.round(Number(agg.totals[component] ?? 0) * 10_000));
    }
    expect(daily.reduce((s, d) => s + d.orders, 0)).toBe(agg.orderCount);
    expect(daily.map((d) => d.date)).toEqual([...daily.map((d) => d.date)].sort());
  });
});

describe('order attention', () => {
  it('splits awaiting payment, confirmed loss, possible loss and flags', async () => {
    await calculateAll(a);
    const att = await getOrderAttention(db, a, FULL);
    const awaiting = orderNodes.filter(
      (o) =>
        ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].includes(o.displayFinancialStatus as string) &&
        !o.cancelledAt,
    );
    expect(att.awaitingPayment.count).toBe(awaiting.length);
    const expected = await admin.query(
      `select count(*) filter (where not partial)::int c, count(*) filter (where partial)::int p
         from f_order_profit where shop_id = $1 and recognized and contribution_amount < 0`,
      [a.shopId],
    );
    expect(att.confirmedLoss.count).toBe(expected.rows[0].c);
    expect(att.possibleLoss).toBe(expected.rows[0].p);
    // with shipping cost Missing every order is partial, so nothing can be a confirmed loss here
    expect(att.confirmedLoss.count).toBe(0);
  });

  it('respects the date range', async () => {
    await calculateAll(a);
    const none = await getOrderAttention(db, a, { from: '2030-01-01', to: '2030-12-31' });
    expect(none).toEqual({
      awaitingPayment: { count: 0, amount: '0.0000' },
      confirmedLoss: { count: 0, amount: '0.0000' },
      possibleLoss: 0,
      flagged: 0,
    });
  });
});

describe('tenant isolation', () => {
  it('each shop aggregates only its own ledger', async () => {
    await calculateAll(a);
    const other = await getProfitAggregate(db, b, FULL);
    expect(other.orderCount).toBe(0);
    expect(other.totals).toEqual({});
    expect(await getDailyTotals(db, b, FULL)).toEqual([]);
    // asking for shop A's data inside tenant B's context returns nothing
    expect(
      (await getProfitAggregate(db, { tenantId: b.tenantId, shopId: a.shopId }, FULL)).orderCount,
    ).toBe(0);
    expect(
      (await getOrderAttention(db, { tenantId: b.tenantId, shopId: a.shopId }, FULL))
        .awaitingPayment.count,
    ).toBe(0);
  });
});
