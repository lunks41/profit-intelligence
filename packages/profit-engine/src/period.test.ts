import { describe, expect, it } from 'vitest';
import { operatingExpensesFor, summarizePeriod, totalAdSpend } from './period.js';
import type { PeriodInputs } from './period.js';

/**
 * Worked example (all amounts USD):
 *   gross sales 1000.00, discounts 100.00, product refunds 50.00        -> net sales 850.00
 *   shipping charged 30.00, shipping refunded 10.00                      -> revenue 870.00
 *   product cost 400.00, of which 20.00 came back on a restocked refund  -> product cost 380.00
 *   payment fees 30.00, shipping cost 25.00
 *   contribution before advertising = 870 - 380 - 30 - 25 = 435.00
 *   advertising 35.00                                                    -> contribution profit 400.00
 *   operating expenses 100.00                                            -> estimated net profit 300.00
 */
const totals = {
  gross_sales: '1000.0000',
  discounts: '-100.0000',
  product_refund: '-50.0000',
  shipping_revenue: '30.0000',
  shipping_refund: '-10.0000',
  cogs: '-400.0000',
  cogs_reversal: '20.0000',
  payment_fees: '-30.0000',
  shipping_cost: '-25.0000',
};

const allActual = {
  cost: { actual: '1000.0000', estimated: '0.0000', missing: '0.0000' },
  fees: { actual: 10, estimated: 0, missing: 0 },
  shipping: { actual: 10, estimated: 0, missing: 0 },
};

const input = (over: Partial<PeriodInputs> = {}): PeriodInputs => ({
  totals,
  coverage: allActual,
  anyMissing: false,
  orderCount: 10,
  ads: { configured: true, hasData: true, spend: '35.0000' },
  operatingExpenses: '100.0000',
  ...over,
});

describe('the headline formulas (worked example)', () => {
  const s = summarizePeriod(input());
  it('net sales, revenue and product cost', () => {
    expect(s.netSales).toBe('850.0000');
    expect(s.revenue).toBe('870.0000');
    expect(s.cogs).toBe('380.0000');
    expect(s.paymentFees).toBe('30.0000');
    expect(s.shippingCost).toBe('25.0000');
  });
  it('contribution before advertising, contribution profit, margin and net profit', () => {
    expect(s.contributionBeforeAds).toBe('435.0000');
    expect(s.contributionProfit).toBe('400.0000');
    expect(s.contributionMargin).toBe('0.4598'); // 400 / 870
    expect(s.estimatedNetProfit).toBe('300.0000');
    expect(s.netProfitBasis).toBe('full');
  });
  it('average order value and refund rate', () => {
    expect(s.averageOrderValue).toBe('87.0000');
    expect(s.refundRate).toBe('0.0500'); // 50 / 1000
  });
  it('everything confirmed means no qualifiers', () => {
    expect(s.statuses).toEqual({
      cogs: 'confirmed',
      paymentFees: 'confirmed',
      shippingCost: 'confirmed',
      advertising: 'confirmed',
      operatingExpenses: 'confirmed',
      estimatedNetProfit: 'confirmed',
    });
    expect(s.qualifiers).toEqual([]);
  });
  it('is deterministic: the same input twice gives the same figures', () => {
    expect(summarizePeriod(input())).toEqual(summarizePeriod(input()));
  });
});

describe('unknown is not zero: advertising and operating expenses', () => {
  it('with no advertising account and no expenses, profit excludes both and net is not available', () => {
    const s = summarizePeriod(
      input({
        ads: { configured: false, hasData: false, spend: '0.0000' },
        operatingExpenses: null,
      }),
    );
    expect(s.statuses.advertising).toBe('not_configured');
    expect(s.statuses.operatingExpenses).toBe('not_configured');
    expect(s.statuses.estimatedNetProfit).toBe('not_configured');
    expect(s.adSpend).toBeNull();
    expect(s.operatingExpenses).toBeNull();
    expect(s.estimatedNetProfit).toBeNull();
    expect(s.netProfitBasis).toBe('contribution_only');
    expect(s.contributionProfit).toBe(s.contributionBeforeAds); // nothing taken off
    expect(s.qualifiers).toContain('Advertising is not set up, so profit excludes advertising.');
    expect(s.qualifiers).toContain(
      'No operating expenses are set up, so estimated net profit is not available.',
    );
  });

  it('an advertising account without spend in the period is "missing", not zero', () => {
    const s = summarizePeriod(
      input({ ads: { configured: true, hasData: false, spend: '0.0000' } }),
    );
    expect(s.statuses.advertising).toBe('missing');
    expect(s.adSpend).toBeNull();
    expect(s.qualifiers.join(' ')).toMatch(/No advertising spend was imported/);
    // net is a number only because expenses exist, and it is called an estimate
    expect(s.estimatedNetProfit).toBe('335.0000');
    expect(s.statuses.estimatedNetProfit).toBe('estimated');
  });

  it('spend entered as exactly 0.00 is a confirmed zero, not missing', () => {
    const s = summarizePeriod(input({ ads: { configured: true, hasData: true, spend: '0.0000' } }));
    expect(s.statuses.advertising).toBe('confirmed');
    expect(s.adSpend).toBe('0.0000');
    expect(s.contributionProfit).toBe('435.0000');
  });

  it('operating expenses of exactly 0 (entered) are confirmed; none entered is not configured', () => {
    expect(summarizePeriod(input({ operatingExpenses: '0.0000' })).statuses.operatingExpenses).toBe(
      'confirmed',
    );
    expect(summarizePeriod(input({ operatingExpenses: null })).statuses.operatingExpenses).toBe(
      'not_configured',
    );
  });
});

describe('unknown is not zero: product cost, payment fees and shipping cost', () => {
  it('fees missing on every order: status missing, share 1, never a confirmed zero', () => {
    const s = summarizePeriod(
      input({
        totals: { ...totals, payment_fees: '0.0000' },
        coverage: { ...allActual, fees: { actual: 0, estimated: 0, missing: 10 } },
        anyMissing: true,
      }),
    );
    expect(s.statuses.paymentFees).toBe('missing');
    expect(s.missingShares.paymentFees).toBe('1.0000');
    expect(s.partial).toBe(true);
    expect(s.qualifiers).toContain('Payment fees are missing for 10 of 10 orders.');
    expect(s.statuses.estimatedNetProfit).toBe('estimated'); // never "confirmed" with a gap
  });

  it('the same zero with every fee confirmed is a confirmed zero', () => {
    const s = summarizePeriod(input({ totals: { ...totals, payment_fees: '0.0000' } }));
    expect(s.statuses.paymentFees).toBe('confirmed');
    expect(s.missingShares.paymentFees).toBe('0.0000');
  });

  it('partly missing: the share is exact and the qualifier says how many', () => {
    const s = summarizePeriod(
      input({
        coverage: { ...allActual, shipping: { actual: 6, estimated: 1, missing: 3 } },
        anyMissing: true,
      }),
    );
    expect(s.statuses.shippingCost).toBe('missing');
    expect(s.missingShares.shippingCost).toBe('0.3000');
    expect(s.qualifiers).toContain('Shipping cost is missing for 3 of 10 orders.');
  });

  it('product cost is weighted by sales value', () => {
    const s = summarizePeriod(
      input({
        coverage: {
          ...allActual,
          cost: { actual: '600.0000', estimated: '150.0000', missing: '250.0000' },
        },
        anyMissing: true,
      }),
    );
    expect(s.statuses.cogs).toBe('missing');
    expect(s.missingShares.cogs).toBe('0.2500');
    expect(s.qualifiers).toContain('Product cost is missing for 25% of sales value.');
  });

  it('estimates are labelled as estimates', () => {
    const s = summarizePeriod(
      input({ coverage: { ...allActual, fees: { actual: 4, estimated: 6, missing: 0 } } }),
    );
    expect(s.statuses.paymentFees).toBe('estimated');
    expect(s.qualifiers).toContain(
      'Some product costs, payment fees or shipping costs are estimates.',
    );
    expect(s.statuses.estimatedNetProfit).toBe('estimated');
  });

  it('nothing of the kind in the period is not applicable', () => {
    const s = summarizePeriod(input({ coverage: { ...allActual, shipping: null } }));
    expect(s.statuses.shippingCost).toBe('not_applicable');
    expect(s.missingShares.shippingCost).toBeNull();
  });
});

describe('decimal-safe helpers', () => {
  it('adds spend without binary floating point error (0.10 + 0.20 is exactly 0.30)', () => {
    expect(totalAdSpend([{ spend: '0.1000' }, { spend: '0.2000' }])).toBe('0.3000');
  });
  it('sums many small amounts exactly', () => {
    const many = Array.from({ length: 1000 }, () => ({ spend: '0.0100' }));
    expect(totalAdSpend(many)).toBe('10.0000');
  });
  it('operating expenses are null (not configured) when none exist, never zero', () => {
    expect(
      operatingExpensesFor([], [], { from: '2026-09-01', to: '2026-09-30' }, 'USD'),
    ).toBeNull();
  });
  it('a monthly expense for a whole month is the whole amount', () => {
    const total = operatingExpensesFor(
      [
        {
          id: 'e1',
          categoryId: 'c',
          amount: '300.0000',
          kind: 'recurring',
          frequency: 'monthly',
          startDate: '2026-01-01',
          endDate: null,
        },
      ],
      [],
      { from: '2026-09-01', to: '2026-09-30' },
      'USD',
    );
    expect(total).toBe('300.0000');
  });
});
