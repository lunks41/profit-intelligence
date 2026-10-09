import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COUNT,
  SCENARIOS,
  assignCosts,
  customerPool,
  generateDailyPlan,
  generateMonthPlan,
  generatePlan,
  monthsBetween,
  productRoles,
} from './plan.js';
import type { CatalogVariant } from './plan.js';

const catalog: CatalogVariant[] = Array.from({ length: 10 }, (_, i) => ({
  id: `gid://shopify/ProductVariant/${i + 1}`,
  productId: `gid://shopify/Product/${Math.floor(i / 2) + 1}`,
  productTitle: `Product ${String.fromCharCode(65 + Math.floor(i / 2))}`,
  title: `Variant ${i}`,
  sku: `SKU-${i}`,
  priceCents: 5000 + i * 1237,
  costCents: null,
}));
const now = new Date('2026-10-09T12:00:00Z');
const costed = assignCosts(catalog, 42);
const plan = () => generatePlan({ seed: 42, orders: 300, days: 180, now, catalog: costed });

describe('generatePlan', () => {
  it('is deterministic for the same seed and different for another', () => {
    expect(plan()).toEqual(plan());
    expect(generatePlan({ seed: 43, orders: 300, days: 180, now, catalog: costed })).not.toEqual(
      plan(),
    );
  });

  it('covers every scenario at least three times', () => {
    const counts = new Map<string, number>();
    for (const o of plan()) for (const s of o.scenarios) counts.set(s, (counts.get(s) ?? 0) + 1);
    for (const s of SCENARIOS) expect(counts.get(s) ?? 0, s).toBeGreaterThanOrEqual(3);
  });

  it('keeps every order within the last 180 days and never in the future', () => {
    for (const o of plan()) {
      const t = new Date(o.processedAt).getTime();
      expect(t).toBeLessThan(now.getTime());
      expect(t).toBeGreaterThan(now.getTime() - 181 * 86_400_000);
    }
  });

  it('never schedules a refund in the future', () => {
    for (const o of plan()) {
      if (!o.refund) continue;
      const refundAt = new Date(o.processedAt).getTime() + o.refund.daysAfter * 86_400_000;
      expect(refundAt).toBeLessThan(now.getTime());
    }
  });

  it('has unique source ids (idempotency keys)', () => {
    const ids = plan().map((o) => o.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces internally consistent totals', () => {
    for (const o of plan()) {
      const subtotal = o.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
      expect(o.expected.subtotalCents).toBe(subtotal);
      expect(o.expected.discountCents).toBeLessThanOrEqual(subtotal);
      expect(o.expected.totalCents).toBeGreaterThanOrEqual(0);
      if (o.scenarios[0] === 'zero_total') expect(o.expected.totalCents).toBe(0);
    }
  });

  it('includes negative-profit orders (cost above discounted price)', () => {
    const negative = plan().filter((o) => o.scenarios[0] === 'negative_profit');
    expect(negative.length).toBeGreaterThanOrEqual(3);
    for (const o of negative) {
      const cost = o.lines.reduce((s, l) => {
        const v = costed.find((c) => c.id === l.variantId)!;
        return s + (v.costCents ?? 0) * l.quantity;
      }, 0);
      expect(o.expected.subtotalCents - o.expected.discountCents).toBeLessThan(cost);
    }
  });

  it('erodes the price of the declining-margin product over time', () => {
    const roles = productRoles(costed);
    const rows = plan()
      .flatMap((o) => o.lines.map((l) => ({ t: o.processedAt, l })))
      .filter((x) => x.l.productId === roles.decliningProductId)
      .sort((a, b) => a.t.localeCompare(b.t));
    const ratio = (x: (typeof rows)[number]) =>
      x.l.unitPriceCents / costed.find((c) => c.id === x.l.variantId)!.priceCents;
    expect(ratio(rows[rows.length - 1]!)).toBeLessThan(ratio(rows[0]!));
  });
});

describe('assignCosts', () => {
  it('leaves a share of variants without cost for the missing-COGS scenario', () => {
    const missing = costed.filter((v) => v.costCents === null).length;
    expect(missing).toBeGreaterThan(0);
    expect(missing).toBeLessThan(costed.length);
  });

  it('is deterministic', () => {
    expect(assignCosts(catalog, 42)).toEqual(costed);
  });
});

describe('customers', () => {
  it('builds 300 distinct, clearly fake customers on example.com', () => {
    const pool = customerPool();
    expect(pool).toHaveLength(CUSTOMER_COUNT);
    expect(new Set(pool.map((c) => c.email)).size).toBe(300);
    for (const c of pool) expect(c.email).toMatch(/^seed\.customer\d+@example\.com$/);
    expect(customerPool()).toEqual(pool);
  });

  it('uses many different customers on orders and keeps some guests', () => {
    const orders = generateMonthPlan('2026-03', history());
    const emails = new Set(orders.map((o) => o.customer?.email).filter(Boolean));
    expect(emails.size).toBeGreaterThan(40);
    expect(orders.some((o) => o.customer === null)).toBe(true);
    expect(orders.some((o) => o.modifiers.includes('guest'))).toBe(true);
  });
});

function history(to = '2026-10-09') {
  return { seed: 42, from: '2025-08-01', to, now, catalog: costed };
}

describe('history plan', () => {
  const months = monthsBetween('2025-08-01', '2026-10-09');
  const all = months.flatMap((m) => generateMonthPlan(m, history()));

  it('covers 15 months and totals well over 2,000 orders', () => {
    expect(months).toHaveLength(15);
    expect(months[0]).toBe('2025-08');
    expect(months.at(-1)).toBe('2026-10');
    expect(all.length).toBeGreaterThan(2000);
    expect(all.length).toBeLessThan(3500);
  });

  it('is deterministic, with unique source ids and a month tag on each order', () => {
    expect(generateMonthPlan('2026-01', history())).toEqual(
      generateMonthPlan('2026-01', history()),
    );
    expect(new Set(all.map((o) => o.sourceId)).size).toBe(all.length);
    for (const o of all) {
      expect(o.sourceId).toMatch(/^pi-seed-42-h\d{8}-\d+$/);
      expect(o.tags).toContain(`pi-m-${o.processedAt.slice(0, 7)}`);
    }
  });

  it('gives a day the same orders whatever the end date of the plan is', () => {
    // resuming later in the year must not change what already exists
    const a = generateMonthPlan('2025-09', history('2026-10-09'));
    const b = generateMonthPlan('2025-09', history('2026-10-20'));
    expect(a.map((o) => o.sourceId)).toEqual(b.map((o) => o.sourceId));
  });

  it('stays within the dates and never in the future', () => {
    for (const o of all) {
      const t = Date.parse(o.processedAt);
      expect(t).toBeGreaterThanOrEqual(Date.parse('2025-08-01T00:00:00Z'));
      expect(t).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('uses every scenario every month, and every modifier across the year', () => {
    for (const m of months.slice(0, -1)) {
      const seen = new Set(generateMonthPlan(m, history()).map((o) => o.scenarios[0]));
      for (const s of SCENARIOS) expect(seen.has(s), `${m} ${s}`).toBe(true);
    }
    const mods = new Set(all.flatMap((o) => o.modifiers));
    for (const m of [
      'tax_inclusive',
      'tax_exclusive',
      'missing_cogs',
      'declining_margin',
      'high_refund_product',
      'guest',
      'no_shipping_charge',
    ])
      expect(mods.has(m), m).toBe(true);
  });

  it('has a gentle upward trend, a seasonal peak and a few busy days', () => {
    const perMonth = new Map<string, number>();
    for (const o of all) {
      const k = o.processedAt.slice(0, 7);
      perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
    }
    expect(perMonth.get('2026-09')!).toBeGreaterThan(perMonth.get('2025-08')!);
    expect(perMonth.get('2025-12')!).toBeGreaterThan(perMonth.get('2025-09')!);
    const perDay = new Map<string, number>();
    for (const o of all) {
      const k = o.processedAt.slice(0, 10);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const counts = [...perDay.values()].sort((x, y) => y - x);
    expect(counts[0]!).toBeGreaterThanOrEqual(2 * counts[Math.floor(counts.length / 2)]!);
  });
});

describe('daily plan', () => {
  const day = (n: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + n * 86_400_000);
  const planFor = (n: number) =>
    generateDailyPlan({
      seed: 42,
      day: day(n).toISOString().slice(0, 10),
      now: new Date(day(n).getTime() + 9 * 3_600_000),
      catalog: costed,
    });

  it('creates 10 to 15 orders, dated now, with date-based idempotency keys', () => {
    for (let n = 0; n < 30; n++) {
      const p = planFor(n);
      expect(p.length).toBeGreaterThanOrEqual(10);
      expect(p.length).toBeLessThanOrEqual(15);
      const d = day(n).toISOString().slice(0, 10).replace(/-/g, '');
      p.forEach((o, k) => {
        expect(o.sourceId).toBe(`pi-seed-42-daily-${d}-${k}`);
        expect(o.tags).toContain(`pi-daily-${d}`);
        expect(Date.parse(o.processedAt)).toBeLessThanOrEqual(day(n).getTime() + 9 * 3_600_000);
        expect(o.processedAt.slice(0, 10)).toBe(day(n).toISOString().slice(0, 10));
      });
    }
  });

  it('is repeatable for a date: same ids and same orders when run twice', () => {
    expect(planFor(3)).toEqual(planFor(3));
    expect(planFor(3).map((o) => o.sourceId)).not.toEqual(planFor(4).map((o) => o.sourceId));
  });

  it('shows every scenario at least once in any 7 consecutive days', () => {
    for (let start = 0; start < 60; start++) {
      const seen = new Set<string>();
      for (let n = start; n < start + 7; n++) for (const o of planFor(n)) seen.add(o.scenarios[0]!);
      for (const s of SCENARIOS) expect(seen.has(s), `week from day ${start}: ${s}`).toBe(true);
    }
  });
});
