import { describe, expect, it } from 'vitest';
import { customerKey } from '@pi/shopify';
import { buildCohorts } from './cohorts.js';

describe('customerKey', () => {
  it('is a stable 32 character hex key that does not contain the id', () => {
    const k = customerKey('gid://shopify/Customer/123');
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(customerKey('gid://shopify/Customer/123')).toBe(k);
    expect(customerKey('gid://shopify/Customer/124')).not.toBe(k);
    expect(k).not.toContain('123');
  });

  it('is null for a guest checkout or a value that is not an id', () => {
    expect(customerKey(undefined)).toBeNull();
    expect(customerKey(null)).toBeNull();
    expect(customerKey('')).toBeNull();
    expect(customerKey(42)).toBeNull();
  });
});

describe('buildCohorts', () => {
  const summary = [
    { month: '2026-05', customers: 4, repurchasers: 1 },
    { month: '2026-06', customers: 2, repurchasers: 0 },
  ];
  const cells = [
    { cohort: '2026-05', month: '2026-05', revenue: '400.0000', profit: '200.0000' },
    { cohort: '2026-05', month: '2026-07', revenue: '100.0000', profit: '40.0000' },
    { cohort: '2026-06', month: '2026-06', revenue: '50.0000', profit: '10.0000' },
  ];

  it('adds revenue and profit up per customer, month by month, to the current month', () => {
    const [may, june] = buildCohorts(summary, cells, new Map(), '2026-07');
    expect(may!.cumulative.map((c) => c.ltv)).toEqual(['100.0000', '100.0000', '125.0000']);
    expect(may!.cumulative.map((c) => c.profitLtv)).toEqual(['50.0000', '50.0000', '60.0000']);
    expect(may!.ltv).toBe('125.0000');
    expect(may!.revenue).toBe('500.0000');
    expect(may!.repurchaseRate).toBe('0.2500');
    expect(june!.cumulative.map((c) => c.ltv)).toEqual(['25.0000', '25.0000']);
  });

  it('works out CAC and the ratio from the ad spend of the cohort month', () => {
    const [may, june] = buildCohorts(summary, cells, new Map([['2026-05', '200.0000']]), '2026-07');
    expect(may!.adSpend).toBe('200.0000');
    expect(may!.cac).toBe('50.0000'); // 200 / 4 customers
    expect(may!.ratio).toBe('2.50'); // 125 / 50
    expect(june!.cac).toBeNull(); // no spend recorded for June
    expect(june!.ratio).toBeNull();
  });

  it('gives no ratio when the ad spend is zero', () => {
    const [may] = buildCohorts(summary, cells, new Map([['2026-05', '0.0000']]), '2026-07');
    expect(may!.cac).toBe('0.0000');
    expect(may!.ratio).toBeNull();
  });
});
