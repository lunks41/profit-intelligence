import { describe, expect, it } from 'vitest';
import type { ProfitSummary } from '@pi/contracts';
import { breakdownRows, negate } from './breakdown';

/** The worked example from docs/finance/figures.md. */
const base = {
  grossSales: '1000.0000',
  discounts: '100.0000',
  productRefunds: '50.0000',
  netSales: '850.0000',
  shippingRevenue: '20.0000',
  revenue: '870.0000',
  cogs: '380.0000',
  paymentFees: '30.0000',
  shippingCost: '25.0000',
  adSpend: '35.0000',
  contributionBeforeAds: '435.0000',
  contributionProfit: '400.0000',
  operatingExpenses: '100.0000',
  estimatedNetProfit: '300.0000',
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

const cents = (s: string) => Math.round(Number(s) * 100);
const by = (rows: ReturnType<typeof breakdownRows>, key: string) =>
  rows.find((r) => r.key === key)!;
const withStatus = (over: Record<string, unknown>, top: Partial<ProfitSummary> = {}) =>
  ({
    ...base,
    ...top,
    statuses: { ...base.statuses, ...over },
  }) as ProfitSummary;

describe('negate', () => {
  it('flips the sign of an exact decimal string and leaves zero unsigned', () => {
    expect(negate('12.3400')).toBe('-12.3400');
    expect(negate('-5.0000')).toBe('5.0000');
    expect(negate('0.0000')).toBe('0.0000');
    expect(negate('-0.0000')).toBe('0.0000');
  });
});

describe('the profit breakdown', () => {
  const rows = breakdownRows(base, 'USD');

  it('the lines add up to each total, in whole cents', () => {
    const amt = (k: string) => cents(by(rows, k).amount!);
    expect(amt('gross') + amt('discounts') + amt('refunds') + amt('shipping')).toBe(amt('revenue'));
    expect(amt('revenue') + amt('cogs') + amt('fees') + amt('shippingCost') + amt('ads')).toBe(
      amt('contribution'),
    );
    expect(amt('contribution') + amt('opex')).toBe(amt('net'));
    expect(by(rows, 'revenue').amount).toBe('870.0000');
    expect(by(rows, 'contribution').amount).toBe('400.0000');
    expect(by(rows, 'net').amount).toBe('300.0000');
  });

  it('shows discounts and refunds separately, and costs as negatives', () => {
    expect(by(rows, 'discounts').amount).toBe('-100.0000');
    expect(by(rows, 'refunds').amount).toBe('-50.0000');
    expect(by(rows, 'cogs').text).toBe('-$380.00');
  });

  it('everything confirmed means every line is confirmed', () => {
    expect(new Set(rows.map((r) => r.standing))).toEqual(new Set(['confirmed']));
  });

  it('a cost unknown for every order is the word Missing, never $0.00', () => {
    const r = breakdownRows(
      withStatus(
        { paymentFees: 'missing' },
        { paymentFees: '0.0000', missingShares: { ...base.missingShares, paymentFees: '1.0000' } },
      ),
      'USD',
    );
    expect(by(r, 'fees')).toMatchObject({ amount: null, text: 'Missing', standing: 'missing' });
    expect(by(r, 'contribution').standing).toBe('incomplete');
  });

  it('a cost missing on some orders keeps its known amount and is marked incomplete', () => {
    const r = breakdownRows(
      withStatus(
        { shippingCost: 'missing' },
        {
          missingShares: { ...base.missingShares, shippingCost: '0.3000' },
        },
      ),
      'USD',
    );
    expect(by(r, 'shippingCost')).toMatchObject({ amount: '-25.0000', standing: 'incomplete' });
  });

  it('an estimated cost is marked as an estimate and makes contribution an estimate', () => {
    const r = breakdownRows(withStatus({ cogs: 'estimated' }), 'USD');
    expect(by(r, 'cogs').standing).toBe('estimated');
    expect(by(r, 'contribution').standing).toBe('estimated');
  });

  it('advertising that is not set up, or has no spend, is a word and not a number', () => {
    const none = breakdownRows(
      withStatus({ advertising: 'not_configured' }, { adSpend: null }),
      'USD',
    );
    expect(by(none, 'ads')).toMatchObject({
      amount: null,
      text: 'Not set up',
      standing: 'not_set_up',
    });
    const noSpend = breakdownRows(withStatus({ advertising: 'missing' }, { adSpend: null }), 'USD');
    expect(by(noSpend, 'ads')).toMatchObject({ amount: null, standing: 'no_data' });
  });

  it('net profit is not available without operating expenses', () => {
    const r = breakdownRows(
      withStatus(
        { operatingExpenses: 'not_configured', estimatedNetProfit: 'not_configured' },
        { operatingExpenses: null, estimatedNetProfit: null },
      ),
      'USD',
    );
    expect(by(r, 'opex')).toMatchObject({ amount: null, text: 'Not set up' });
    expect(by(r, 'net')).toMatchObject({
      amount: null,
      text: 'Not available',
      standing: 'not_available',
    });
  });

  it('net profit with a gap upstream is an estimate, not confirmed', () => {
    const r = breakdownRows(withStatus({ estimatedNetProfit: 'estimated' }), 'USD');
    expect(by(r, 'net')).toMatchObject({ amount: '300.0000', standing: 'estimated' });
  });

  it('contribution profit is never labelled as net profit', () => {
    expect(by(rows, 'contribution').label).toBe('Contribution profit');
    expect(by(rows, 'net').label).toBe('Estimated net profit');
  });
});
