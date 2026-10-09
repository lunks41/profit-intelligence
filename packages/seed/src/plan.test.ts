import { describe, expect, it } from 'vitest';
import { SCENARIOS, assignCosts, generatePlan, productRoles } from './plan.js';
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
