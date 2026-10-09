import { describe, expect, it } from 'vitest';
import { D, dec } from './money.js';
import { allocateOrder, splitByWeights } from './allocate.js';
import type { AllocEntry, AllocInput } from './allocate.js';

const sumStr = (xs: string[]) => xs.reduce((a, x) => a.plus(dec(x)), new D(0)).toFixed(2);
const e = (component: string, amount: string, over: Partial<AllocEntry> = {}): AllocEntry => ({
  component,
  amount,
  status: 'actual',
  lineItemId: null,
  refundId: null,
  ...over,
});

describe('splitByWeights', () => {
  it('splits exactly, with the largest remainder getting the odd cent', () => {
    const parts = splitByWeights(dec('100'), [dec('1'), dec('1'), dec('1')], 'USD');
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
  });

  it('keeps the sign and still sums exactly for negatives', () => {
    const parts = splitByWeights(dec('-10.01'), [dec('3'), dec('7')], 'USD');
    expect(sumStr(parts.map((p) => p.toFixed(2)))).toBe('-10.01');
    expect(parts.every((p) => p.lte(0))).toBe(true);
  });

  it('respects the currency minor unit', () => {
    const parts = splitByWeights(dec('100'), [dec('1'), dec('1'), dec('1')], 'JPY');
    expect(parts.map((p) => p.toFixed(0))).toEqual(['34', '33', '33']);
  });

  it('falls back to an equal split when all weights are zero, and handles no weights', () => {
    expect(
      splitByWeights(dec('1.00'), [dec('0'), dec('0')], 'USD').map((p) => p.toFixed(2)),
    ).toEqual(['0.50', '0.50']);
    expect(splitByWeights(dec('5'), [], 'USD')).toEqual([]);
  });

  it('never loses a cent for many awkward splits', () => {
    for (let n = 2; n < 9; n++) {
      const w = Array.from({ length: n }, (_, i) => dec(String(i * 3 + 1)));
      const parts = splitByWeights(dec('-123.45'), w, 'USD');
      expect(sumStr(parts.map((p) => p.toFixed(2)))).toBe('-123.45');
    }
  });
});

const order = (over: Partial<AllocInput> = {}): AllocInput => ({
  currency: 'USD',
  lines: [
    { lineItemId: '1', productId: 'A', quantity: 2, unitPrice: '30.00' }, // 60
    { lineItemId: '2', productId: 'B', quantity: 1, unitPrice: '40.00' }, // 40
  ],
  entries: [
    e('gross_sales', '100.00'),
    e('discounts', '-10.00'),
    e('shipping_revenue', '5.00'),
    e('payment_fees', '-3.00'),
    e('shipping_cost', '-4.00'),
    e('cogs', '-24.00', { lineItemId: '1', status: 'estimated' }),
    e('cogs', '-15.00', { lineItemId: '2', status: 'actual' }),
  ],
  refunds: [],
  ...over,
});

describe('allocateOrder', () => {
  it('splits sales and discounts by line value and keeps cost per line', () => {
    const r = allocateOrder(order());
    expect(r.lines.map((l) => [l.grossSales, l.discounts, l.cogs])).toEqual([
      ['60.0000', '-6.0000', '-24.0000'],
      ['40.0000', '-4.0000', '-15.0000'],
    ]);
    expect(r.lines.map((l) => l.profit)).toEqual(['30.0000', '21.0000']);
    expect(r.lines.map((l) => l.costStatus)).toEqual(['estimated', 'actual']);
  });

  it('reports order-level items as unallocated', () => {
    const r = allocateOrder(order());
    expect(r.unallocated).toEqual({
      shippingRevenue: '5.0000',
      shippingRefund: '0.0000',
      paymentFees: '-3.0000',
      shippingCost: '-4.0000',
      unlinkedCost: '0.0000',
    });
  });

  it('allocated product profit plus unallocated equals the order contribution', () => {
    const r = allocateOrder(order());
    const lines = r.lines.reduce((a, l) => a.plus(dec(l.profit)), new D(0));
    const un = Object.values(r.unallocated).reduce((a, v) => a.plus(dec(v)), new D(0));
    expect(lines.plus(un).toFixed(2)).toBe('49.00'); // 100-10+5-3-4-24-15
  });

  it('puts a refund on the refunded lines only', () => {
    const r = allocateOrder(
      order({
        entries: [...order().entries, e('product_refund', '-30.00', { refundId: 'R1' })],
        refunds: [{ refundId: 'R1', lines: [{ lineItemId: '2', subtotal: '30.00' }] }],
      }),
    );
    expect(r.lines.map((l) => l.productRefunds)).toEqual(['0.0000', '-30.0000']);
  });

  it('splits a refund over several refunded lines by their refunded amounts', () => {
    const r = allocateOrder(
      order({
        entries: [...order().entries, e('product_refund', '-40.00', { refundId: 'R1' })],
        refunds: [
          {
            refundId: 'R1',
            lines: [
              { lineItemId: '1', subtotal: '10.00' },
              { lineItemId: '2', subtotal: '30.00' },
            ],
          },
        ],
      }),
    );
    expect(r.lines.map((l) => l.productRefunds)).toEqual(['-10.0000', '-30.0000']);
  });

  it('falls back to the order split for a refund with no line detail', () => {
    const r = allocateOrder(
      order({ entries: [...order().entries, e('product_refund', '-10.00', { refundId: 'R9' })] }),
    );
    expect(r.lines.map((l) => l.productRefunds)).toEqual(['-6.0000', '-4.0000']);
  });

  it('marks a line with a missing cost and keeps cost reversals on their line', () => {
    const r = allocateOrder(
      order({
        entries: [
          e('gross_sales', '100.00'),
          e('cogs', '0.00', { lineItemId: '1', status: 'missing' }),
          e('cogs', '-10.00', { lineItemId: '1', status: 'actual' }),
          e('cogs_reversal', '5.00', { lineItemId: '1' }),
        ],
      }),
    );
    expect(r.lines[0]?.costStatus).toBe('missing');
    expect(r.lines[0]?.cogs).toBe('-5.0000');
    expect(r.lines[1]?.costStatus).toBe('none');
  });

  it('keeps cost that cannot be tied to a line instead of dropping it', () => {
    const r = allocateOrder(
      order({ entries: [e('gross_sales', '10.00'), e('cogs', '-3.00', { lineItemId: '999' })] }),
    );
    expect(r.unallocated.unlinkedCost).toBe('-3.0000');
  });

  it('an order with no lines allocates nothing to products', () => {
    expect(allocateOrder(order({ lines: [] })).lines).toEqual([]);
  });

  it('splits odd amounts without losing a cent across three lines', () => {
    const r = allocateOrder({
      currency: 'USD',
      lines: [1, 2, 3].map((n) => ({
        lineItemId: String(n),
        productId: String(n),
        quantity: 1,
        unitPrice: '10.00',
      })),
      entries: [e('gross_sales', '30.00'), e('discounts', '-10.00')],
      refunds: [],
    });
    expect(sumStr(r.lines.map((l) => l.discounts))).toBe('-10.00');
  });
});
