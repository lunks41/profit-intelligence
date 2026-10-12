'use client';

import { ScrollTable } from '../common/ScrollTable';
import { useState } from 'react';
import type { ExpenseSummaryResponse } from '@pi/contracts';
import { formatMoney } from '../../lib/format';
import { Dropdown } from '../dropdown';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';

const monthName = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const RANGES = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months' },
];

/**
 * The profit and loss of each month: revenue, contribution profit, expenses and operating profit. It is the
 * same calculation as the Overview, month by month. The filter chooses how many months back to show.
 */
export function MonthlyPnl() {
  const [months, setMonths] = useState('6');
  const { data, error, loading, reload } = useApi<ExpenseSummaryResponse>(
    `/expenses/summary?months=${months}`,
  );
  return (
    <>
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="the monthly profit and loss" />}
      {data && (
        <Table
          data={data}
          filter={
            <Dropdown chip label="Months" value={months} options={RANGES} onChange={setMonths} />
          }
        />
      )}
    </>
  );
}

function Table({ data, filter }: { data: ExpenseSummaryResponse; filter: React.ReactNode }) {
  const cur = data.currency;
  return (
    <>
      {data.operatingProfitStatus === 'not_configured' && (
        <s-banner tone="warning" heading="Operating profit is not available yet">
          <s-paragraph>
            No expenses are set up, so only contribution profit is shown. Add rent, salaries,
            software and other costs on the Expenses screen and operating profit appears here.
          </s-paragraph>
        </s-banner>
      )}
      <s-section padding="none">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
          }}
        >
          <s-heading>Monthly profit and loss</s-heading>
          {filter}
        </div>
        <ScrollTable maxHeight="min(85vh, 52rem)">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Month</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
              <s-table-header format="numeric">Contribution profit</s-table-header>
              <s-table-header format="numeric">Recurring expenses</s-table-header>
              <s-table-header format="numeric">One-time expenses</s-table-header>
              <s-table-header format="numeric">Operating profit</s-table-header>
              <s-table-header>Data</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {[...data.months].reverse().map((m) => (
                <s-table-row key={m.month}>
                  <s-table-cell>{monthName(m.month)}</s-table-cell>
                  <s-table-cell>{formatMoney(m.revenue, cur)}</s-table-cell>
                  <s-table-cell>{formatMoney(m.contributionProfit, cur)}</s-table-cell>
                  <s-table-cell>{formatMoney(m.recurring, cur)}</s-table-cell>
                  <s-table-cell>{formatMoney(m.oneTime, cur)}</s-table-cell>
                  <s-table-cell>
                    {m.operatingProfit === null ? (
                      <s-text color="subdued">Not set up</s-text>
                    ) : (
                      <s-text type="strong">{formatMoney(m.operatingProfit, cur)}</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {m.incomplete ? (
                      <s-badge tone="caution">Incomplete</s-badge>
                    ) : (
                      <s-text color="subdued">Complete</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </ScrollTable>
        <s-box padding="base">
          <s-text color="subdued">
            Operating profit is contribution profit less advertising and the month&apos;s expenses.
            Recurring expenses are spread over the days of each month; one-time expenses fall in the
            month they are dated.
            {data.operatingProfitStatus === 'incomplete' &&
              ' Months marked Incomplete have orders with a missing product cost, payment fee or shipping cost, so their operating profit is higher than it really is.'}
          </s-text>
        </s-box>
      </s-section>
    </>
  );
}
