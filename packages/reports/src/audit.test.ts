import { describe, expect, it } from 'vitest';
import type { ProfitAggregate } from '@pi/db';
import { dataNotesFrom } from './audit.js';

const agg = (over: Partial<ProfitAggregate['coverage']>, totals = {}): ProfitAggregate => ({
  totals,
  coverage: { cost: null, fees: null, shipping: null, ...over },
  anyMissing: false,
  orderCount: 10,
});

describe('data notes for an export', () => {
  it('says there is nothing to qualify when there are no orders', () => {
    expect(dataNotesFrom(agg({}), 'USD')).toEqual([
      'No counted orders in this period, so there is nothing to qualify.',
    ]);
  });

  it('says everything is confirmed when nothing is estimated or missing', () => {
    const n = dataNotesFrom(
      agg({
        cost: { actual: '100.0000', estimated: '0.0000', missing: '0.0000' },
        fees: { actual: 10, estimated: 0, missing: 0 },
        shipping: { actual: 10, estimated: 0, missing: 0 },
      }),
      'USD',
    );
    expect(n).toEqual(['All costs in this period are confirmed or reported by Shopify.']);
  });

  it('reports estimated and unknown fees and shipping with order counts and the estimated amount', () => {
    const n = dataNotesFrom(
      agg(
        {
          cost: { actual: '60.0000', estimated: '20.0000', missing: '20.0000' },
          fees: { actual: 5, estimated: 4, missing: 1 },
          shipping: { actual: 0, estimated: 0, missing: 10 },
        },
        { payment_fees: '-50.0000', payment_fees_estimated: '-30.0000' },
      ),
      'USD',
    );
    expect(n).toEqual([
      'Product cost is missing for 20.0% of sales value, so profit is overstated by the cost of those items.',
      "Product cost is Shopify's unit cost, not confirmed by you, for 20.0% of sales value.",
      'Payment fees is estimated from your rule on 4 of 10 orders. The rest are the fees Shopify reported.',
      'Payment fees is unknown on 1 of 10 orders and is left out of profit.',
      'Estimated payment fees total 30.0000 of 50.0000 USD.',
      'Shipping cost is unknown on 10 of 10 orders and is left out of profit.',
    ]);
  });
});
