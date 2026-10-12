'use client';

import type { ReportTableResponse } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { KIND_TONE, lineKind } from '../../lib/pnl-lines';
import { formatDate, prettyDates } from '../../lib/shop-time';
import { lineHelp } from '../../lib/pnl-help';
import { InfoTip } from '../common/info-tip';
import { Sparkline } from '../common/sparkline';

function cell(
  value: string,
  type: ReportTableResponse['columns'][number]['type'],
  currency: string,
) {
  if (value === '') return '';
  // a word (Missing, Not configured) means the figure is unknown; show it as it is
  if ((type === 'money' || type === 'percent') && !Number.isFinite(Number(value))) return value;
  if (type === 'money') return formatMoney(value, currency);
  if (type === 'percent') return formatPercent(value);
  return value;
}

/**
 * `showType` adds a Type column after the first one: a capsule saying whether the line is Income, Outgoing or a
 * Result (used for the profit and loss).
 */
export function ReportTable({
  report,
  showType = false,
  headerExtra,
}: {
  report: ReportTableResponse;
  showType?: boolean;
  /** something beside the title inside the card, such as a switch between two views */
  headerExtra?: React.ReactNode;
}) {
  const empty = report.rows.length === 0 && report.totalRows.length === 0;
  const title = `${report.title}, ${report.from === report.to ? formatDate(report.from) : `${formatDate(report.from)} to ${formatDate(report.to)}`}`;
  return (
    <s-section padding="none" heading={headerExtra ? undefined : title}>
      {headerExtra && <CardTitle title={title}>{headerExtra}</CardTitle>}
      <s-stack gap="base">
        {empty ? (
          <s-box padding="base">
            <s-text color="subdued">Nothing to show for this period.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              {report.columns
                .map((c, i) => (
                  <s-table-header
                    key={c.key}
                    listSlot={i === 0 ? 'primary' : undefined}
                    format={c.type === 'text' ? undefined : 'numeric'}
                  >
                    {c.label}
                  </s-table-header>
                ))
                .flatMap((h, i) =>
                  i === 0 && showType ? [h, <s-table-header key="kind">Type</s-table-header>] : [h],
                )}
              {showType && (
                <s-table-header>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    Trend
                    <InfoTip
                      label="Trend"
                      text="The last month against the month before. The first and the last month of a period can be partial, so a month that is only partly over can look lower."
                    />
                  </span>
                </s-table-header>
              )}
            </s-table-header-row>
            <s-table-body>
              {(showType ? groupedByKind(report.rows) : report.rows).map((r, i) => (
                <s-table-row key={`r${i}`}>
                  {r.flatMap((v, j) => {
                    const c = (
                      <s-table-cell key={j}>
                        {j === 0 && showType ? (
                          <LineName label={v} />
                        ) : (
                          cell(v, report.columns[j]!.type, report.currency)
                        )}
                      </s-table-cell>
                    );
                    return j === 0 && showType ? [c, <KindCell key="kind" label={v} />] : [c];
                  })}
                  {showType && <TrendCell report={report} row={r} />}
                </s-table-row>
              ))}
              {report.totalRows.map((r, i) => (
                <s-table-row key={`t${i}`}>
                  {r.flatMap((v, j) => {
                    const c = (
                      <s-table-cell key={j}>
                        <span style={showType ? HIGHLIGHT : undefined}>
                          {j === 0 && showType ? (
                            <LineName label={v} strong />
                          ) : (
                            <s-text type="strong">
                              {cell(v, report.columns[j]!.type, report.currency)}
                            </s-text>
                          )}
                        </span>
                      </s-table-cell>
                    );
                    return j === 0 && showType ? [c, <KindCell key="kind" label={v} />] : [c];
                  })}
                  {showType && <TrendCell report={report} row={r} />}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {(report.truncated ||
          report.notes.length > 0 ||
          (report.audit?.dataNotes.length ?? 0) > 0) && (
          <s-box padding="base">
            <s-stack gap="small-300">
              {report.truncated && (
                <s-text color="subdued">
                  The first {report.rows.length} rows are shown. The download has every row.
                </s-text>
              )}
              {report.notes.map((n) => (
                <s-text key={n} color="subdued">
                  {prettyDates(n)}
                </s-text>
              ))}
              {(report.audit?.dataNotes ?? []).map((n) => (
                <s-text key={n} tone="caution">
                  {n}
                </s-text>
              ))}
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-section>
  );
}

function KindCell({ label }: { label: string }) {
  const kind = lineKind(label);
  return (
    <s-table-cell>{kind ? <s-badge tone={KIND_TONE[kind]}>{kind}</s-badge> : null}</s-table-cell>
  );
}

const KIND_ORDER = { Income: 0, Outgoing: 1, Result: 2 } as const;

/** The lines grouped as Income, then Outgoing, then Result; inside a group they keep the order of the report. */
function groupedByKind(rows: string[][]): string[][] {
  const rank = (r: string[]) => {
    const k = lineKind(r[0] ?? '');
    return k ? KIND_ORDER[k] : 3;
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** The result lines (revenue, contribution profit, operating profit) stand out from the lines above them. */
const HIGHLIGHT: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.4rem',
  borderRadius: '0.35rem',
  background: '#eaf4ff',
};

function LineName({ label, strong }: { label: string; strong?: boolean }) {
  const help = lineHelp(label);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
      {strong ? <s-text type="strong">{label}</s-text> : label}
      {help && <InfoTip label={label} text={help} />}
    </span>
  );
}

/** A small line of the months, and the change of the last month against the one before. */
function TrendCell({ report, row }: { report: ReportTableResponse; row: string[] }) {
  const months = report.columns.flatMap((c, i) => (/^m\d+$/.test(c.key) ? [i] : []));
  if (months.length < 2) return <s-table-cell />;
  const kind = lineKind(row[0] ?? '');
  const values = months.map((i) => {
    const n = Number(row[i]);
    return row[i] === '' || !Number.isFinite(n) ? null : Math.abs(n);
  });
  const prev = values[values.length - 2];
  const last = values[values.length - 1];
  const change = prev && last !== null && last !== undefined ? (last - prev) / prev : null;
  // more income is good news and more outgoing is not; a result follows income
  const good = change === null ? null : kind === 'Outgoing' ? change <= 0 : change >= 0;
  const color = good === null ? '#8a8a8a' : good ? '#047b5d' : '#c4295c';
  return (
    <s-table-cell>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ width: '4.5rem', display: 'inline-block' }}>
          <Sparkline values={values} color={color} height="1.5rem" />
        </span>
        {change === null ? (
          <s-text color="subdued">—</s-text>
        ) : (
          <s-badge tone={good ? 'success' : 'critical'}>
            {`${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%`}
          </s-badge>
        )}
      </span>
    </s-table-cell>
  );
}

/** The title of a card with something beside it (a switch, a filter), on one row inside the card. */
function CardTitle({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem' }}>
      <s-heading>{title}</s-heading>
      {children}
    </div>
  );
}
