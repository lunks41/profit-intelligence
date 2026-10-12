'use client';

import { Fragment, useState } from 'react';
import type { ReportTableResponse } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { formatDate } from '../../lib/shop-time';
import { lineHelp } from '../../lib/pnl-help';
import { sumFigures } from '../../lib/pnl-lines';
import { InfoTip } from '../common/info-tip';
import { ScrollTable } from '../common/ScrollTable';

/**
 * The profit and loss laid out the way an accountant reads it: revenue, the cost of goods sold, gross profit, then the
 * fees and shipping that give contribution profit, then the operating expenses that give operating profit. Each
 * group opens and closes; every subtotal shows how much of the revenue it is. The figures are the ones of the
 * Statement view, so the two views always agree; a subtotal made from an unknown figure says so instead of
 * showing a number.
 */

interface Group {
  title: string;
  lines: string[];
  /** the subtotal that closes the group: a line of the report, or one worked out here */
  total: { label: string; from?: string[] };
}

const GROUPS: Group[] = [
  {
    title: 'Revenue',
    lines: ['Sales before discounts', 'Discounts', 'Refunds', 'Shipping charged (net of refunds)'],
    total: { label: 'Revenue' },
  },
  {
    title: 'Cost of goods sold',
    lines: ['Product cost'],
    total: { label: 'Gross profit', from: ['Revenue', 'Product cost'] },
  },
  {
    title: 'Fees and shipping',
    lines: ['Payment fees', 'Shipping cost'],
    total: { label: 'Contribution profit' },
  },
  {
    title: 'Operating expenses',
    lines: ['Operating expenses: advertising', 'Operating expenses: other'],
    total: { label: 'Estimated operating profit' },
  },
];

const num = (v: string | undefined) =>
  v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

export function AccountingView({
  report,
  headerExtra,
}: {
  report: ReportTableResponse;
  /** something beside the title inside the card, such as the switch between the two views */
  headerExtra?: React.ReactNode;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const all = [...report.rows, ...report.totalRows];
  const find = (label: string) => all.find((r) => r[0] === label);
  // the figure columns: every column but the first (the line) and the last (the data status)
  const statusAt = report.columns.findIndex((c) => c.key === 'status');
  const figureCols = report.columns.flatMap((c, i) => (i > 0 && i !== statusAt ? [i] : []));
  const totalCol = figureCols[figureCols.length - 1]!; // the whole period (or the only month)
  const revenueRow = find('Revenue');

  const share = (row: string[] | undefined) => {
    const v = num(row?.[totalCol]);
    const rev = num(revenueRow?.[totalCol]);
    return v === null || !rev ? '—' : formatPercent(v / rev);
  };
  const money = (v: string | undefined) => {
    if (v === undefined || v === '') return '';
    const n = num(v);
    return n === null ? v : formatMoney(v, report.currency);
  };

  /** a subtotal worked out here: the first line plus the second (costs are negative), or a word when one is unknown */
  const computed = (labels: string[]): { cells: string[]; status: string } => {
    const rows = labels.map(find);
    const cells = figureCols.map((i) => sumFigures(rows.map((r) => r?.[i])));
    const worst =
      rows.map((r) => r?.[statusAt] ?? '').find((s) => s && s !== 'Confirmed') ?? 'Confirmed';
    return { cells, status: worst };
  };

  const heading = `Profit and loss, ${report.from === report.to ? formatDate(report.from) : `${formatDate(report.from)} to ${formatDate(report.to)}`}`;

  return (
    <s-section padding="none" heading={headerExtra ? undefined : heading}>
      {headerExtra && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem' }}
        >
          <s-heading>{heading}</s-heading>
          {headerExtra}
        </div>
      )}
      <ScrollTable>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Line</s-table-header>
            {figureCols.map((i) => (
              <s-table-header key={i} format="numeric">
                {report.columns[i]!.label}
              </s-table-header>
            ))}
            <s-table-header format="numeric">Share of revenue</s-table-header>
            <s-table-header>Data status</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {GROUPS.map((g) => {
              const isClosed = closed[g.title] === true;
              const sub = g.total.from ? computed(g.total.from) : null;
              const totalRow = g.total.from ? undefined : find(g.total.label);
              const subCells = sub ? sub.cells : figureCols.map((i) => totalRow?.[i] ?? '');
              const subStatus = sub ? sub.status : (totalRow?.[statusAt] ?? '');
              const subShare = sub
                ? (() => {
                    const v = num(sub.cells[sub.cells.length - 1]);
                    const rev = num(revenueRow?.[totalCol]);
                    return v === null || !rev ? '—' : formatPercent(v / rev);
                  })()
                : share(totalRow);
              return (
                <Fragment key={g.title}>
                  <s-table-row>
                    <s-table-cell>
                      <button
                        type="button"
                        aria-expanded={!isClosed}
                        onClick={() => setClosed((c) => ({ ...c, [g.title]: !isClosed }))}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          border: 0,
                          background: 'transparent',
                          padding: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        <s-icon type={isClosed ? 'chevron-right' : 'chevron-down'} size="small" />
                        <strong>{g.title}</strong>
                      </button>
                    </s-table-cell>
                    {figureCols.map((i) => (
                      <s-table-cell key={i} />
                    ))}
                    <s-table-cell />
                    <s-table-cell />
                  </s-table-row>
                  {!isClosed &&
                    g.lines.map((label) => {
                      const row = find(label);
                      if (!row) return null;
                      const help = lineHelp(label);
                      return (
                        <s-table-row key={label}>
                          <s-table-cell>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.15rem',
                                paddingLeft: '1.5rem',
                              }}
                            >
                              {label}
                              {help && <InfoTip label={label} text={help} />}
                            </span>
                          </s-table-cell>
                          {figureCols.map((i) => (
                            <s-table-cell key={i}>{money(row[i])}</s-table-cell>
                          ))}
                          <s-table-cell>{share(row)}</s-table-cell>
                          <s-table-cell>{row[statusAt]}</s-table-cell>
                        </s-table-row>
                      );
                    })}
                  <s-table-row>
                    <s-table-cell>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.15rem',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '0.35rem',
                          background: '#eaf4ff',
                        }}
                      >
                        <s-text type="strong">{g.total.label}</s-text>
                        <InfoTip
                          label={g.total.label}
                          text={
                            lineHelp(g.total.label) ??
                            'Revenue less the cost of the products sold. What is left before fees, shipping, advertising and expenses.'
                          }
                        />
                      </span>
                    </s-table-cell>
                    {subCells.map((v, k) => (
                      <s-table-cell key={k}>
                        <s-text type="strong">{money(v)}</s-text>
                      </s-table-cell>
                    ))}
                    <s-table-cell>
                      <s-text type="strong">{subShare}</s-text>
                    </s-table-cell>
                    <s-table-cell>{subStatus}</s-table-cell>
                  </s-table-row>
                </Fragment>
              );
            })}
          </s-table-body>
        </s-table>
      </ScrollTable>
    </s-section>
  );
}
