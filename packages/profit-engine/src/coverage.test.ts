import { describe, expect, it } from 'vitest';
import { ruleCoverage } from './coverage.js';
import type { EngineLine, EngineOrder, EngineTransaction, FeeRule, ShippingRule } from './types.js';

const line = (over: Partial<EngineLine> = {}): EngineLine =>
  ({
    shopifyId: 1,
    variantShopifyId: 11,
    quantity: 1,
    unitPriceAmount: '50.00',
    requiresShipping: true,
    isGiftCard: false,
    ...over,
  }) as EngineLine;

const txn = (over: Partial<EngineTransaction> = {}): EngineTransaction => ({
  shopifyId: 1,
  kind: 'SALE',
  status: 'SUCCESS',
  gateway: 'paypal',
  amount: '50.00',
  feeAmount: null,
  ...over,
});

const order = (over: Partial<EngineOrder> = {}): EngineOrder =>
  ({
    shopifyId: 1,
    processedAt: new Date('2026-09-10T10:00:00Z'),
    isTest: false,
    financialStatus: 'PAID',
    cancelledAt: null,
    taxesIncluded: false,
    currency: 'USD',
    shipCountry: 'US',
    subtotalAmount: '50.00',
    discountsAmount: '0.00',
    shippingAmount: '5.00',
    taxAmount: '0.00',
    totalAmount: '55.00',
    lines: [line()],
    refunds: [],
    transactions: [txn()],
    ...over,
  }) as EngineOrder;

const fee = (over: Partial<FeeRule> = {}): FeeRule => ({
  gateway: null,
  percent: '2.9',
  fixedAmount: '0.30',
  currency: 'USD',
  effectiveFrom: '2026-01-01',
  ...over,
});
const ship = (over: Partial<ShippingRule> = {}): ShippingRule => ({
  mode: 'flat',
  amount: '6.00',
  percent: null,
  effectiveFrom: '2026-01-01',
  ...over,
});
const cfg = (over = {}) => ({
  timezone: 'UTC',
  feeRules: [] as FeeRule[],
  shippingRules: [] as ShippingRule[],
  variantWeights: new Map<number, number>([[11, 400]]),
  ...over,
});

describe('rule coverage', () => {
  it('counts only counted orders', () => {
    const r = ruleCoverage(
      [order(), order({ isTest: true }), order({ financialStatus: 'PENDING' })],
      cfg(),
    );
    expect(r.orders).toBe(1);
  });

  it('separates fees Shopify reported from fees a rule prices and fees nothing covers', () => {
    const orders = [
      order({ transactions: [txn({ gateway: 'shopify_payments', feeAmount: '1.75' })] }),
      order({ transactions: [txn({ gateway: 'paypal' })] }),
      order({ transactions: [txn({ gateway: 'cod' })] }),
    ];
    const r = ruleCoverage(orders, cfg({ feeRules: [fee({ gateway: 'paypal' })] }));
    expect(r.fees).toMatchObject({ payments: 3, reported: 1, covered: 1, uncovered: 1 });
    expect(r.fees.byGateway.map((g) => [g.gateway, g.reported, g.covered, g.uncovered])).toEqual(
      expect.arrayContaining([
        ['shopify_payments', 1, 0, 0],
        ['paypal', 0, 1, 0],
        ['cod', 0, 0, 1],
      ]),
    );
    expect(r.fees.candidateApplies).toBeNull();
  });

  it('ignores refunds, voided and failed payments', () => {
    const r = ruleCoverage(
      [
        order({
          transactions: [
            txn(),
            txn({ kind: 'REFUND' }),
            txn({ status: 'FAILURE' }),
            txn({ kind: 'AUTHORIZATION' }),
          ],
        }),
      ],
      cfg(),
    );
    expect(r.fees.payments).toBe(1);
  });

  it('a candidate fee rule says how many payments it would be chosen for', () => {
    const orders = [
      order({ transactions: [txn({ gateway: 'paypal' })] }),
      order({ transactions: [txn({ gateway: 'paypal' })] }),
      order({ transactions: [txn({ gateway: 'cod' })] }),
    ];
    const existing = cfg({ feeRules: [fee()] }); // a catch-all already covers everything
    const paypal = ruleCoverage(orders, existing, {
      fee: fee({ gateway: 'paypal', percent: '3.5' }),
    });
    expect(paypal.fees.candidateApplies).toBe(2);
    expect(paypal.fees.covered).toBe(3);
    // a rule that starts in the future is never chosen for these orders
    const future = ruleCoverage(orders, existing, { fee: fee({ effectiveFrom: '2027-01-01' }) });
    expect(future.fees.candidateApplies).toBe(0);
    // a rule for a gateway nobody used matches nothing
    const none = ruleCoverage(orders, existing, { fee: fee({ gateway: 'klarna' }) });
    expect(none.fees.candidateApplies).toBe(0);
    // a rule in another currency does not apply
    const eur = ruleCoverage(orders, existing, { fee: fee({ currency: 'EUR', gateway: null }) });
    expect(eur.fees.candidateApplies).toBe(0);
  });

  it('a candidate that only adds coverage turns unknown fees into covered ones', () => {
    const orders = [order({ transactions: [txn({ gateway: 'cod' })] })];
    const before = ruleCoverage(orders, cfg());
    const after = ruleCoverage(orders, cfg(), { fee: fee({ gateway: 'cod' }) });
    expect(before.fees.uncovered).toBe(1);
    expect(after.fees.uncovered).toBe(0);
    expect(after.fees.candidateApplies).toBe(1);
  });

  it('shipping: counts orders with and without a rule, and the data a rule would need', () => {
    const orders = [
      order(), // US, 400 g
      order({ shipCountry: null }), // no country
      order({ lines: [line({ variantShopifyId: 99 })] }), // item with no weight
      order({ lines: [line({ requiresShipping: false })] }), // nothing to ship
    ];
    const r = ruleCoverage(orders, cfg({ shippingRules: [ship({ countries: ['US'] })] }));
    expect(r.shipping).toMatchObject({
      orders: 3,
      covered: 2, // the two with a US destination
      uncovered: 1,
      missingCountry: 1,
      missingWeight: 1,
    });
  });

  it('shipping: a candidate band or country that matches no order is visible', () => {
    const orders = [order(), order()];
    const base = cfg({ shippingRules: [ship()] });
    expect(
      ruleCoverage(orders, base, { shipping: ship({ countries: ['US'], amount: '4.00' }) }).shipping
        .candidateApplies,
    ).toBe(2);
    expect(
      ruleCoverage(orders, base, { shipping: ship({ countries: ['DE'], amount: '4.00' }) }).shipping
        .candidateApplies,
    ).toBe(0);
    // orders weigh 400 g, so a 1 to 5 kg band matches none
    expect(
      ruleCoverage(orders, base, {
        shipping: ship({ countries: ['US'], weightMinGrams: 1000, weightMaxGrams: 5000 }),
      }).shipping.candidateApplies,
    ).toBe(0);
    expect(
      ruleCoverage(orders, base, {
        shipping: ship({ countries: ['US'], weightMinGrams: 0, weightMaxGrams: 1000 }),
      }).shipping.candidateApplies,
    ).toBe(2);
  });
});
