import { describe, expect, it } from 'vitest';
import { allRealOrders, config, realOrder } from '../test/helpers.js';
import { calculateOrder } from './order.js';
import { summarize } from './summary.js';
import type { LedgerEntry } from './types.js';

// Golden tests: the worked examples of docs/finance/profit-calculation-spec.md section 14,
// computed from real (fake-store) orders. If one of these fails, the engine no longer matches the
// approved specification.

const run = (name: string, cfg = config()) => calculateOrder(realOrder(name), cfg);
const asSummary = (entries: LedgerEntry[], orderKey = 1) =>
  entries.map((e) => ({ ...e, orderKey }));
const one = (entries: LedgerEntry[], component: string) =>
  entries.filter((e) => e.component === component);
const total = (entries: LedgerEntry[], component: string) =>
  one(entries, component).reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0) / 100;
const contribution = (entries: LedgerEntry[]) =>
  summarize(asSummary(entries), { orderCount: 1 }).contributionProfit;
const inMonth = (entries: LedgerEntry[], month: string) =>
  entries.filter((e) => e.entryDate.startsWith(month));

describe('E1 paid, tax on top, partial refund later (#1064)', () => {
  const r = run('#1064');

  it('produces the approved ledger', () => {
    expect(r.recognized).toBe(true);
    expect(total(r.entries, 'gross_sales')).toBe(2371.9);
    expect(total(r.entries, 'shipping_revenue')).toBe(14.99);
    expect(total(r.entries, 'cogs')).toBe(-1374.86);
    expect(total(r.entries, 'product_refund')).toBe(-600);
    expect(total(r.entries, 'tax_collected')).toBe(118.6); // memo, not in profit
    expect(one(r.entries, 'product_refund')[0]!.entryDate).toBe('2026-08-21');
  });

  it('contribution before fees and shipping cost is 412.03', () => {
    expect(contribution(r.entries)).toBe('412.0300');
  });

  it('with a 2.9% + 0.30 fee rule and 8.00 flat shipping cost it is 331.07', () => {
    const withRules = run(
      '#1064',
      config({
        feeRules: [
          {
            gateway: null,
            percent: '2.9',
            fixedAmount: '0.30',
            currency: 'USD',
            effectiveFrom: '2026-01-01',
          },
        ],
        shippingRules: [
          { mode: 'flat', amount: '8.00', percent: null, effectiveFrom: '2026-01-01' },
        ],
      }),
    );
    expect(total(withRules.entries, 'payment_fees')).toBe(-72.96); // 2505.49 x 2.9% + 0.30
    expect(total(withRules.entries, 'shipping_cost')).toBe(-8);
    expect(contribution(withRules.entries)).toBe('331.0700');
  });
});

describe('E2 tax-inclusive prices (#1057)', () => {
  const r = run('#1057');
  it('removes the tax embedded in the price: gross ex tax 2,319.08', () => {
    expect(total(r.entries, 'gross_sales')).toBe(2319.08);
    expect(total(r.entries, 'shipping_revenue')).toBe(9.99);
    expect(total(r.entries, 'cogs')).toBe(-1934.92);
    expect(contribution(r.entries)).toBe('394.1500');
  });
});

describe('E3 order-level percentage discount (#1010)', () => {
  const r = run('#1010');
  it('derives the discount from the subtotal (it is not on the lines) and flags the missing cost', () => {
    expect(total(r.entries, 'gross_sales')).toBe(34.9);
    expect(total(r.entries, 'discounts')).toBe(-6.98);
    expect(total(r.entries, 'shipping_revenue')).toBe(9.99);
    expect(total(r.entries, 'cogs')).toBe(-5.87);
    expect(contribution(r.entries)).toBe('32.0400');
    const missing = one(r.entries, 'cogs').filter((e) => e.status === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.basisAmount).toBe('24.9500'); // value of sales without a cost
    expect(summarize(asSummary(r.entries), { orderCount: 1 }).partial).toBe(true);
  });
});

describe('E4 late refund, cash view (#1013: order 2026-08-30, refund 2026-10-08)', () => {
  const r = run('#1013');
  it('August keeps its profit; the refund lands in October', () => {
    const aug = summarize(asSummary(inMonth(r.entries, '2026-08')), { orderCount: 1 });
    const oct = summarize(asSummary(inMonth(r.entries, '2026-10')), { orderCount: 0 });
    expect(aug.contributionProfit).toBe('547.7100'); // 885.95 + 25.00 - 363.24
    expect(oct.contributionProfit).toBe('-885.9500');
  });
});

describe('E5 full refund, goods not restocked (#1014)', () => {
  const r = run('#1014');
  it('the cost of the lost goods stays: -699.22', () => {
    expect(total(r.entries, 'product_refund')).toBe(-1585.9);
    expect(total(r.entries, 'cogs_reversal')).toBe(0);
    expect(contribution(r.entries)).toBe('-699.2200');
    expect(total(r.entries, 'tax_refunded')).toBe(-79.3); // memo
  });

  it('if the same refund restocked the goods the cost is returned and profit is 0.00', () => {
    const o = realOrder('#1014');
    for (const refund of o.refunds) for (const l of refund.lines) l.restockType = 'RETURN';
    const r2 = calculateOrder(o, config());
    expect(total(r2.entries, 'cogs_reversal')).toBe(699.22);
    expect(contribution(r2.entries)).toBe('0.0000');
  });
});

describe('E6 negative-profit order (#1019)', () => {
  const r = run('#1019');
  it('-157.50 with complete costs, so it is a defensible loss', () => {
    expect(total(r.entries, 'discounts')).toBe(-262.48);
    expect(total(r.entries, 'cogs')).toBe(-659.96);
    expect(contribution(r.entries)).toBe('-157.5000');
    expect(one(r.entries, 'cogs').every((e) => e.status === 'estimated')).toBe(true);
  });
});

describe('E7 100% discount (#1002)', () => {
  const r = run('#1002');
  it('revenue 0, margin empty, 749.95 of sales without cost is missing', () => {
    const s = summarize(asSummary(r.entries), { orderCount: 1 });
    expect(s.revenue).toBe('0.0000');
    expect(s.contributionMargin).toBeNull();
    expect(s.contributionProfit).toBe('0.0000');
    expect(one(r.entries, 'cogs')[0]).toMatchObject({ status: 'missing', basisAmount: '749.9500' });
    expect(one(r.entries, 'payment_fees')[0]).toMatchObject({ status: 'not_applicable' }); // nothing was paid
  });
});

describe('E8 cancelled after payment and refunded (#1048)', () => {
  it('counts the order and its refund: -425.26', () => {
    const r = run('#1048');
    expect(r.recognized).toBe(true);
    expect(contribution(r.entries)).toBe('-425.2600');
  });
});

describe('orders that do not count', () => {
  it('cancelled unpaid orders produce nothing, even though they have a refund record (#1004, #1069)', () => {
    for (const n of ['#1004', '#1069']) {
      const r = run(n);
      expect(r.recognized).toBe(false);
      expect(r.exclusionReason).toBe('cancelled_unpaid');
      expect(r.entries).toEqual([]);
    }
  });

  it('authorized, pending and partially paid orders are "awaiting payment"', () => {
    for (const n of ['#1016', '#1032', '#1122']) {
      const r = run(n);
      expect(r.exclusionReason, n).toBe('awaiting_payment');
      expect(r.entries).toEqual([]);
    }
  });
});

describe('invariants over every real order', () => {
  const cases = allRealOrders();

  it('revenue (ex tax) + tax equals what Shopify says the customer paid', () => {
    let checked = 0;
    for (const { name, order } of cases) {
      const r = calculateOrder(order, config());
      if (!r.recognized) continue;
      const exTax =
        total(r.entries, 'gross_sales') +
        total(r.entries, 'discounts') +
        total(r.entries, 'shipping_revenue');
      const tax = total(r.entries, 'tax_collected');
      expect(Math.round((exTax + tax) * 100), name).toBe(
        Math.round(Number(order.totalAmount) * 100),
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('each refund reconciles: product + shipping + tax parts equal the money returned', () => {
    let checked = 0;
    for (const { name, order } of cases) {
      const r = calculateOrder(order, config());
      if (!r.recognized) continue;
      for (const refund of order.refunds) {
        if (!(Number(refund.totalAmount) > 0)) continue;
        const parts = r.entries.filter(
          (e) =>
            e.refundShopifyId === refund.shopifyId &&
            ['product_refund', 'shipping_refund', 'tax_refunded'].includes(e.component),
        );
        const sum = parts.reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0);
        expect(-sum, name).toBe(Math.round(Number(refund.totalAmount) * 100));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('is deterministic and does not mutate its input', () => {
    const o = realOrder('#1064');
    const before = JSON.stringify(o);
    expect(calculateOrder(o, config())).toEqual(calculateOrder(o, config()));
    expect(JSON.stringify(o)).toBe(before);
  });

  it('free-shipping orders split the shipping discount from the product discount', () => {
    for (const n of ['#1089', '#1024', '#1012']) {
      const r = run(n);
      expect(total(r.entries, 'discounts'), n).toBe(0); // no product discount
      expect(total(r.entries, 'shipping_revenue'), n).toBe(0); // shipping was free
    }
  });
});
