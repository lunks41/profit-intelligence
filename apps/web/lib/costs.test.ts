import { describe, expect, it } from 'vitest';
import type { OverviewResponse, ProfitSummary } from '@pi/contracts';
import { costBreakdown, feeDetail } from './costs';
import { sparkSeries } from './series';

/** The worked example from docs/finance/figures.md: costs 380 + 30 + 25 + 35 = 470. */
const base = {
  revenue: '870.0000',
  cogs: '380.0000',
  paymentFees: '30.0000',
  shippingCost: '25.0000',
  adSpend: '35.0000',
  contributionProfit: '400.0000',
  totalCosts: '470.0000',
  operatingExpenses: '100.0000',
  statuses: {
    cogs: 'confirmed',
    paymentFees: 'confirmed',
    shippingCost: 'confirmed',
    advertising: 'confirmed',
    operatingExpenses: 'confirmed',
    estimatedNetProfit: 'confirmed',
  },
  missingShares: { cogs: '0.0000', paymentFees: '0.0000', shippingCost: '0.0000' },
} as unknown as ProfitSummary;
const with_ = (status: Record<string, string>, top: Record<string, unknown> = {}) =>
  ({ ...base, ...top, statuses: { ...base.statuses, ...status } }) as unknown as ProfitSummary;
const row = (b: ReturnType<typeof costBreakdown>, key: string) =>
  b.rows.find((r) => r.key === key)!;

describe('the costs breakdown', () => {
  const b = costBreakdown(base, 'USD');

  it('the four costs add up to the total costs, to the cent', () => {
    const sum = b.rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
    expect(sum).toBe(Math.round(Number(b.total) * 100));
    expect(b.total).toBe('470.0000');
  });

  it('the shares of the known costs add up to one, largest first', () => {
    expect(b.rows.map((r) => r.key)).toEqual(['cogs', 'ads', 'fees', 'shippingCost']);
    expect(b.rows.reduce((a, r) => a + (r.share ?? 0), 0)).toBeCloseTo(1, 10);
    expect(row(b, 'cogs').share).toBeCloseTo(380 / 470, 10);
  });

  it('operating expenses are shown apart from the costs, not in their total', () => {
    expect(b.operatingExpenses).toMatchObject({ amount: '100.0000', standing: 'confirmed' });
  });

  it('a cost unknown on every order is a word, goes last and is left out of the shares', () => {
    const r = costBreakdown(
      with_(
        { shippingCost: 'missing' },
        {
          shippingCost: '0.0000',
          missingShares: { ...base.missingShares, shippingCost: '1.0000' },
          totalCosts: '445.0000',
        },
      ),
      'USD',
    );
    const ship = row(r, 'shippingCost');
    expect(ship).toMatchObject({ amount: null, text: 'Missing', standing: 'missing', share: null });
    expect(r.rows.at(-1)!.key).toBe('shippingCost');
    expect(r.rows.reduce((a, x) => a + (x.share ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it('a cost missing on some orders keeps its known amount and is marked incomplete', () => {
    const r = costBreakdown(
      with_({ cogs: 'missing' }, { missingShares: { ...base.missingShares, cogs: '0.3000' } }),
      'USD',
    );
    expect(row(r, 'cogs')).toMatchObject({ amount: '380.0000', standing: 'incomplete' });
  });

  it('advertising not set up, or without spend, is a word', () => {
    const none = costBreakdown(with_({ advertising: 'not_configured' }, { adSpend: null }), 'USD');
    expect(row(none, 'ads')).toMatchObject({
      amount: null,
      text: 'Not set up',
      standing: 'not_set_up',
    });
    const nospend = costBreakdown(with_({ advertising: 'missing' }, { adSpend: null }), 'USD');
    expect(row(nospend, 'ads')).toMatchObject({
      amount: null,
      text: 'No spend',
      standing: 'no_data',
    });
  });

  it('operating expenses not set up say so', () => {
    const r = costBreakdown(
      with_({ operatingExpenses: 'not_configured' }, { operatingExpenses: null }),
      'USD',
    );
    expect(r.operatingExpenses).toEqual({
      amount: null,
      text: 'Not set up',
      standing: 'not_set_up',
    });
  });

  it('estimates are marked as estimates', () => {
    expect(row(costBreakdown(with_({ paymentFees: 'estimated' }), 'USD'), 'fees').standing).toBe(
      'estimated',
    );
  });
});

describe('the small lines on the cards', () => {
  const trend = [
    {
      date: '2026-09-01',
      to: '2026-09-01',
      revenue: '100.0000',
      costs: '60.0000',
      contributionProfit: '40.0000',
      orders: 2,
    },
    {
      date: '2026-09-02',
      to: '2026-09-02',
      revenue: '0.0000',
      costs: '5.0000',
      contributionProfit: '-5.0000',
      orders: 0,
    },
    {
      date: '2026-09-03',
      to: '2026-09-03',
      revenue: '200.0000',
      costs: '120.0000',
      contributionProfit: '80.0000',
      orders: 3,
    },
  ] as OverviewResponse['trend'];

  it('takes revenue, costs and profit from the same points as the chart', () => {
    const s = sparkSeries(trend);
    expect(s.revenue).toEqual([100, 0, 200]);
    expect(s.costs).toEqual([60, 5, 120]);
    expect(s.profit).toEqual([40, -5, 80]);
  });

  it('margin is profit over revenue, and a gap where there was no revenue', () => {
    expect(sparkSeries(trend).margin).toEqual([0.4, null, 0.4]);
  });

  it('is empty for no points', () => {
    expect(sparkSeries([])).toEqual({ revenue: [], costs: [], profit: [], margin: [] });
  });
});

describe('estimated payment fees', () => {
  const fees = (actual: string, estimated: string) => ({
    actual,
    estimated,
    estimatedShare: '1.0000',
  });
  it('says nothing when no fee is estimated', () => {
    expect(feeDetail(fees('30.0000', '0.0000'), 'USD')).toBeNull();
    expect(feeDetail(undefined, 'USD')).toBeNull();
  });
  it('says all fees are estimated when Shopify reported none', () => {
    expect(feeDetail(fees('0.0000', '30.0000'), 'USD')).toContain('All estimated');
  });
  it('splits reported and estimated fees', () => {
    expect(feeDetail(fees('20.0000', '10.0000'), 'USD')).toBe(
      'Shopify reported $20.00; $10.00 is estimated from your fee rule.',
    );
  });
  it('shows the split under the fees row of the costs breakdown', () => {
    const b = costBreakdown(base, 'USD', fees('20.0000', '10.0000'));
    expect(b.rows.find((r) => r.key === 'fees')!.detail).toContain('estimated');
    expect(b.rows.find((r) => r.key === 'cogs')!.detail).toBeNull();
  });
});
