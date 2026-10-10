import { describe, expect, it } from 'vitest';
import type { OverviewResponse, ProfitSummary } from '@pi/contracts';
import { whatChanged } from './drivers';

/** revenue 1000 = sales 1100 - discounts 50 - refunds 50; costs 400 + 30 + 20 (+ ads 50). */
const base = {
  grossSales: '1100.0000',
  discounts: '50.0000',
  productRefunds: '50.0000',
  revenue: '1000.0000',
  cogs: '400.0000',
  paymentFees: '30.0000',
  shippingCost: '20.0000',
  adSpend: null,
  contributionBeforeAds: '550.0000',
  contributionProfit: '550.0000',
  refundRate: '0.0455',
  missingCostShare: '0.0000',
  orders: 100,
  partial: false,
  statuses: { cogs: 'confirmed', paymentFees: 'confirmed', shippingCost: 'confirmed' },
} as unknown as ProfitSummary;
const make = (over: Record<string, unknown>): ProfitSummary =>
  ({ ...base, ...over }) as unknown as ProfitSummary;

const input = (
  summary: ProfitSummary,
  previous: ProfitSummary,
  extra: Partial<Pick<OverviewResponse, 'fees' | 'deltas'>> = {},
) => ({
  summary,
  previous,
  currency: { code: 'USD' },
  previousPeriod: { from: '2026-08-11', to: '2026-09-09' },
  fees: { actual: '30.0000', estimated: '0.0000', estimatedShare: '0.0000' },
  deltas: {
    contributionProfit: null,
    basis: 'contribution',
    basisNote: null,
  } as unknown as OverviewResponse['deltas'],
  ...extra,
});

describe('what changed', () => {
  it('has nothing to say without orders in both periods', () => {
    expect(whatChanged(input(make({ orders: 0 }), base))).toBeNull();
    expect(whatChanged(input(base, make({ orders: 0 })))).toBeNull();
  });

  it('reports no change as unchanged', () => {
    const w = whatChanged(input(base, base))!;
    expect(w.direction).toBe('flat');
    expect(w.drivers).toEqual([]);
    expect(w.headline).toContain('unchanged');
  });

  it('names refunds as the driver when refunds rise, with the refund rate', () => {
    const now = make({
      productRefunds: '250.0000',
      revenue: '800.0000',
      contributionBeforeAds: '350.0000',
      contributionProfit: '350.0000',
      refundRate: '0.2273',
    });
    const w = whatChanged(input(now, base))!;
    expect(w.direction).toBe('down');
    expect(w.change).toBe(-200);
    expect(w.headline).toContain('fell by $200.00');
    expect(w.drivers).toHaveLength(1);
    expect(w.drivers[0]).toMatchObject({ key: 'refunds', effect: -200 });
    expect(w.drivers[0]!.note).toContain('Refund rate went from 4.5% to 22.7%');
  });

  it('lists the biggest movers first and leaves out the small ones', () => {
    const now = make({
      grossSales: '1500.0000',
      discounts: '100.0000',
      productRefunds: '70.0000',
      revenue: '1330.0000',
      cogs: '600.0000',
      paymentFees: '45.0000',
      shippingCost: '35.0000',
      contributionBeforeAds: '650.0000',
      contributionProfit: '650.0000',
      orders: 140,
    });
    const w = whatChanged(input(now, base))!;
    expect(w.change).toBe(100);
    // sales +400, product cost -200, discounts -50; refunds (-20), fees (-15) and shipping (-15)
    // are under 5% of the total movement
    expect(w.drivers.map((d) => [d.key, d.effect])).toEqual([
      ['sales', 400],
      ['cogs', -200],
      ['discounts', -50],
    ]);
  });

  it('flags missing product costs that appeared, and says the change is a data effect', () => {
    const now = make({
      cogs: '200.0000',
      contributionBeforeAds: '750.0000',
      contributionProfit: '750.0000',
      missingCostShare: '0.2500',
      partial: true,
    });
    const w = whatChanged(input(now, base))!;
    expect(w.drivers[0]).toMatchObject({ key: 'cogs', effect: 200 });
    expect(w.drivers[0]!.note).toContain('Missing product costs went from 0.0% to 25.0%');
    expect(w.caveats.join(' ')).toContain('missing data, not performance');
  });

  it('explains a shipping change and marks estimated shipping', () => {
    const now = make({
      shippingCost: '120.0000',
      contributionBeforeAds: '450.0000',
      contributionProfit: '450.0000',
      statuses: { cogs: 'confirmed', paymentFees: 'confirmed', shippingCost: 'estimated' },
    });
    const w = whatChanged(input(now, base))!;
    expect(w.drivers[0]).toMatchObject({ key: 'shipping', effect: -100 });
    expect(w.drivers[0]!.note).toBe('Shipping cost is estimated in this period');
  });

  it('says when payment fees are estimates', () => {
    const w = whatChanged(
      input(
        make({
          paymentFees: '80.0000',
          contributionBeforeAds: '500.0000',
          contributionProfit: '500.0000',
        }),
        base,
        { fees: { actual: '0.0000', estimated: '80.0000', estimatedShare: '1.0000' } },
      ),
    )!;
    expect(w.drivers[0]).toMatchObject({ key: 'fees', effect: -50 });
    expect(w.drivers[0]!.note).toContain('100.0% of this period');
    expect(w.caveats.join(' ')).toContain('estimates from your fee rule');
  });

  it('leaves advertising out unless both periods have it', () => {
    const now = make({
      adSpend: '200.0000',
      contributionProfit: '350.0000',
    });
    const w = whatChanged(input(now, base))!;
    expect(w.drivers.find((d) => d.key === 'advertising')).toBeUndefined();
    const both = whatChanged(
      input(now, make({ adSpend: '50.0000', contributionProfit: '500.0000' })),
    )!;
    expect(both.drivers.find((d) => d.key === 'advertising')).toMatchObject({
      key: 'advertising',
      effect: -150,
    });
  });

  it('uses the before-advertising profit when the comparison is on that basis', () => {
    const now = make({ adSpend: '200.0000', contributionProfit: '350.0000' });
    const w = whatChanged(
      input(now, base, {
        deltas: {
          contributionProfit: 0,
          basis: 'before_advertising',
          basisNote: 'Advertising data exists in only one of the two periods.',
        } as unknown as OverviewResponse['deltas'],
      }),
    )!;
    expect(w.direction).toBe('flat');
    expect(w.headline).toContain('Profit before advertising is unchanged');
    expect(w.basisNote).toContain('only one of the two periods');
  });
});
