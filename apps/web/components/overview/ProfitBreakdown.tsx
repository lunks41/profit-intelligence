'use client';

import type { OverviewResponse } from '@pi/contracts';
import { breakdownRows, STANDING_LABEL, type Standing } from '../../lib/breakdown';
import { periodLabel } from '../../lib/format';
import { InfoTip } from '../common';

const TONE: Record<Standing, 'success' | 'info' | 'caution' | 'neutral' | 'critical'> = {
  confirmed: 'success',
  estimated: 'info',
  incomplete: 'caution',
  missing: 'caution',
  not_set_up: 'neutral',
  no_data: 'neutral',
  not_available: 'neutral',
};

const INFO: Record<string, string> = {
  revenue:
    'Sales before discounts, less discounts and product refunds, plus shipping charged (net of shipping refunds). Tax is not included.',
  contribution:
    'Revenue minus product costs, payment fees, shipping costs and advertising (when set up). This is not net profit: operating expenses come after it.',
  net: 'Contribution profit minus operating expenses. Shown only when operating expenses are set up, and called an estimate unless every input is confirmed.',
};

/**
 * Where the revenue goes, line by line, from sales to estimated net profit. Every line says whether
 * its figure is confirmed, an estimate, incomplete or missing, or not set up; an unknown cost is a
 * word, never $0.00.
 */
export function ProfitBreakdown({ data }: { data: OverviewResponse }) {
  const rows = breakdownRows(data.summary, data.currency.code);
  return (
    <s-section
      padding="none"
      heading={`Profit breakdown, ${periodLabel(data.period.from, data.period.to)}`}
    >
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Line</s-table-header>
          <s-table-header format="numeric">Amount</s-table-header>
          <s-table-header>Data</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {rows.map((r) => (
            <s-table-row key={r.key}>
              <s-table-cell>
                <s-stack direction="inline" alignItems="center" gap="small-300">
                  <s-text type={r.total ? 'strong' : undefined}>
                    {r.indent ? `   ${r.label}` : r.label}
                  </s-text>
                  {INFO[r.key] && <InfoTip label={r.label} text={INFO[r.key]!} />}
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                <s-text type={r.total ? 'strong' : undefined}>{r.text}</s-text>
              </s-table-cell>
              <s-table-cell>
                {r.standing === 'confirmed' ? (
                  <s-text color="subdued">Confirmed</s-text>
                ) : (
                  <s-badge tone={TONE[r.standing]}>{STANDING_LABEL[r.standing]}</s-badge>
                )}
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}
