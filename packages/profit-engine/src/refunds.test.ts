import { describe, expect, it } from 'vitest';
import { emptyConfig, line, order } from '../test/helpers.js';
import { calculateOrder } from './order.js';
import { summarizeFromTotals, totalsFromEntries } from './summary.js';
import type { ComponentTotals } from './summary.js';
import type { EngineOrder, LedgerEntry } from './types.js';

/**
 * Refund scenarios. The order: 2 units at 100.00, an order discount of 20.00 (so 180.00 after
 * discount), 10.00 shipping charged, paid 190.00 on 2026-06-15. Shopify reports a refunded line at
 * its discounted value (90.00 a unit), so the discount is never taken off twice.
 */
const base = (over: Partial<EngineOrder> = {}): EngineOrder =>
  order({
    lines: [line({ shopifyId: 1, variantShopifyId: 100, quantity: 2, unitPriceAmount: '100.00' })],
    subtotalAmount: '180.00',
    discountsAmount: '20.00',
    shippingAmount: '10.00',
    totalAmount: '190.00',
    ...over,
  });

const refund = (id: number, at: string, total: string, units: number) => ({
  shopifyId: id,
  processedAt: new Date(at),
  totalAmount: total,
  lines:
    units > 0
      ? [
          {
            shopifyId: id * 10,
            lineItemShopifyId: 1,
            quantity: units,
            subtotalAmount: (units * 90).toFixed(2),
            taxAmount: '0.00',
            restockType: 'NO_RESTOCK' as string | null,
          },
        ]
      : [],
});

const calc = (o: EngineOrder) => calculateOrder(o, emptyConfig());
const figures = (entries: LedgerEntry[]) => {
  const totals: ComponentTotals = totalsFromEntries(
    entries.map((e) => ({
      orderKey: 1,
      component: e.component,
      amount: e.amount,
      status: e.status,
      basisAmount: e.basisAmount,
      memo: e.memo,
    })),
  );
  return summarizeFromTotals(totals, {
    orderCount: 1,
    coverage: { cost: null, fees: null, shipping: null },
    anyMissing: false,
  });
};

describe('refunds', () => {
  it('no refund: gross 200, discount 20, net sales 180, revenue 190', () => {
    const s = figures(calc(base()).entries);
    expect([s.grossSales, s.discounts, s.productRefunds, s.netSales, s.revenue]).toEqual([
      '200.0000',
      '20.0000',
      '0.0000',
      '180.0000',
      '190.0000',
    ]);
  });

  it('a partial refund of one unit takes off 90.00, and the discount is not taken off again', () => {
    const o = base({
      financialStatus: 'PARTIALLY_REFUNDED',
      refunds: [refund(5, '2026-06-20T10:00:00Z', '90.00', 1)],
    });
    const s = figures(calc(o).entries);
    expect(s.productRefunds).toBe('90.0000');
    expect(s.discounts).toBe('20.0000'); // unchanged
    expect(s.netSales).toBe('90.0000'); // one unit sold at 90.00 after its share of the discount
    expect(s.revenue).toBe('100.0000');
  });

  it('two partial refunds add up and never exceed what was sold (no double counting)', () => {
    const o = base({
      financialStatus: 'REFUNDED',
      refunds: [
        refund(5, '2026-06-20T10:00:00Z', '90.00', 1),
        refund(6, '2026-06-22T10:00:00Z', '90.00', 1),
      ],
    });
    const r = calc(o);
    expect(r.entries.filter((e) => e.component === 'product_refund')).toHaveLength(2);
    const s = figures(r.entries);
    expect(s.productRefunds).toBe('180.0000');
    expect(s.netSales).toBe('0.0000'); // 200 - 20 - 180
    expect(s.revenue).toBe('10.0000'); // only the shipping charged is left
  });

  it('a shipping-only refund reduces shipping revenue and leaves products alone', () => {
    const o = base({
      financialStatus: 'PARTIALLY_REFUNDED',
      refunds: [refund(5, '2026-06-20T10:00:00Z', '10.00', 0)],
    });
    const s = figures(calc(o).entries);
    expect(s.productRefunds).toBe('0.0000');
    expect(s.shippingRevenue).toBe('0.0000'); // 10 charged - 10 refunded
    expect(s.revenue).toBe('180.0000');
  });

  it('a full refund including shipping brings revenue to zero', () => {
    const o = base({
      financialStatus: 'REFUNDED',
      refunds: [refund(5, '2026-06-20T10:00:00Z', '190.00', 2)],
    });
    const s = figures(calc(o).entries);
    expect(s.netSales).toBe('0.0000');
    expect(s.shippingRevenue).toBe('0.0000');
    expect(s.revenue).toBe('0.0000');
  });

  it('a refund in a later month is dated by the refund, not by the order (cash view)', () => {
    const o = base({
      financialStatus: 'PARTIALLY_REFUNDED',
      refunds: [refund(5, '2026-07-02T10:00:00Z', '90.00', 1)],
    });
    const { entries } = calc(o);
    const dated = (date: string) =>
      entries.filter((e) => e.entryDate === date).map((e) => e.component);
    expect(dated('2026-07-02')).toEqual(['product_refund']);
    expect(dated('2026-06-15')).toEqual(
      expect.arrayContaining(['gross_sales', 'discounts', 'shipping_revenue']),
    );
    expect(dated('2026-06-15')).not.toContain('product_refund');
  });

  it('a refund processed after midnight UTC belongs to the shop-local day', () => {
    // 02:30 UTC on 1 July is 22:30 on 30 June in New York (the test shop time zone)
    const o = base({
      financialStatus: 'PARTIALLY_REFUNDED',
      refunds: [refund(5, '2026-07-01T02:30:00Z', '90.00', 1)],
    });
    const hit = calc(o).entries.find((e) => e.component === 'product_refund')!;
    expect(hit.entryDate).toBe('2026-06-30');
  });

  it('refunding does not give the payment fee back', () => {
    const o = base({
      financialStatus: 'REFUNDED',
      refunds: [refund(5, '2026-06-20T10:00:00Z', '190.00', 2)],
    });
    const fees = (e: LedgerEntry[]) =>
      e.filter((x) => x.component === 'payment_fees').map((x) => x.amount);
    expect(fees(calc(o).entries)).toEqual(fees(calc(base()).entries));
  });

  it('an unpaid order has no entries at all, so nothing to refund or count', () => {
    const r = calc(base({ financialStatus: 'PENDING' }));
    expect(r.recognized).toBe(false);
    expect(r.entries).toEqual([]);
    const cancelled = calc(
      base({ financialStatus: 'PENDING', cancelledAt: new Date('2026-06-16T00:00:00Z') }),
    );
    expect(cancelled.exclusionReason).toBe('cancelled_unpaid');
    expect(cancelled.entries).toEqual([]);
  });

  it('a cancelled order that was paid and refunded in full counts and nets to zero', () => {
    const o = base({
      financialStatus: 'REFUNDED',
      cancelledAt: new Date('2026-06-16T00:00:00Z'),
      refunds: [refund(5, '2026-06-16T09:00:00Z', '190.00', 2)],
    });
    const r = calc(o);
    expect(r.recognized).toBe(true);
    expect(r.flags).not.toContain('cancelled_without_refund');
    expect(figures(r.entries).revenue).toBe('0.0000');
  });

  it('a cancelled paid order with no money refunded is flagged, not silently dropped', () => {
    const r = calc(base({ cancelledAt: new Date('2026-06-16T00:00:00Z') }));
    expect(r.recognized).toBe(true);
    expect(r.flags).toContain('cancelled_without_refund');
  });
});
