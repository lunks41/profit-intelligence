'use client';

import type { ReportTableResponse } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { KIND_TONE, lineKind } from '../../lib/pnl-lines';

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
}: {
  report: ReportTableResponse;
  showType?: boolean;
}) {
  const empty = report.rows.length === 0 && report.totalRows.length === 0;
  return (
    <s-section
      padding="none"
      heading={`${report.title}, ${report.from === report.to ? report.from : `${report.from} to ${report.to}`}`}
    >
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
            </s-table-header-row>
            <s-table-body>
              {report.rows.map((r, i) => (
                <s-table-row key={`r${i}`}>
                  {r.flatMap((v, j) => {
                    const c = (
                      <s-table-cell key={j}>
                        {cell(v, report.columns[j]!.type, report.currency)}
                      </s-table-cell>
                    );
                    return j === 0 && showType ? [c, <KindCell key="kind" label={v} />] : [c];
                  })}
                </s-table-row>
              ))}
              {report.totalRows.map((r, i) => (
                <s-table-row key={`t${i}`}>
                  {r.flatMap((v, j) => {
                    const c = (
                      <s-table-cell key={j}>
                        <s-text type="strong">
                          {cell(v, report.columns[j]!.type, report.currency)}
                        </s-text>
                      </s-table-cell>
                    );
                    return j === 0 && showType ? [c, <KindCell key="kind" label={v} />] : [c];
                  })}
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
                  {n}
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
