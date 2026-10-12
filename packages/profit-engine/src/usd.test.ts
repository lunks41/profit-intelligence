import { describe, expect, it } from 'vitest';
import { calculateOrder } from './order.js';
import { orderToUsd, shopifyCostsToUsd, usdRateProvider } from './usd.js';
import type { EngineConfig, EngineOrder } from './types.js';

// units of the quote per 1 EUR, as the European Central Bank publishes them
const RATES = [
  { date: '2026-09-10', quote: 'USD', rate: '1.1000000000' },
  { date: '2026-09-11', quote: 'USD', rate: '1.2000000000' },
  { date: '2026-09-14', quote: 'USD', rate: '1.0000000000' },
  { date: '2026-09-10', quote: 'GBP', rate: '0.8000000000' },
];
const provider = usdRateProvider(RATES);

const order = (o: Partial<EngineOrder> = {}): EngineOrder => ({
  shopifyId: 1,
  processedAt: new Date('2026-09-10T12:00:00Z'),
  isTest: false,
  financialStatus: 'PAID',
  cancelledAt: null,
  taxesIncluded: false,
  currency: 'EUR',
  subtotalAmount: '100.0000',
  discountsAmount: '10.0000',
  shippingAmount: '5.0000',
  taxAmount: '0.0000',
  totalAmount: '95.0000',
  lines: [
    {
      shopifyId: 11,
      variantShopifyId: 7,
      productShopifyId: 70,
      quantity: 2,
      unitPriceAmount: '50.0000',
      taxAmount: '0.0000',
      requiresShipping: true,
      isGiftCard: false,
    },
  ],
  refunds: [
    {
      shopifyId: 21,
      processedAt: new Date('2026-09-11T09:00:00Z'),
      totalAmount: '20.0000',
      lines: [
        {
          shopifyId: 31,
          lineItemShopifyId: 11,
          quantity: 1,
          subtotalAmount: '20.0000',
          taxAmount: '0.0000',
          restockType: 'return',
        },
      ],
    },
  ],
  transactions: [
    {
      shopifyId: 41,
      kind: 'SALE',
      status: 'SUCCESS',
      gateway: 'stripe',
      amount: '95.0000',
      feeAmount: '3.0000',
    },
    {
      shopifyId: 42,
      kind: 'SALE',
      status: 'SUCCESS',
      gateway: 'cod',
      amount: '0.0000',
      feeAmount: null,
    },
  ],
  ...o,
});

describe('converting an order to USD', () => {
  it('a USD order is returned as it is', () => {
    const o = order({ currency: 'USD' });
    const r = orderToUsd(o, provider, 'UTC');
    expect(r).toEqual({ ok: true, order: o, from: null, estimated: false });
  });

  it('converts each amount with the rate of its own date: the order at the order date, a refund at its refund date', () => {
    const r = orderToUsd(order(), provider, 'UTC');
    if (!r.ok) throw new Error(r.reason);
    expect(r.from).toBe('EUR');
    expect(r.estimated).toBe(false);
    const o = r.order;
    expect(o.currency).toBe('USD');
    // 10 September: 1 EUR = 1.10 USD
    expect(o.subtotalAmount).toBe('110.0000');
    expect(o.discountsAmount).toBe('11.0000');
    expect(o.shippingAmount).toBe('5.5000');
    expect(o.totalAmount).toBe('104.5000');
    expect(o.lines[0]!.unitPriceAmount).toBe('55.0000');
    expect(o.transactions[0]).toMatchObject({ amount: '104.5000', feeAmount: '3.3000' });
    // a fee the provider did not report stays unknown; it is never turned into zero
    expect(o.transactions[1]!.feeAmount).toBeNull();
    // 11 September: 1 EUR = 1.20 USD
    expect(o.refunds[0]!.totalAmount).toBe('24.0000');
    expect(o.refunds[0]!.lines[0]!.subtotalAmount).toBe('24.0000');
  });

  it('keeps the original order untouched', () => {
    const o = order();
    orderToUsd(o, provider, 'UTC');
    expect(o.currency).toBe('EUR');
    expect(o.subtotalAmount).toBe('100.0000');
  });

  it('crosses through the euro for a pair that is not EUR', () => {
    // 10 September: 1 EUR = 0.80 GBP = 1.10 USD, so 1 GBP = 1.375 USD
    const r = orderToUsd(order({ currency: 'GBP', subtotalAmount: '80.0000' }), provider, 'UTC');
    if (!r.ok) throw new Error(r.reason);
    expect(r.order.subtotalAmount).toBe('110.0000');
  });

  it('the AED is converted at the fixed peg, exactly, on any date', () => {
    const r = orderToUsd(
      order({ currency: 'AED', processedAt: new Date('2030-01-01T10:00:00Z'), refunds: [] }),
      provider,
      'Asia/Dubai',
    );
    if (!r.ok) throw new Error(r.reason);
    // 367.25 AED / 3.6725 = 100 USD
    expect(
      orderToUsd(
        order({ currency: 'AED', subtotalAmount: '367.2500', refunds: [] }),
        provider,
        'UTC',
      ),
    ).toMatchObject({ ok: true, estimated: false });
    const exact = orderToUsd(
      order({ currency: 'AED', subtotalAmount: '367.2500', refunds: [] }),
      provider,
      'UTC',
    );
    if (!exact.ok) throw new Error(exact.reason);
    expect(exact.order.subtotalAmount).toBe('100.0000');
    expect(r.ok).toBe(true);
  });

  it('a weekend uses the latest earlier rate and is marked as an estimate', () => {
    // 13 September has no published rate: the 11th is used
    const r = orderToUsd(
      order({ processedAt: new Date('2026-09-13T12:00:00Z'), refunds: [] }),
      provider,
      'UTC',
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.estimated).toBe(true);
    expect(r.order.subtotalAmount).toBe('120.0000');
  });

  it('with no rate it fails, and never assumes 1 to 1', () => {
    const r = orderToUsd(order({ processedAt: new Date('2026-08-01T12:00:00Z') }), provider, 'UTC');
    expect(r).toEqual({ ok: false, reason: 'No EUR to USD rate for 2026-08-01' });
    const noRefundRate = orderToUsd(
      order({
        refunds: [{ ...order().refunds[0]!, processedAt: new Date('2026-09-25T09:00:00Z') }],
      }),
      provider,
      'UTC',
    );
    expect(noRefundRate.ok).toBe(false);
    expect(orderToUsd(order({ currency: 'JPY' }), provider, 'UTC').ok).toBe(false);
  });

  it('the day is the business day in the shop time zone, not UTC', () => {
    // 23:30 UTC on the 10th is already the 11th in Dubai
    const o = order({ processedAt: new Date('2026-09-10T23:30:00Z'), refunds: [] });
    const dubai = orderToUsd(o, provider, 'Asia/Dubai');
    const utc = orderToUsd(o, provider, 'UTC');
    if (!dubai.ok || !utc.ok) throw new Error('rates missing');
    expect(utc.order.subtotalAmount).toBe('110.0000');
    expect(dubai.order.subtotalAmount).toBe('120.0000');
  });

  it('the profit of a converted order equals the profit worked out from its USD amounts', () => {
    const cfg: EngineConfig = {
      timezone: 'UTC',
      merchantCosts: new Map([[7, [{ effectiveFrom: '2026-01-01', amount: '20.00' }]]]), // USD, entered by the merchant
      shopifyCosts: new Map(),
      feeRules: [],
      shippingRules: [],
    } as unknown as EngineConfig;
    const r = orderToUsd(order({ refunds: [] }), provider, 'UTC');
    if (!r.ok) throw new Error(r.reason);
    const calc = calculateOrder(r.order, cfg);
    expect(calc.recognized).toBe(true);
    const by = (c: string) => calc.entries.filter((e) => e.component === c).map((e) => e.amount);
    expect(by('gross_sales')).toEqual(['110.0000']);
    // two units at the merchant's USD cost of 20.00
    expect(by('cogs')).toEqual(['-40.0000']);
  });
});

describe('Shopify unit costs in USD', () => {
  const costs = new Map([
    [7, '10.0000'],
    [8, '2.5000'],
  ]);

  it('converts with the rate of the order date', () => {
    expect(shopifyCostsToUsd(costs, 'EUR', '2026-09-10', provider)).toEqual(
      new Map([
        [7, '11.0000'],
        [8, '2.7500'],
      ]),
    );
  });

  it('USD costs are copied, and a day with no rate gives null', () => {
    expect(shopifyCostsToUsd(costs, 'USD', '2026-09-10', provider)).toEqual(costs);
    expect(shopifyCostsToUsd(costs, 'EUR', '2026-01-01', provider)).toBeNull();
  });
});
