import { describe, expect, it } from 'vitest';
import { emptyConfig, line, order } from '../test/helpers.js';
import { calculateOrder } from './order.js';
import type { EngineConfig, EngineOrder } from './types.js';

/** An order that ships: 1 unit at 100.00, 10.00 shipping charged, paid 110.00. */
const shipped = (over: Partial<EngineOrder> = {}): EngineOrder =>
  order({
    shopifyId: 7001,
    lines: [line({ shopifyId: 1, variantShopifyId: 100, quantity: 1, unitPriceAmount: '100.00' })],
    subtotalAmount: '100.00',
    discountsAmount: '0.00',
    shippingAmount: '10.00',
    totalAmount: '110.00',
    ...over,
  });

const cost = (o: EngineOrder, cfg: EngineConfig) =>
  calculateOrder(o, cfg).entries.find((e) => e.component === 'shipping_cost')!;

describe('shipping cost from a carrier invoice', () => {
  it('is the actual cost, with the carrier named', () => {
    const cfg: EngineConfig = {
      ...emptyConfig(),
      carrierCosts: new Map([[7001, { amount: '8.4000', carriers: ['dhl'] }]]),
    };
    const e = cost(shipped(), cfg);
    expect(e.amount).toBe('-8.4000');
    expect(e.status).toBe('actual');
    expect(e.source).toBe('carrier invoice: dhl');
  });

  it('replaces what a rule would have estimated', () => {
    const rules: EngineConfig = {
      ...emptyConfig(),
      shippingRules: [
        {
          mode: 'flat',
          amount: '5.00',
          percent: null,
          effectiveFrom: '2000-01-01',
        },
      ],
    };
    expect(cost(shipped(), rules).status).toBe('estimated');
    const withInvoice: EngineConfig = {
      ...rules,
      carrierCosts: new Map([[7001, { amount: '9.1000', carriers: ['ups', 'fedex'] }]]),
    };
    const e = cost(shipped(), withInvoice);
    expect(e.amount).toBe('-9.1000');
    expect(e.status).toBe('actual');
    expect(e.source).toBe('carrier invoice: ups, fedex');
  });

  it('only touches the order it is for; the others stay missing', () => {
    const cfg: EngineConfig = {
      ...emptyConfig(),
      carrierCosts: new Map([[9999, { amount: '8.4000', carriers: ['dhl'] }]]),
    };
    expect(cost(shipped(), cfg).status).toBe('missing');
  });
});
