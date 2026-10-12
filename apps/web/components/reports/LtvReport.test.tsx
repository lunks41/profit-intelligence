// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { LtvResponse } from '@pi/contracts';

const state = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('../profitability/shared', () => ({
  useApi: () => ({ data: state.data, error: null, loading: false, reload: () => {} }),
  ErrorBanner: () => null,
  Loading: () => null,
}));
// the chart needs a real layout engine
vi.mock('recharts', () => {
  const Stub = () => null;
  return {
    Bar: Stub,
    CartesianGrid: Stub,
    ComposedChart: Stub,
    Legend: Stub,
    Line: Stub,
    ResponsiveContainer: Stub,
    Tooltip: Stub,
    XAxis: Stub,
    YAxis: Stub,
  };
});

import { LtvReport } from './LtvReport';

const base: LtvResponse = {
  period: { from: '2026-05-01', to: '2026-10-31' },
  currency: 'USD',
  kpis: {
    customers: 6,
    repurchaseRate: '0.1667',
    revenue: '600.0000',
    ltv: '100.0000',
    profitLtv: '40.0000',
    cac: '50.0000',
    ratio: '2.00',
  },
  cohorts: [
    {
      month: '2026-05',
      customers: 4,
      repurchaseRate: '0.2500',
      revenue: '500.0000',
      ltv: '125.0000',
      profitLtv: '50.0000',
      adSpend: '200.0000',
      cac: '50.0000',
      ratio: '2.50',
      cumulative: [
        { ltv: '100.0000', profitLtv: '40.0000' },
        { ltv: '125.0000', profitLtv: '50.0000' },
      ],
    },
    {
      month: '2026-06',
      customers: 2,
      repurchaseRate: '0.0000',
      revenue: '100.0000',
      ltv: '50.0000',
      profitLtv: '20.0000',
      adSpend: null,
      cac: null,
      ratio: null,
      cumulative: [{ ltv: '50.0000', profitLtv: '20.0000' }],
    },
  ],
  countries: ['US'],
  sources: ['web'],
  orders: { withCustomer: 8, withoutCustomer: 2 },
  customerDataMissing: false,
  adFxGap: false,
  historyDays: 90,
};

afterEach(cleanup);

describe('LtvReport', () => {
  it('shows the cohort rows with month names, customers and the values to date', () => {
    state.data = base;
    const { container } = render(<LtvReport />);
    const text = container.textContent ?? '';
    expect(text).toContain('May 2026');
    expect(text).toContain('Jun 2026');
    expect(text).toContain('4 customers');
    expect(text).toContain('1st month');
    expect(text).toContain('2nd month');
    expect(text).toContain('$125.00');
    expect(text).toContain('2.00 : 1');
    // a month with no ad spend has no CAC, never $0
    expect(text).toContain('—');
  });

  it('explains how many orders have no customer', () => {
    state.data = base;
    const { container } = render(<LtvReport />);
    expect(container.textContent).toContain('2 of 10 orders');
  });

  it('asks for the customer permission when no order has a customer yet', () => {
    state.data = {
      ...base,
      customerDataMissing: true,
      cohorts: [],
      kpis: { ...base.kpis, customers: 0, ltv: null, profitLtv: null, cac: null, ratio: null },
    };
    const { container } = render(<LtvReport />);
    expect(container.querySelector('s-banner')?.getAttribute('heading')).toBe(
      'Customers have not been imported yet',
    );
    expect(container.textContent).not.toContain('1st month');
    expect(container.textContent).not.toContain('Repurchase rate');
  });
});
