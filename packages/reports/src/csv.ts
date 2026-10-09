import type { ReportTable } from './types.js';

/** A spreadsheet runs a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Text that could be read as a formula gets a leading apostrophe so opening a report
 * in a spreadsheet can never run something a customer typed into a product or order name. Numbers
 * (money, percent, integers) are written as plain decimals and never altered.
 */
export function csvCell(value: string, type: 'text' | 'money' | 'percent' | 'integer'): string {
  let v = value;
  if (type === 'text' && FORMULA_START.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** RFC 4180 CSV with a byte order mark so Excel reads UTF-8 correctly. Totals follow the rows. */
export function renderCsv(report: ReportTable): Buffer {
  const lines: string[] = [];
  lines.push(report.columns.map((c) => csvCell(c.label, 'text')).join(','));
  for (const row of [...report.rows, ...report.totalRows]) {
    lines.push(
      row.map((cell, i) => csvCell(cell ?? '', report.columns[i]?.type ?? 'text')).join(','),
    );
  }
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}
