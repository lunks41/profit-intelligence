import { summarizePeriod } from '@pi/profit-engine';
import type { PeriodInputs } from '@pi/profit-engine';
import { describe, expect, it } from 'vitest';
import { figuresFrom } from './builders.js';
import { renderCsv } from './csv.js';
import type { ReportTable } from './types.js';

const totals = {
  gross_sales: '1000.0000',
  discounts: '-100.0000',
  product_refund: '-50.0000',
  shipping_revenue: '30.0000',
  shipping_refund: '-10.0000',
  cogs: '-400.0000',
  cogs_reversal: '20.0000',
  payment_fees: '-30.0000',
  shipping_cost: '-25.0000',
};
const actual = {
  cost: { actual: '1000.0000', estimated: '0.0000', missing: '0.0000' },
  fees: { actual: 10, estimated: 0, missing: 0 },
  shipping: { actual: 10, estimated: 0, missing: 0 },
};
const make = (over: Partial<PeriodInputs> = {}) =>
  figuresFrom(
    summarizePeriod({
      totals,
      coverage: actual,
      anyMissing: false,
      orderCount: 10,
      ads: { configured: true, hasData: true, spend: '35.0000' },
      operatingExpenses: '100.0000',
      ...over,
    }),
  );

describe('the profit and loss cells (what the screen, CSV and PDF all show)', () => {
  it('a fully known period shows amounts, all Confirmed, with net profit an Estimate', () => {
    const f = make();
    expect(f.revenue).toEqual({ text: '870.0000', status: 'Confirmed' });
    expect(f.cogs).toEqual({ text: '-380.0000', status: 'Confirmed' });
    expect(f.ads).toEqual({ text: '-35.0000', status: 'Confirmed' });
    expect(f.contribution).toEqual({ text: '400.0000', status: 'Confirmed' });
    expect(f.net).toEqual({ text: '300.0000', status: 'Estimated' });
  });

  it('without advertising or expenses the cells are words, not zero', () => {
    const f = make({
      ads: { configured: false, hasData: false, spend: '0.0000' },
      operatingExpenses: null,
    });
    expect(f.ads.text).toBe('Not configured');
    expect(f.opex.text).toBe('Not set up');
    expect(f.net).toEqual({ text: 'Not available', status: 'Needs operating expenses' });
    expect(f.contribution.status).toBe('Confirmed, excludes advertising');
    expect(f.ads.text).not.toMatch(/^-?\d/);
  });

  it('an advertising account without imported spend says no data', () => {
    const f = make({ ads: { configured: true, hasData: false, spend: '0.0000' } });
    expect(f.ads).toEqual({ text: 'No data', status: 'No data imported' });
  });

  it('a cost missing on every order is the word Missing, never 0.00', () => {
    const f = make({
      totals: { ...totals, payment_fees: '0.0000' },
      coverage: { ...actual, fees: { actual: 0, estimated: 0, missing: 10 } },
      anyMissing: true,
    });
    expect(f.fees).toEqual({ text: 'Missing', status: 'Missing' });
    expect(f.beforeAds.status).toBe('Incomplete');
    expect(f.net.status).toBe('Incomplete');
  });

  it('a cost missing on some orders keeps its known amount but is marked Incomplete', () => {
    const f = make({
      coverage: { ...actual, shipping: { actual: 7, estimated: 0, missing: 3 } },
      anyMissing: true,
    });
    expect(f.shippingCost).toEqual({ text: '-25.0000', status: 'Incomplete' });
  });

  it('a confirmed zero cost is shown as an amount', () => {
    const f = make({ totals: { ...totals, payment_fees: '0.0000' } });
    expect(f.fees).toEqual({ text: '0.0000', status: 'Confirmed' });
  });
});

describe('CSV keeps the words', () => {
  it('writes Missing and Not configured as text, so a spreadsheet cannot read them as 0', () => {
    const table: ReportTable = {
      kind: 'profit_loss',
      title: 'Profit and loss',
      subtitle: 's',
      currency: 'USD',
      from: '2026-09-01',
      to: '2026-09-30',
      columns: [
        { key: 'line', label: 'Line', type: 'text' },
        { key: 'm0', label: 'Sep 2026', type: 'money' },
        { key: 'status', label: 'Data status', type: 'text' },
      ],
      rows: [
        ['Payment fees', 'Missing', 'Missing'],
        ['Advertising', 'Not configured', 'Not configured'],
        ['Product cost', '-380.0000', 'Confirmed'],
      ],
      totalRows: [['Estimated net profit', 'Not available', 'Needs operating expenses']],
      notes: [],
    };
    const text = renderCsv(table).toString('utf8');
    expect(text).toContain('Payment fees,Missing,Missing');
    expect(text).toContain('Advertising,Not configured,Not configured');
    expect(text).toContain('Product cost,-380.0000,Confirmed');
    expect(text).toContain('Estimated net profit,Not available,Needs operating expenses');
  });
});
