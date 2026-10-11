import type { ProductRowData } from '@pi/reports';
import { describe, expect, it } from 'vitest';
import { productInsights, profitTrend } from './product-insights.js';

const row = (o: Partial<ProductRowData> & { title: string }): ProductRowData =>
  ({
    key: o.title,
    productKey: o.title,
    variant: null,
    sku: 'SKU-1',
    units: 5,
    orders: 5,
    grossSales: '100.0000',
    discounts: '0.0000',
    refunds: '0.0000',
    netSales: '100.0000',
    cogs: '-40.0000',
    profit: '60.0000',
    margin: '0.6000',
    costQuality: 'actual',
    missingCostLines: 0,
    ...o,
  }) as ProductRowData;

describe('what is missing from the products table', () => {
  it('says nothing when everything is complete', () => {
    const rows = [row({ title: 'A' }), row({ title: 'B' })];
    expect(productInsights(rows, rows)).toEqual([]);
  });

  it('counts products with no cost, their share of sales, and names the biggest', () => {
    const rows = [
      row({ title: 'Big', netSales: '600.0000', missingCostLines: 2, costQuality: 'missing' }),
      row({ title: 'Small', netSales: '100.0000', missingCostLines: 1, costQuality: 'missing' }),
      row({ title: 'Fine', netSales: '300.0000' }),
    ];
    const [i] = productInsights(rows, rows);
    expect(i).toMatchObject({
      id: 'missing_cost',
      severity: 'critical',
      count: 2,
      share: '0.7000',
      amount: '700.0000',
    });
    expect(i!.examples.map((e) => e.title)).toEqual(['Big', 'Small']);
    expect(i!.action!.href).toBe('/settings?tab=costs&filter=missing');
    expect(i!.fix.length).toBeGreaterThan(20);
  });

  it('a small share of missing cost is a warning, not critical', () => {
    const rows = [
      row({ title: 'Tiny', netSales: '10.0000', missingCostLines: 1, costQuality: 'missing' }),
      row({ title: 'Big', netSales: '1000.0000' }),
    ];
    expect(productInsights(rows, rows)[0]).toMatchObject({
      id: 'missing_cost',
      severity: 'warning',
    });
  });

  it('separates estimated costs, losses and high refunds, and ranks the worst first', () => {
    const rows = [
      row({ title: 'Est', costQuality: 'estimated' }),
      row({ title: 'Loser', profit: '-25.0000', netSales: '80.0000' }),
      row({ title: 'Returned', grossSales: '200.0000', refunds: '-60.0000', orders: 6 }),
      row({ title: 'FewOrders', grossSales: '200.0000', refunds: '-100.0000', orders: 2 }),
    ];
    const list = productInsights(rows, rows);
    expect(list.map((i) => i.id)).toEqual(['loss_making', 'high_refunds', 'estimated_cost']);
    expect(list[0]).toMatchObject({ severity: 'critical', count: 1, amount: '-25.0000' });
    // two orders is too few to judge a refund rate
    expect(list[1]!.examples.map((e) => e.title)).toEqual(['Returned']);
  });

  it('a product with a missing cost is not also called a loss', () => {
    const rows = [
      row({ title: 'X', profit: '-5.0000', missingCostLines: 1, costQuality: 'missing' }),
    ];
    expect(productInsights(rows, rows).map((i) => i.id)).toEqual(['missing_cost']);
  });

  it('flags variants without a SKU', () => {
    const products = [row({ title: 'P' })];
    const variants = [
      row({ title: 'P', variant: 'Red', sku: null }),
      row({ title: 'P', variant: 'Blue', sku: '  ' }),
      row({ title: 'P', variant: 'Green', sku: 'G-1' }),
    ];
    const i = productInsights(products, variants).find((x) => x.id === 'no_sku')!;
    expect(i.count).toBe(2);
    expect(i.examples.map((e) => e.title).sort()).toEqual(['P (Blue)', 'P (Red)']);
  });
});

describe('the small chart in a row', () => {
  const range = { from: '2026-10-01', to: '2026-10-10' };

  it('one point per day for a short period, with the profit of that day', () => {
    const t = profitTrend(
      [
        { orderDate: '2026-10-01', profit: '10.5000' },
        { orderDate: '2026-10-01', profit: '4.5000' },
        { orderDate: '2026-10-10', profit: '-3.0000' },
      ],
      range,
    );
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(15);
    expect(t[9]).toBe(-3);
    expect(t.slice(1, 9).every((v) => v === 0)).toBe(true);
  });

  it('never more than 30 points, and the points add up to the total', () => {
    const t = profitTrend(
      [
        { orderDate: '2026-01-01', profit: '1.0000' },
        { orderDate: '2026-06-15', profit: '2.0000' },
        { orderDate: '2026-12-31', profit: '3.0000' },
      ],
      { from: '2026-01-01', to: '2026-12-31' },
    );
    expect(t.length).toBeLessThanOrEqual(30);
    expect(t.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('ignores a line outside the period', () => {
    const t = profitTrend([{ orderDate: '2025-01-01', profit: '99.0000' }], range);
    expect(t.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
