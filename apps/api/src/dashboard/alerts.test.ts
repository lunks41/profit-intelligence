import type { ProfitSummary } from '@pi/contracts';
import { summarizeFromTotals } from '@pi/profit-engine';
import type { CoverageInput } from '@pi/profit-engine';
import { describe, expect, it } from 'vitest';
import { buildAlerts } from './alerts.js';
import type { AlertInput } from './alerts.js';

const COMPLETE: CoverageInput = {
  cost: { actual: '100', estimated: '0', missing: '0' },
  fees: { actual: 10, estimated: 0, missing: 0 },
  shipping: { actual: 10, estimated: 0, missing: 0 },
};

const summary = (coverage: CoverageInput = COMPLETE): ProfitSummary => ({
  ...summarizeFromTotals(
    { gross_sales: '1000.0000', cogs: '-400.0000' },
    { orderCount: 10, anyMissing: false, coverage },
  ),
  orders: 10,
});

const quiet = {
  awaitingPayment: { count: 0, amount: '0.0000' },
  confirmedLoss: { count: 0, amount: '0.0000' },
  possibleLoss: 0,
  flagged: 0,
};

const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  summary: summary(),
  attention: quiet,
  missingCostThresholdPct: '10',
  currency: 'USD',
  sync: {
    state: 'succeeded',
    stale: false,
    error: null,
    lastSuccessAt: '2026-10-09T08:00:00.000Z',
  },
  ...over,
});
const ids = (a: AlertInput) => buildAlerts(a).map((x) => x.id);

describe('buildAlerts', () => {
  it('has nothing to say when everything is complete and healthy', () => {
    expect(buildAlerts(base())).toEqual([]);
  });

  it('every alert states a fact and why it matters', () => {
    const all = buildAlerts(
      base({
        summary: summary({
          cost: { actual: '60', estimated: '0', missing: '40' },
          fees: { actual: 0, estimated: 0, missing: 10 },
          shipping: { actual: 0, estimated: 0, missing: 10 },
        }),
        attention: {
          awaitingPayment: { count: 2, amount: '300.0000' },
          confirmedLoss: { count: 3, amount: '-450.0000' },
          possibleLoss: 1,
          flagged: 1,
        },
        sync: {
          state: 'failed',
          stale: true,
          error: 'Gave up after 6 attempts',
          lastSuccessAt: null,
        },
      }),
    );
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const a of all) {
      expect(a.title.length).toBeGreaterThan(5);
      expect(a.evidence.length).toBeGreaterThan(5);
      expect(a.why.length).toBeGreaterThan(5);
    }
  });

  it('orders by severity: critical, then warning, then info', () => {
    const list = buildAlerts(
      base({
        attention: {
          awaitingPayment: { count: 1, amount: '5.0000' },
          confirmedLoss: { count: 1, amount: '-5.0000' },
          possibleLoss: 0,
          flagged: 1,
        },
      }),
    );
    expect(list.map((a) => a.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('a failed import is critical and replaces the less specific stale warning', () => {
    const list = buildAlerts(
      base({ sync: { state: 'failed', stale: true, error: 'boom', lastSuccessAt: null } }),
    );
    expect(list.map((a) => a.id)).toEqual(['sync_failed']);
    expect(list[0]!.evidence).toBe('boom');
  });

  it('stale data warns, with the time of the last good import', () => {
    const list = buildAlerts(
      base({
        sync: {
          state: 'succeeded',
          stale: true,
          error: null,
          lastSuccessAt: '2026-10-01T08:00:00.000Z',
        },
      }),
    );
    expect(list[0]).toMatchObject({ id: 'data_stale', severity: 'warning' });
    expect(list[0]!.evidence).toContain('2026-10-01 08:00');
  });

  it('missing cost warns only above the merchant threshold, and is critical from 30%', () => {
    const cov = (missing: number): CoverageInput => ({
      cost: { actual: String(100 - missing), estimated: '0', missing: String(missing) },
      fees: null,
      shipping: null,
    });
    expect(ids(base({ summary: summary(cov(10)) }))).not.toContain('missing_costs'); // at the limit
    expect(
      buildAlerts(base({ summary: summary(cov(11)) })).find((a) => a.id === 'missing_costs')
        ?.severity,
    ).toBe('warning');
    expect(
      buildAlerts(base({ summary: summary(cov(35)) })).find((a) => a.id === 'missing_costs')
        ?.severity,
    ).toBe('critical');
    expect(ids(base({ missingCostThresholdPct: '50', summary: summary(cov(35)) }))).not.toContain(
      'missing_costs',
    );
  });

  it('only a loss with every cost known is "lost money"; unknown ones are "may be"', () => {
    const list = buildAlerts(base({ attention: { ...quiet, possibleLoss: 4 } }));
    expect(list.map((a) => a.id)).toEqual(['possible_loss']);
    expect(list[0]!.title).toContain('may be losing money');
    expect(list[0]!.evidence).toContain('not confirmed');
  });

  it('formats amounts in the display currency and gets singular and plural right', () => {
    const one = buildAlerts(
      base({
        currency: 'AED',
        attention: {
          ...quiet,
          awaitingPayment: { count: 1, amount: '1234.5000' },
          confirmedLoss: { count: 1, amount: '-12.3000' },
        },
      }),
    );
    expect(one.find((a) => a.id === 'awaiting_payment')!.title).toBe('1 order is awaiting payment');
    expect(one.find((a) => a.id === 'awaiting_payment')!.evidence).toContain('AED 1,234.50');
    expect(one.find((a) => a.id === 'loss_orders')!.title).toBe('1 order lost money');

    const many = buildAlerts(
      base({
        attention: {
          ...quiet,
          awaitingPayment: { count: 3, amount: '1.0000' },
          confirmedLoss: { count: 2, amount: '-1.0000' },
        },
      }),
    );
    expect(many.find((a) => a.id === 'awaiting_payment')!.title).toBe(
      '3 orders are awaiting payment',
    );
    expect(many.find((a) => a.id === 'loss_orders')!.title).toBe('2 orders lost money');
  });

  it('missing fees and shipping each get an alert pointing at the settings', () => {
    const list = buildAlerts(
      base({
        summary: summary({
          cost: COMPLETE.cost,
          fees: { actual: 5, estimated: 0, missing: 5 },
          shipping: { actual: 0, estimated: 0, missing: 4 },
        }),
      }),
    );
    expect(list.find((a) => a.id === 'missing_fees')).toMatchObject({
      action: { href: '/settings' },
    });
    expect(list.find((a) => a.id === 'missing_shipping_cost')!.evidence).toContain('100.0%');
  });
});
