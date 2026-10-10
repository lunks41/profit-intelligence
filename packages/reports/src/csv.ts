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
  // a labelled block under the table: when and for what the report was made, and how reliable it is
  const info: Array<[string, string]> = [
    ['Report', report.title],
    ['Store', report.subtitle.split(',')[0] ?? ''],
    ['Period', report.from === report.to ? report.from : `${report.from} to ${report.to}`],
    ['Currency', report.currency],
  ];
  if (report.audit) {
    info.push(
      ['Generated (UTC)', report.audit.generatedAt],
      ['Shop time zone', report.audit.timezone],
    );
  }
  lines.push('');
  for (const [k, v] of info) lines.push(`${csvCell(k, 'text')},${csvCell(v, 'text')}`);
  for (const n of report.audit?.dataNotes ?? [])
    lines.push(`${csvCell('Data note', 'text')},${csvCell(n, 'text')}`);
  for (const n of report.notes) lines.push(`${csvCell('Note', 'text')},${csvCell(n, 'text')}`);
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}
