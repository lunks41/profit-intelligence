import { describe, expect, it } from 'vitest';
import { emptyConfig, line, order } from '../test/helpers.js';
import { businessDate } from './dates.js';
import { calculateOrder, exclusionReason } from './order.js';
import type { EngineConfig, EngineOrder, LedgerEntry } from './types.js';

const calc = (o: EngineOrder, cfg: EngineConfig = emptyConfig()) => calculateOrder(o, cfg);
const of = (entries: LedgerEntry[], component: string) =>
  entries.filter((e) => e.component === component);
const amt = (entries: LedgerEntry[], component: string) =>
  of(entries, component).reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0) / 100;
const costs = (...pairs: [number, string][]) => new Map<number, string>(pairs);

describe('which orders count (D2)', () => {
  const base = order();
  it.each([
    ['PAID', {}, null],
    ['PARTIALLY_REFUNDED', {}, null],
    ['REFUNDED', {}, null],
    ['PENDING', {}, 'awaiting_payment'],
    ['AUTHORIZED', {}, 'awaiting_payment'],
    ['PARTIALLY_PAID', {}, 'awaiting_payment'],
    ['VOIDED', {}, 'voided_or_expired'],
    ['EXPIRED', {}, 'voided_or_expired'],
    ['PENDING', { cancelledAt: new Date() }, 'cancelled_unpaid'],
    ['AUTHORIZED', { cancelledAt: new Date() }, 'cancelled_unpaid'],
    ['PAID', { isTest: true }, 'test_order'],
    ['SOMETHING_NEW', {}, 'awaiting_payment'],
  ])('%s %j -> %s', (status, extra, expected) => {
    expect(exclusionReason({ ...base, financialStatus: status, ...extra })).toBe(expected);
  });
});

describe('product cost: source, dates and history (D3, D8)', () => {
  const o = order({ lines: [line({ shopifyId: 1, variantShopifyId: 100, quantity: 2 })] });

  it('uses the merchant cost effective on the order date (Actual)', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([
        [
          100,
          [
            { effectiveFrom: '2026-01-01', amount: '10.00' },
            { effectiveFrom: '2026-04-01', amount: '12.00' },
          ],
        ],
      ]),
    });
    const r = calc(o, cfg);
    expect(of(r.entries, 'cogs')[0]).toMatchObject({
      amount: '-24.0000',
      status: 'actual',
      source: 'merchant cost effective 2026-04-01',
    });
  });

  it('an order before a cost change keeps the older cost (history is not rewritten)', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([
        [
          100,
          [
            { effectiveFrom: '2026-04-01', amount: '12.00' },
            { effectiveFrom: '2026-01-01', amount: '10.00' },
          ],
        ],
      ]), // unsorted on purpose
    });
    const early = calc({ ...o, processedAt: new Date('2026-03-31T12:00:00Z') }, cfg);
    expect(of(early.entries, 'cogs')[0]).toMatchObject({
      amount: '-20.0000',
      source: 'merchant cost effective 2026-01-01',
    });
    const onTheDay = calc({ ...o, processedAt: new Date('2026-04-01T12:00:00Z') }, cfg);
    expect(of(onTheDay.entries, 'cogs')[0]).toMatchObject({ amount: '-24.0000' });
  });

  it('falls back to Shopify cost (Estimated) when the merchant cost starts later', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([[100, [{ effectiveFrom: '2026-07-01', amount: '12.00' }]]]),
      shopifyCosts: costs([100, '9.00']),
    });
    expect(of(calc(o, cfg).entries, 'cogs')[0]).toMatchObject({
      amount: '-18.0000',
      status: 'estimated',
      source: 'shopify unit cost (current)',
    });
  });

  it('is Missing when there is no cost, and never treated as zero', () => {
    const e = of(calc(o).entries, 'cogs')[0]!;
    expect(e).toMatchObject({ amount: '0.0000', status: 'missing', basisAmount: '200.0000' });
  });

  it('a custom line without a variant has no cost (Missing)', () => {
    const e = of(calc(order({ lines: [line({ variantShopifyId: null })] })).entries, 'cogs')[0]!;
    expect(e).toMatchObject({ status: 'missing', source: 'custom line item (no variant)' });
  });

  it('a frozen cost is reused even if Shopify cost changed since (no silent rewrite)', () => {
    const cfg = emptyConfig({
      shopifyCosts: costs([100, '50.00']), // cost changed in Shopify after the first calculation
      frozenCosts: new Map([
        [1, { unitCost: '9.00', status: 'estimated', source: 'shopify unit cost (current)' }],
      ]),
    });
    expect(of(calc(o, cfg).entries, 'cogs')[0]).toMatchObject({
      amount: '-18.0000',
      status: 'estimated',
    });
  });

  it('a merchant cost beats a frozen Shopify estimate only if the caller drops the frozen value', () => {
    const merchant = new Map([[100, [{ effectiveFrom: '2026-01-01', amount: '8.00' }]]]);
    const frozen = emptyConfig({
      merchantCosts: merchant,
      frozenCosts: new Map([
        [1, { unitCost: '9.00', status: 'estimated' as const, source: 'old' }],
      ]),
    });
    expect(of(calc(o, frozen).entries, 'cogs')[0]!.amount).toBe('-18.0000');
    const recomputed = emptyConfig({ merchantCosts: merchant });
    expect(of(calc(o, recomputed).entries, 'cogs')[0]).toMatchObject({
      amount: '-16.0000',
      status: 'actual',
    });
  });

  it('merchant cost uses the shop-local business date (an evening order belongs to the local day)', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([
        [
          100,
          [
            { effectiveFrom: '2026-01-01', amount: '10.00' },
            { effectiveFrom: '2026-04-01', amount: '12.00' },
          ],
        ],
      ]),
    });
    // 2026-04-01 02:00 UTC is still 2026-03-31 22:00 in New York
    const r = calc({ ...o, processedAt: new Date('2026-04-01T02:00:00Z') }, cfg);
    expect(of(r.entries, 'cogs')[0]).toMatchObject({ amount: '-20.0000' });
  });
});

describe('refund effects on cost (spec section 5)', () => {
  const o = order({
    lines: [line({ shopifyId: 1, variantShopifyId: 100, quantity: 3 })],
    subtotalAmount: '300.00',
    totalAmount: '300.00',
    transactions: [],
  });
  const refund = (restockType: string | null) => ({
    shopifyId: 50,
    processedAt: new Date('2026-07-20T10:00:00Z'),
    totalAmount: '100.00',
    lines: [
      {
        shopifyId: 60,
        lineItemShopifyId: 1,
        quantity: 1,
        subtotalAmount: '100.00',
        taxAmount: '0.00',
        restockType,
      },
    ],
  });
  const cfg = emptyConfig({ shopifyCosts: costs([100, '40.00']) });

  it.each(['RETURN', 'CANCEL', 'LEGACY_RESTOCK'])(
    '%s brings the cost back on the refund date',
    (type) => {
      const r = calc({ ...o, refunds: [refund(type)] }, cfg);
      expect(of(r.entries, 'cogs_reversal')[0]).toMatchObject({
        amount: '40.0000',
        entryDate: '2026-07-20',
        status: 'estimated',
        refundShopifyId: 50,
      });
    },
  );

  it('NO_RESTOCK (or none) returns nothing: the goods are lost', () => {
    expect(
      of(calc({ ...o, refunds: [refund('NO_RESTOCK')] }, cfg).entries, 'cogs_reversal'),
    ).toHaveLength(0);
    expect(of(calc({ ...o, refunds: [refund(null)] }, cfg).entries, 'cogs_reversal')).toHaveLength(
      0,
    );
  });

  it('a restocked line with no known cost has nothing to reverse', () => {
    const r = calc({ ...o, refunds: [refund('RETURN')] });
    expect(of(r.entries, 'cogs_reversal')).toHaveLength(0);
  });

  it('a refund of 0.00 has no financial effect, even with line items (restock only)', () => {
    const r = calc({ ...o, refunds: [{ ...refund('RETURN'), totalAmount: '0.00' }] }, cfg);
    expect(of(r.entries, 'product_refund')).toHaveLength(0);
    expect(of(r.entries, 'cogs_reversal')).toHaveLength(0);
  });

  it('a shipping-only refund is the residual and reduces shipping revenue', () => {
    const shipped = order({
      shippingAmount: '9.99',
      totalAmount: '109.99',
      refunds: [
        {
          shopifyId: 51,
          processedAt: new Date('2026-07-01T00:00:00Z'),
          totalAmount: '9.99',
          lines: [],
        },
      ],
    });
    const r = calc(shipped);
    expect(amt(r.entries, 'shipping_refund')).toBe(-9.99);
    expect(amt(r.entries, 'product_refund')).toBe(0);
  });

  it('flags an order whose refund lines were only partly imported', () => {
    expect(calc(order({ refundLinesIncomplete: true })).flags).toContain('refund_lines_incomplete');
    expect(calc(order({})).flags).not.toContain('refund_lines_incomplete');
  });

  it('refund of a cancelled-but-paid order with no money moved is flagged', () => {
    const r = calc(order({ cancelledAt: new Date('2026-06-16T00:00:00Z') }));
    expect(r.flags).toContain('cancelled_without_refund');
  });
});

describe('tax-inclusive orders with discounts and shipping tax', () => {
  // price 118.00 incl 18.00 tax? use round numbers: line 110.00 gross incl 10% VAT (10.00), 10.00 order discount
  const o = order({
    taxesIncluded: true,
    lines: [line({ unitPriceAmount: '110.00', taxAmount: '9.09' })],
    subtotalAmount: '100.00', // 110.00 - 10.00 discount, tax included
    discountsAmount: '10.00',
    shippingAmount: '11.00', // includes 1.00 tax
    taxAmount: '10.09', // 9.09 on the product + 1.00 on shipping
    totalAmount: '111.00',
  });
  const r = calc(o);

  it('removes embedded tax: net product 90.91, gross 100.00, discount 9.09 (ex tax)', () => {
    expect(amt(r.entries, 'gross_sales')).toBe(100);
    expect(amt(r.entries, 'discounts')).toBe(-9.09);
    expect(amt(r.entries, 'gross_sales') + amt(r.entries, 'discounts')).toBe(90.91);
  });

  it('shipping revenue excludes the shipping tax; total tax is memo', () => {
    expect(amt(r.entries, 'shipping_revenue')).toBe(10);
    expect(amt(r.entries, 'tax_collected')).toBe(10.09);
  });

  it('ex-tax revenue + tax equals what the customer paid', () => {
    const exTax =
      amt(r.entries, 'gross_sales') +
      amt(r.entries, 'discounts') +
      amt(r.entries, 'shipping_revenue');
    expect(Math.round((exTax + amt(r.entries, 'tax_collected')) * 100)).toBe(11100);
  });

  it('a tax-inclusive refund removes the tax from the product amount', () => {
    const withRefund = calc({
      ...o,
      refunds: [
        {
          shopifyId: 1,
          processedAt: new Date('2026-07-01T00:00:00Z'),
          totalAmount: '100.00',
          lines: [
            {
              shopifyId: 1,
              lineItemShopifyId: 1,
              quantity: 1,
              subtotalAmount: '100.00',
              taxAmount: '9.09',
              restockType: null,
            },
          ],
        },
      ],
    });
    expect(amt(withRefund.entries, 'product_refund')).toBe(-90.91);
    expect(amt(withRefund.entries, 'tax_refunded')).toBe(-9.09);
  });
});

describe('gift cards are not revenue (D6)', () => {
  const o = order({
    lines: [
      line({ shopifyId: 1, variantShopifyId: 100 }),
      line({ shopifyId: 2, variantShopifyId: 200, unitPriceAmount: '50.00', isGiftCard: true }),
    ],
    subtotalAmount: '150.00',
    totalAmount: '150.00',
  });

  it('excludes gift card lines from sales and from cost', () => {
    const r = calc(o, emptyConfig({ shopifyCosts: costs([100, '40.00'], [200, '0.00']) }));
    expect(amt(r.entries, 'gross_sales')).toBe(100);
    expect(of(r.entries, 'cogs')).toHaveLength(1);
  });

  it('shares an order-level discount proportionally with the gift card line', () => {
    const discounted = {
      ...o,
      subtotalAmount: '135.00',
      discountsAmount: '15.00',
      totalAmount: '135.00',
    };
    const r = calc(discounted, emptyConfig());
    expect(amt(r.entries, 'discounts')).toBe(-10); // 15 x 100/150
  });

  it('a refund of a gift card line is not a sales refund', () => {
    const r = calc({
      ...o,
      refunds: [
        {
          shopifyId: 1,
          processedAt: new Date('2026-07-01T00:00:00Z'),
          totalAmount: '50.00',
          lines: [
            {
              shopifyId: 1,
              lineItemShopifyId: 2,
              quantity: 1,
              subtotalAmount: '50.00',
              taxAmount: '0.00',
              restockType: null,
            },
          ],
        },
      ],
    });
    expect(amt(r.entries, 'product_refund')).toBe(0);
  });
});

describe('payment fees (D4, spec section 7)', () => {
  const rule = {
    gateway: null,
    percent: '2.9',
    fixedAmount: '0.30',
    currency: 'USD',
    effectiveFrom: '2026-01-01',
  };

  it('uses the provider-reported fee as Actual', () => {
    const o = order({
      transactions: [
        {
          shopifyId: 1,
          kind: 'SALE',
          status: 'SUCCESS',
          gateway: 'shopify_payments',
          amount: '100.00',
          feeAmount: '3.20',
        },
      ],
    });
    expect(of(calc(o, emptyConfig({ feeRules: [rule] })).entries, 'payment_fees')[0]).toMatchObject(
      { amount: '-3.2000', status: 'actual' },
    );
  });

  it('estimates from a rule, rounded once (100.00 x 2.9% + 0.30 = 3.20)', () => {
    expect(
      of(calc(order(), emptyConfig({ feeRules: [rule] })).entries, 'payment_fees')[0],
    ).toMatchObject({ amount: '-3.2000', status: 'estimated' });
  });

  it('is Missing without data or a rule, never zero', () => {
    expect(of(calc(order()).entries, 'payment_fees')[0]).toMatchObject({
      amount: '0.0000',
      status: 'missing',
    });
  });

  it('a gateway-specific rule beats a catch-all; a later start date wins; future rules are ignored', () => {
    const rules = [
      rule,
      { ...rule, gateway: 'stripe', percent: '1.5', fixedAmount: '0.00' },
      {
        ...rule,
        gateway: 'stripe',
        percent: '2.0',
        fixedAmount: '0.00',
        effectiveFrom: '2026-06-01',
      },
      {
        ...rule,
        gateway: 'stripe',
        percent: '9.0',
        fixedAmount: '0.00',
        effectiveFrom: '2026-12-01',
      },
    ];
    expect(
      of(calc(order(), emptyConfig({ feeRules: rules })).entries, 'payment_fees')[0]!.amount,
    ).toBe('-2.0000');
  });

  it('a rule in another currency does not apply (Missing)', () => {
    expect(
      of(
        calc(order(), emptyConfig({ feeRules: [{ ...rule, currency: 'EUR' }] })).entries,
        'payment_fees',
      )[0]!.status,
    ).toBe('missing');
  });

  it('only successful sales and captures count; an authorization alone is not a payment', () => {
    const o = order({
      transactions: [
        {
          shopifyId: 1,
          kind: 'AUTHORIZATION',
          status: 'SUCCESS',
          gateway: 'stripe',
          amount: '100.00',
          feeAmount: null,
        },
        {
          shopifyId: 2,
          kind: 'CAPTURE',
          status: 'SUCCESS',
          gateway: 'stripe',
          amount: '100.00',
          feeAmount: null,
        },
        {
          shopifyId: 3,
          kind: 'SALE',
          status: 'FAILURE',
          gateway: 'stripe',
          amount: '100.00',
          feeAmount: null,
        },
      ],
    });
    expect(of(calc(o, emptyConfig({ feeRules: [rule] })).entries, 'payment_fees')).toHaveLength(1);
  });

  it('a zero-total order needs no fee (not applicable); a paid order without any payment record is Missing', () => {
    expect(
      of(calc(order({ totalAmount: '0.00', transactions: [] })).entries, 'payment_fees')[0]!.status,
    ).toBe('not_applicable');
    expect(of(calc(order({ transactions: [] })).entries, 'payment_fees')[0]).toMatchObject({
      status: 'missing',
      source: 'no payment transaction found',
    });
  });

  it('refunds do not return the fee', () => {
    const o = order({
      refunds: [
        {
          shopifyId: 1,
          processedAt: new Date('2026-07-01T00:00:00Z'),
          totalAmount: '100.00',
          lines: [
            {
              shopifyId: 1,
              lineItemShopifyId: 1,
              quantity: 1,
              subtotalAmount: '100.00',
              taxAmount: '0.00',
              restockType: null,
            },
          ],
        },
      ],
    });
    expect(amt(calc(o, emptyConfig({ feeRules: [rule] })).entries, 'payment_fees')).toBe(-3.2);
  });
});

describe('carrier shipping cost (spec section 8)', () => {
  const flat = {
    mode: 'flat' as const,
    amount: '8.00',
    percent: null,
    effectiveFrom: '2026-01-01',
  };

  it('flat rule: costs money even when shipping was free for the customer', () => {
    expect(
      of(
        calc(order({ shippingAmount: '0.00' }), emptyConfig({ shippingRules: [flat] })).entries,
        'shipping_cost',
      )[0],
    ).toMatchObject({ amount: '-8.0000', status: 'estimated' });
  });

  it('percent rule applies to the shipping charged to the customer', () => {
    const percent = {
      mode: 'percent_of_shipping_charged' as const,
      amount: null,
      percent: '80',
      effectiveFrom: '2026-01-01',
    };
    expect(
      of(
        calc(
          order({ shippingAmount: '10.00', totalAmount: '110.00' }),
          emptyConfig({ shippingRules: [percent] }),
        ).entries,
        'shipping_cost',
      )[0]!.amount,
    ).toBe('-8.0000');
  });

  it('an explicit rule of zero is Actual by declaration', () => {
    const zero = { ...flat, amount: '0.00' };
    expect(
      of(calc(order(), emptyConfig({ shippingRules: [zero] })).entries, 'shipping_cost')[0],
    ).toMatchObject({ amount: '0.0000', status: 'actual' });
  });

  it('is Missing without a rule and not applicable when nothing ships', () => {
    expect(of(calc(order()).entries, 'shipping_cost')[0]!.status).toBe('missing');
    expect(
      of(calc(order({ lines: [line({ requiresShipping: false })] })).entries, 'shipping_cost')[0]!
        .status,
    ).toBe('not_applicable');
  });

  it('picks a country and weight rule from the variant weights on the order', () => {
    const rules = [
      flat,
      {
        ...flat,
        amount: '5.00',
        countries: ['US'],
        weightMinGrams: 0,
        weightMaxGrams: 1000,
      },
    ];
    const o = order({
      shipCountry: 'US',
      lines: [line({ variantShopifyId: 100, quantity: 2 })],
    });
    expect(
      of(
        calc(o, emptyConfig({ shippingRules: rules, variantWeights: new Map([[100, 400]]) }))
          .entries,
        'shipping_cost',
      )[0]!.amount,
    ).toBe('-5.0000'); // 800g, inside the US band
    expect(
      of(
        calc(o, emptyConfig({ shippingRules: rules, variantWeights: new Map([[100, 600]]) }))
          .entries,
        'shipping_cost',
      )[0]!.amount,
    ).toBe('-8.0000'); // 1200g, above the band, so the catch-all
  });

  it('uses the rule in force on the order date', () => {
    const rules = [flat, { ...flat, amount: '12.00', effectiveFrom: '2026-06-01' }];
    expect(
      of(calc(order(), emptyConfig({ shippingRules: rules })).entries, 'shipping_cost')[0]!.amount,
    ).toBe('-12.0000');
    expect(
      of(
        calc(
          order({ processedAt: new Date('2026-05-01T12:00:00Z') }),
          emptyConfig({ shippingRules: rules }),
        ).entries,
        'shipping_cost',
      )[0]!.amount,
    ).toBe('-8.0000');
  });
});

describe('rounding and currencies', () => {
  it('rounds each entry once to the currency minor unit (JPY has no decimals)', () => {
    const o = order({
      currency: 'JPY',
      lines: [line({ unitPriceAmount: '1000', quantity: 3 })],
      subtotalAmount: '3000',
      totalAmount: '3000',
      transactions: [],
    });
    const r = calc(o, emptyConfig({ shopifyCosts: costs([100, '333.5']) }));
    expect(of(r.entries, 'cogs')[0]!.amount).toBe('-1001.0000'); // 3 x 333.5 = 1000.5 -> half up
    expect(of(r.entries, 'gross_sales')[0]!.amount).toBe('3000.0000');
  });

  it('never produces negative zero', () => {
    const r = calc(order({ transactions: [] }));
    for (const e of r.entries) expect(e.amount).not.toMatch(/^-0\.0+$/);
  });

  it('flags inconsistent discount data instead of guessing', () => {
    const r = calc(order({ subtotalAmount: '120.00', totalAmount: '120.00' })); // subtotal above the lines
    expect(r.flags).toContain('discount_inconsistent');
  });
});

describe('business date', () => {
  it('uses the shop time zone, not UTC', () => {
    const late = new Date('2026-04-01T02:00:00Z');
    expect(businessDate(late, 'America/New_York')).toBe('2026-03-31');
    expect(businessDate(late, 'Asia/Dubai')).toBe('2026-04-01');
    expect(businessDate(late, 'UTC')).toBe('2026-04-01');
  });

  it('ledger entry dates follow the shop time zone', () => {
    const r = calc(order({ processedAt: new Date('2026-04-01T02:00:00Z') }));
    expect(r.entries.every((e) => e.entryDate === '2026-03-31')).toBe(true);
  });
});

describe('regressions found by tests', () => {
  it('a zero-money refund (restock only) is not treated as a positive refund', () => {
    const o = order({
      refunds: [
        {
          shopifyId: 1,
          processedAt: new Date('2026-07-01T00:00:00Z'),
          totalAmount: '0.00',
          lines: [
            {
              shopifyId: 1,
              lineItemShopifyId: 1,
              quantity: 1,
              subtotalAmount: '100.00',
              taxAmount: '0.00',
              restockType: 'RETURN',
            },
          ],
        },
      ],
    });
    const r = calc(o, emptyConfig({ shopifyCosts: costs([100, '40.00']) }));
    expect(of(r.entries, 'product_refund')).toHaveLength(0);
    expect(of(r.entries, 'cogs_reversal')).toHaveLength(0);
    expect(r.flags).toEqual([]); // not cancelled, so nothing to flag
  });

  it('a tax-inclusive order with a 100% discount does not divide by zero', () => {
    const o = order({
      taxesIncluded: true,
      lines: [line({ unitPriceAmount: '110.00', taxAmount: '0.00' })],
      subtotalAmount: '0.00',
      discountsAmount: '110.00',
      totalAmount: '0.00',
      transactions: [],
    });
    const r = calc(o);
    for (const e of r.entries) expect(e.amount).toMatch(/^-?\d+\.\d{4}$/);
    expect(amt(r.entries, 'gross_sales')).toBe(110);
    expect(amt(r.entries, 'discounts')).toBe(-110);
  });
});
