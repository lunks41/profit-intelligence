import { describe, expect, it } from 'vitest';
import type { DataQuality, ProfitSummary } from '@pi/contracts';
import { buildIssues, dataQualityOf } from './issues.js';

const ok = { state: 'idle', stale: false, error: null, lastSuccessAt: '2026-10-09T08:00:00Z' };

const clean: DataQuality = {
  cost: { confirmed: '1.0000', estimated: '0.0000', missing: '0.0000' },
  fees: { confirmed: 10, estimated: 0, missing: 0 },
  shipping: { confirmed: 10, estimated: 0, missing: 0 },
  advertising: 'confirmed',
  operatingExpenses: 'confirmed',
};
const build = (over: Partial<DataQuality> = {}, sync = ok, threshold = '10') =>
  buildIssues({ quality: { ...clean, ...over }, missingCostThresholdPct: threshold, sync });

describe('data issues', () => {
  it('a complete shop has none', () => {
    expect(build()).toEqual([]);
  });

  it('each problem appears once, with an action that has a destination', () => {
    const issues = build(
      {
        cost: { confirmed: '0.6000', estimated: '0.1000', missing: '0.3000' },
        fees: { confirmed: 4, estimated: 0, missing: 6 },
        shipping: { confirmed: 0, estimated: 0, missing: 10 },
        advertising: 'not_configured',
        operatingExpenses: 'not_configured',
      },
      { ...ok, state: 'failed', error: 'Token revoked' },
    );
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'sync_failed',
      'missing_costs',
      'missing_shipping_cost',
      'missing_fees',
      'advertising_not_set_up',
      'expenses_not_set_up',
    ]);
    for (const i of issues) {
      expect(i.action.label.length).toBeGreaterThan(3);
      // in-page anchor or an app page, never the page the merchant is already on
      expect(i.action.href).toMatch(/^(#sync|\/(settings|marketing|expenses|products)(\?.*)?)$/);
    }
  });

  it('reliability comes before cost, and cost before set-up, whatever the order they are found in', () => {
    const issues = build(
      { advertising: 'not_configured', shipping: { confirmed: 5, estimated: 0, missing: 5 } },
      { ...ok, stale: true },
    );
    expect(issues.map((i) => i.id)).toEqual([
      'data_stale',
      'missing_shipping_cost',
      'advertising_not_set_up',
    ]);
  });

  it('missing product cost is a warning above the merchant limit and information below it', () => {
    const q = { cost: { confirmed: '0.9200', estimated: '0.0000', missing: '0.0800' } };
    expect(build(q, ok, '5').find((i) => i.id === 'missing_costs')?.severity).toBe('warning');
    expect(build(q, ok, '10').find((i) => i.id === 'missing_costs')?.severity).toBe('info');
    const big = { cost: { confirmed: '0.5000', estimated: '0.0000', missing: '0.5000' } };
    expect(build(big).find((i) => i.id === 'missing_costs')?.severity).toBe('critical');
  });

  it('the wording is exact about the denominator', () => {
    const i = build({
      cost: { confirmed: '0.8800', estimated: '0.0000', missing: '0.1200' },
      shipping: { confirmed: 7, estimated: 1, missing: 2 },
    });
    expect(i.find((x) => x.id === 'missing_costs')!.title).toBe(
      'Product cost is missing for 12.0% of sales value',
    );
    expect(i.find((x) => x.id === 'missing_shipping_cost')!.title).toBe(
      'Shipping cost is missing on 2 of 10 orders',
    );
  });

  it('estimated cost is only mentioned when nothing is missing, and as information', () => {
    const issues = build({
      cost: { confirmed: '0.7000', estimated: '0.3000', missing: '0.0000' },
    });
    expect(issues.map((i) => [i.id, i.severity])).toEqual([['estimated_costs', 'info']]);
  });

  it('an advertising account with no spend is its own message, not "not set up"', () => {
    expect(build({ advertising: 'missing' }).map((i) => i.id)).toEqual(['advertising_no_data']);
  });

  it('estimated fees are named as estimates and lead to the orders that still use a rule', () => {
    const issue = build({ fees: { confirmed: 8, estimated: 2, missing: 0 } })[0]!;
    expect(issue.id).toBe('estimated_fees');
    expect(issue.title).toBe('Payment fees are estimated on 2 of 10 orders');
    expect(issue.action.href).toBe('/orders?filter=estimated_fees');
  });

  it('a partial import says which records were left out', () => {
    const issue = build(
      {},
      { ...ok, state: 'partial', error: '2 order(s) had refund line items beyond the first 25' },
    )[0]!;
    expect(issue.id).toBe('sync_partial');
    expect(issue.detail).toContain('beyond the first 25');
    expect(issue.action.href).toBe('/orders?filter=incomplete_refunds');
  });

  it('orders missing a country or a weight link to the list that shows them', () => {
    const issues = buildIssues({
      quality: clean,
      missingCostThresholdPct: '10',
      sync: ok,
      gaps: { missingCountry: 3, missingWeight: 1, incompleteRefunds: 0 },
    });
    expect(issues.map((i) => i.action.href)).toEqual([
      '/orders?filter=missing_country',
      '/orders?filter=missing_weight',
    ]);
  });

  it('a stale shop that has never imported is not reported as stale', () => {
    expect(build({}, { ...ok, state: 'never', stale: true, lastSuccessAt: null })).toEqual([]);
  });
});

describe('the data quality block', () => {
  const summary = {
    statuses: { advertising: 'not_configured', operatingExpenses: 'confirmed' },
    confidence: {
      components: {
        cost: { shares: { actual: '0.6000', estimated: '0.1000', missing: '0.3000' } },
      },
    },
  } as unknown as ProfitSummary;

  it('reports cost as shares of sales value and fees and shipping as order counts', () => {
    const q = dataQualityOf(
      {
        cost: { actual: '60', estimated: '10', missing: '30' },
        fees: { actual: 8, estimated: 1, missing: 1 },
        shipping: null,
      },
      summary,
    );
    expect(q).toEqual({
      cost: { confirmed: '0.6000', estimated: '0.1000', missing: '0.3000' },
      fees: { confirmed: 8, estimated: 1, missing: 1 },
      shipping: null,
      advertising: 'not_configured',
      operatingExpenses: 'confirmed',
    });
  });
});
