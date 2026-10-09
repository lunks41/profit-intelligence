import { describe, expect, it } from 'vitest';
import { convertEntries } from './convert.js';
import { pegProvider, tableProvider } from './fx.js';
import { confidence, summarize } from './summary.js';
import type { SummaryEntry } from './summary.js';
import type { Component, Status } from './types.js';

const e = (
  component: Component,
  amount: string,
  over: Partial<SummaryEntry> & { status?: Status } = {},
): SummaryEntry => ({
  orderKey: 1,
  component,
  amount,
  status: 'actual',
  basisAmount: null,
  memo: false,
  ...over,
});

describe('summarize', () => {
  const entries: SummaryEntry[] = [
    e('gross_sales', '1000.0000'),
    e('discounts', '-100.0000'),
    e('shipping_revenue', '50.0000'),
    e('product_refund', '-200.0000'),
    e('shipping_refund', '-10.0000'),
    e('cogs', '-400.0000', { status: 'estimated', basisAmount: '1000.0000' }),
    e('cogs_reversal', '40.0000', { status: 'estimated' }),
    e('payment_fees', '-30.0000', { status: 'estimated' }),
    e('shipping_cost', '-20.0000', { status: 'estimated' }),
    e('tax_collected', '80.0000', { memo: true }),
    e('tax_refunded', '-16.0000', { memo: true }),
  ];

  it('follows the approved formulas', () => {
    const s = summarize(entries, { orderCount: 4 });
    expect(s.grossSales).toBe('1000.0000');
    expect(s.discounts).toBe('100.0000');
    expect(s.productRefunds).toBe('200.0000');
    expect(s.netSales).toBe('700.0000'); // 1000 - 100 - 200
    expect(s.shippingRevenue).toBe('40.0000'); // 50 - 10
    expect(s.revenue).toBe('740.0000');
    expect(s.cogs).toBe('360.0000'); // 400 - 40 returned to stock
    expect(s.paymentFees).toBe('30.0000');
    expect(s.shippingCost).toBe('20.0000');
    expect(s.contributionProfit).toBe('330.0000'); // 740 - 360 - 30 - 20
    expect(s.contributionMargin).toBe('0.4459'); // 330 / 740
    expect(s.averageOrderValue).toBe('185.0000'); // 740 / 4
    expect(s.refundRate).toBe('0.2000'); // 200 / 1000
    expect(s.taxCollected).toBe('80.0000');
    expect(s.taxRefunded).toBe('16.0000');
  });

  it('tax is memo only: it never changes profit', () => {
    const without = summarize(
      entries.filter((x) => !x.memo),
      { orderCount: 4 },
    );
    const withTax = summarize(entries, { orderCount: 4 });
    expect(withTax.contributionProfit).toBe(without.contributionProfit);
  });

  it('subtracts advertising spend only when connected', () => {
    expect(summarize(entries, { orderCount: 4 }).adSpend).toBeNull();
    const s = summarize(entries, {
      orderCount: 4,
      adSpend: { amount: '100.0000', status: 'actual' },
    });
    expect(s.adSpend).toBe('100.0000');
    expect(s.contributionProfit).toBe('230.0000');
  });

  it('net profit is only "full" when operating expenses were entered (D4)', () => {
    const none = summarize(entries, { orderCount: 4 });
    expect(none).toMatchObject({ netProfitBasis: 'contribution_only', estimatedNetProfit: null });
    const some = summarize(entries, {
      orderCount: 4,
      operatingExpenses: { amount: '120.0000', status: 'actual' },
    });
    expect(some).toMatchObject({ netProfitBasis: 'full', estimatedNetProfit: '210.0000' });
  });

  it('empty period: zeros, and ratios are null instead of NaN or Infinity', () => {
    const s = summarize([], { orderCount: 0 });
    expect(s.revenue).toBe('0.0000');
    expect(s.contributionMargin).toBeNull();
    expect(s.averageOrderValue).toBeNull();
    expect(s.refundRate).toBeNull();
    expect(s.confidence.band).toBeNull();
    expect(s.partial).toBe(false);
  });

  it('a loss gives a negative margin', () => {
    const s = summarize(
      [e('gross_sales', '100.0000'), e('cogs', '-150.0000', { basisAmount: '100.0000' })],
      { orderCount: 1 },
    );
    expect(s.contributionProfit).toBe('-50.0000');
    expect(s.contributionMargin).toBe('-0.5000');
  });

  it('is partial exactly when a cost, fee or shipping cost is missing', () => {
    expect(summarize(entries, { orderCount: 1 }).partial).toBe(false);
    expect(
      summarize([...entries, e('payment_fees', '0.0000', { status: 'missing', orderKey: 2 })], {
        orderCount: 2,
      }).partial,
    ).toBe(true);
    expect(
      summarize(
        [...entries, e('shipping_cost', '0.0000', { status: 'not_applicable', orderKey: 2 })],
        { orderCount: 2 },
      ).partial,
    ).toBe(false);
  });

  it('does not depend on the order of the entries', () => {
    const shuffled = [...entries].reverse();
    expect(summarize(shuffled, { orderCount: 4 })).toEqual(summarize(entries, { orderCount: 4 }));
  });

  it('adds money exactly (no float drift)', () => {
    const many = Array.from({ length: 10 }, () => e('gross_sales', '0.1000'));
    expect(summarize(many, { orderCount: 10 }).grossSales).toBe('1.0000');
  });
});

describe('confidence (D5)', () => {
  const cost = (status: Status, basis: string, orderKey = 1) =>
    e('cogs', '-1.0000', { status, basisAmount: basis, orderKey });
  const fee = (status: Status, orderKey = 1) => e('payment_fees', '-1.0000', { status, orderKey });
  const ship = (status: Status, orderKey = 1) =>
    e('shipping_cost', '-1.0000', { status, orderKey });

  it('all actual is High with score 1', () => {
    const c = confidence([cost('actual', '100'), fee('actual'), ship('actual')]);
    expect(c).toMatchObject({ band: 'high', score: '1.0000' });
  });

  it('estimated counts half: all estimated scores 0.5 (Low)', () => {
    const c = confidence([cost('estimated', '100'), fee('estimated'), ship('estimated')]);
    expect(c).toMatchObject({ band: 'low', score: '0.5000' });
  });

  it('weights are 60% cost, 20% fees, 20% shipping', () => {
    // cost fully actual (1.0), fees and shipping missing (0) -> 0.6 -> Medium (boundary is inclusive)
    expect(confidence([cost('actual', '100'), fee('missing'), ship('missing')])).toMatchObject({
      band: 'medium',
      score: '0.6000',
    });
    // cost estimated (0.5), others missing -> 0.3
    expect(confidence([cost('estimated', '100'), fee('missing'), ship('missing')])).toMatchObject({
      band: 'low',
      score: '0.3000',
    });
    // cost actual, fees actual, shipping missing -> 0.8
    expect(confidence([cost('actual', '100'), fee('actual'), ship('missing')])).toMatchObject({
      band: 'medium',
      score: '0.8000',
    });
  });

  it('90% is the High boundary', () => {
    // cost 100% actual (0.6) + fees 100% actual (0.2) + shipping 50% actual 50% missing (0.1) = 0.9
    const c = confidence([
      cost('actual', '100'),
      fee('actual', 1),
      fee('actual', 2),
      ship('actual', 1),
      ship('missing', 2),
    ]);
    expect(c).toMatchObject({ band: 'high', score: '0.9000' });
  });

  it('weights product cost by sales value, not by line count', () => {
    // a 900 line with cost, a 100 line without -> 90% covered
    const c = confidence([cost('actual', '900', 1), cost('missing', '100', 2)]);
    expect(c.components.cost?.shares).toEqual({
      actual: '0.9000',
      estimated: '0.0000',
      missing: '0.1000',
    });
    expect(c.components.cost?.quality).toBe('0.9000');
  });

  it('fees and shipping are judged per order, by the weakest part', () => {
    // order 1 has two payments: one actual, one missing -> the order counts as missing
    const c = confidence([fee('actual', 1), fee('missing', 1), fee('actual', 2)]);
    expect(c.components.fees?.shares).toEqual({
      actual: '0.5000',
      estimated: '0.0000',
      missing: '0.5000',
    });
  });

  it('not-applicable components are left out and the other weights are rescaled', () => {
    // shipping not applicable everywhere: cost 1.0 (w .6) and fees 0 (w .2) -> 0.6 / 0.8 = 0.75
    const c = confidence([cost('actual', '100'), fee('missing'), ship('not_applicable')]);
    expect(c.components.shipping).toBeUndefined();
    expect(c).toMatchObject({ band: 'medium', score: '0.7500' });
  });

  it('has no band when nothing needs cost data', () => {
    expect(confidence([e('gross_sales', '10.0000')])).toMatchObject({ band: null, score: null });
    expect(confidence([fee('not_applicable'), ship('not_applicable')]).band).toBeNull();
  });

  it('exposes the missing cost share for the merchant warning threshold', () => {
    const s = summarize([cost('actual', '800'), cost('missing', '200', 2)], { orderCount: 2 });
    expect(s.missingCostShare).toBe('0.2000');
  });

  it('the dev-store situation: Shopify costs only and no fee or shipping rules is Low', () => {
    // 13% of sales without cost, the rest estimated; fees and shipping fully missing
    const c = confidence([
      cost('estimated', '87'),
      cost('missing', '13', 2),
      fee('missing', 1),
      fee('missing', 2),
      ship('missing', 1),
      ship('missing', 2),
    ]);
    expect(c.band).toBe('low');
  });
});

describe('convertEntries', () => {
  const entries = [
    { amount: '100.0000', entryDate: '2026-08-03' },
    { amount: '-50.0000', entryDate: '2026-08-07' },
  ];

  it('converts each entry at its own date and keeps provenance', () => {
    const rates = tableProvider([
      {
        base: 'EUR',
        quote: 'USD',
        rate: '1.0800',
        date: '2026-08-03',
        source: 'feed',
        status: 'actual',
      },
      {
        base: 'EUR',
        quote: 'USD',
        rate: '1.1000',
        date: '2026-08-07',
        source: 'feed',
        status: 'actual',
      },
    ]);
    const out = convertEntries(entries, 'EUR', 'USD', rates);
    expect(out[0]!.converted).toMatchObject({ status: 'actual', rate: '1.0800' });
    expect(out[1]!.converted).toMatchObject({ status: 'actual', rate: '1.1000' });
    // the original amount is untouched
    expect(out[0]!.amount).toBe('100.0000');
  });

  it('flags a missing rate rather than assuming one', () => {
    const out = convertEntries(
      entries,
      'GBP',
      'AED',
      pegProvider([{ base: 'USD', quote: 'AED', rate: '3.6725', source: 'peg' }]),
    );
    expect(out.every((x) => x.converted.status === 'missing')).toBe(true);
  });

  it('USD to AED by peg is actual', () => {
    const out = convertEntries(
      entries,
      'USD',
      'AED',
      pegProvider([{ base: 'USD', quote: 'AED', rate: '3.6725', source: 'peg' }]),
    );
    expect(out[0]!.converted.status).toBe('actual');
    if (out[0]!.converted.status !== 'missing')
      expect(out[0]!.converted.amount.toString()).toBe('367.25');
  });
});
