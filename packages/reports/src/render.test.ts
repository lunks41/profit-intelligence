import { describe, expect, it } from 'vitest';
import { csvCell, renderCsv } from './csv.js';
import { formatCell, renderPdf } from './pdf.js';
import { monthSlices } from './builders.js';
import type { ReportTable } from './types.js';

const report = (over: Partial<ReportTable> = {}): ReportTable => ({
  kind: 'products',
  title: 'Product profitability',
  subtitle: 'Test shop, 2026-09-01 to 2026-09-30',
  currency: 'USD',
  from: '2026-09-01',
  to: '2026-09-30',
  columns: [
    { key: 'p', label: 'Product', type: 'text' },
    { key: 'u', label: 'Units', type: 'integer' },
    { key: 'profit', label: 'Profit', type: 'money' },
    { key: 'm', label: 'Margin', type: 'percent' },
  ],
  rows: [['Trail Backpack', '3', '1234.5000', '0.3706']],
  totalRows: [['Total', '', '1234.5000', '']],
  notes: ['A note'],
  ...over,
});

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b', 'text')).toBe('"a,b"');
    expect(csvCell('say "hi"', 'text')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines', 'text')).toBe('"two\nlines"');
    expect(csvCell('plain', 'text')).toBe('plain');
  });

  it('neutralises text a spreadsheet would run as a formula', () => {
    for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '=HYPERLINK("http://x")']) {
      expect(csvCell(evil, 'text').replace(/^"/, '')).toMatch(/^'/);
    }
  });

  it('never alters numbers, including negative money', () => {
    expect(csvCell('-157.5000', 'money')).toBe('-157.5000');
    expect(csvCell('0.3706', 'percent')).toBe('0.3706');
    expect(csvCell('12', 'integer')).toBe('12');
  });
});

describe('renderCsv', () => {
  it('writes a header, the rows, then the totals, with CRLF and a byte order mark', () => {
    const text = renderCsv(report()).toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.split('\r\n').slice(0, 3)).toEqual([
      '﻿Product,Units,Profit,Margin',
      'Trail Backpack,3,1234.5000,0.3706',
      'Total,,1234.5000,',
    ]);
  });

  it('ends with a labelled block: report, store, period, currency, time, data notes and notes', () => {
    const text = renderCsv(
      report({
        audit: {
          generatedAt: '2026-10-10T06:00:00.000Z',
          timezone: 'Asia/Dubai',
          dataNotes: ['Payment fees are estimated from your rule on 4 of 10 orders.'],
        },
      }),
    ).toString('utf8');
    const lines = text.split('\r\n');
    expect(lines[3]).toBe('');
    expect(lines.slice(4, 12)).toEqual([
      'Report,Product profitability',
      'Store,Test shop',
      'Period,2026-09-01 to 2026-09-30',
      'Currency,USD',
      'Generated (UTC),2026-10-10T06:00:00.000Z',
      'Shop time zone,Asia/Dubai',
      'Data note,Payment fees are estimated from your rule on 4 of 10 orders.',
      'Note,A note',
    ]);
  });

  it('a hostile product name cannot become a formula', () => {
    const text = renderCsv(report({ rows: [["=cmd|' /C calc'!A0", '1', '1', '']] })).toString(
      'utf8',
    );
    expect(text).toContain("'=cmd");
  });

  it('keeps non-ASCII text intact', () => {
    const text = renderCsv(report({ rows: [['Café – منتج', '1', '1', '']] })).toString('utf8');
    expect(text).toContain('Café – منتج');
  });
});

describe('formatCell', () => {
  it('formats money, percent and integers for reading', () => {
    expect(formatCell('1234.5000', 'money', 'USD')).toBe('$1,234.50');
    expect(formatCell('-157.5', 'money', 'USD')).toBe('-$157.50');
    expect(formatCell('-0.0000', 'money', 'USD')).toBe('$0.00');
    expect(formatCell('0.3706', 'percent', 'USD')).toBe('37.1%');
    expect(formatCell('12', 'integer', 'USD')).toBe('12');
    expect(formatCell('', 'money', 'USD')).toBe('');
    expect(formatCell('n/a', 'money', 'USD')).toBe('n/a');
  });
});

describe('renderPdf', () => {
  it('produces a real PDF', async () => {
    const pdf = await renderPdf(report());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(800);
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
  });

  it('spreads a long report over several pages without failing', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => [
      `Product number ${i}`,
      String(i),
      '10.5000',
      '0.2',
    ]);
    const small = await renderPdf(report({ rows: rows.slice(0, 5) }));
    const big = await renderPdf(report({ rows }));
    expect(big.length).toBeGreaterThan(small.length * 3);
    const pages = (big.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(5);
  });

  it('handles an empty report and very long text', async () => {
    expect(
      (await renderPdf(report({ rows: [], totalRows: [], notes: [] }))).length,
    ).toBeGreaterThan(500);
    const long = 'word '.repeat(300);
    expect(
      (await renderPdf(report({ rows: [[long, '1', '1', '']] }))).subarray(0, 5).toString(),
    ).toBe('%PDF-');
  });
});

describe('monthSlices', () => {
  it('splits a range into calendar months, keeping partial first and last months', () => {
    expect(monthSlices({ from: '2026-08-15', to: '2026-10-09' })).toEqual([
      { from: '2026-08-15', to: '2026-08-31', label: 'Aug 2026' },
      { from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026' },
      { from: '2026-10-01', to: '2026-10-09', label: 'Oct 2026' },
    ]);
  });

  it('a single day and a year boundary work', () => {
    expect(monthSlices({ from: '2026-10-09', to: '2026-10-09' })).toHaveLength(1);
    expect(monthSlices({ from: '2026-12-20', to: '2027-01-05' }).map((s) => s.label)).toEqual([
      'Dec 2026',
      'Jan 2027',
    ]);
  });

  it('slices are contiguous and cover the range exactly', () => {
    const s = monthSlices({ from: '2026-01-31', to: '2026-12-31' });
    for (let i = 1; i < s.length; i++) {
      expect(Date.parse(s[i]!.from) - Date.parse(s[i - 1]!.to)).toBe(86_400_000);
    }
    expect(s[0]!.from).toBe('2026-01-31');
    expect(s.at(-1)!.to).toBe('2026-12-31');
  });
});
