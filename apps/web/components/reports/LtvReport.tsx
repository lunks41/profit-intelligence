'use client';

import { useState } from 'react';
import type { LtvCohort, LtvResponse, PeriodPreset } from '@pi/contracts';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART } from '../../lib/chart-colors';
import { formatMoney, formatMoneyCompact, formatPercent } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { todayInShop } from '../../lib/shop-time';
import { StatCard, StatGrid } from '../common';
import { CardHeader } from '../common/CardHeader';
import { PlanLock } from '../common/PlanLock';
import { planWith, usePlan } from '../../lib/plan';
import { ScrollTable } from '../common/ScrollTable';
import { Dropdown } from '../dropdown';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';

type Measure = 'revenue' | 'profit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-05 -> May 2026 */
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const ORDINAL = ['1st', '2nd', '3rd'];
const nth = (i: number) => `${ORDINAL[i] ?? `${i + 1}th`} month`;
const ratioText = (r: string | null) => (r === null ? '—' : `${r} : 1`);

/** The LTV tab of Reports: customers grouped by the month of their first order. Locked on a plan without it. */
export function LtvReport() {
  const plan = usePlan();
  if (plan && !plan.entitlements.ltvReport) {
    return (
      <PlanLock plan={planWith(plan.plan, (e) => e.ltvReport)}>
        {`The LTV report is not part of your ${plan.plan} plan.`}
      </PlanLock>
    );
  }
  return <LtvBody />;
}

function LtvBody() {
  const [filters, setFilters] = useState<Filters>({
    preset: '90d' as PeriodPreset,
    from: todayInShop(),
    to: todayInShop(),
  });
  const [country, setCountry] = useState('');
  const [source, setSource] = useState('');
  const [measure, setMeasure] = useState<Measure>('revenue');
  const { data, error, loading, reload } = useApi<LtvResponse>(
    `/customers/ltv?${buildListQuery(filters, { country: country || undefined, source: source || undefined })}`,
  );

  return (
    <>
      <FilterBar chip filters={filters} onChange={setFilters}>
        <Dropdown
          chip
          label="Country"
          value={country}
          options={[
            { value: '', label: 'All countries' },
            ...(data?.countries ?? []).map((c) => ({ value: c, label: c })),
          ]}
          onChange={setCountry}
        />
        <Dropdown
          chip
          label="Source"
          value={source}
          options={[
            { value: '', label: 'All sources' },
            ...(data?.sources ?? []).map((c) => ({ value: c, label: c })),
          ]}
          onChange={setSource}
        />
        <Dropdown
          chip
          label="Measure"
          value={measure}
          options={[
            { value: 'revenue', label: 'Revenue per customer' },
            { value: 'profit', label: 'Profit per customer' },
          ]}
          onChange={(v) => setMeasure(v as Measure)}
        />
      </FilterBar>
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="customers" />}
      {data && (
        <div
          aria-busy={loading}
          style={{
            opacity: loading ? 0.6 : 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <LtvNotices data={data} />
          {!data.customerDataMissing && <LtvKpis data={data} measure={measure} />}
          {data.cohorts.length > 0 && (
            <>
              <CohortGrid data={data} measure={measure} />
              <RatioCard data={data} />
            </>
          )}
        </div>
      )}
    </>
  );
}

function LtvNotices({ data }: { data: LtvResponse }) {
  const total = data.orders.withCustomer + data.orders.withoutCustomer;
  return (
    <>
      {data.customerDataMissing && (
        <s-banner tone="warning" heading="Customers have not been imported yet">
          <s-paragraph>
            Lifetime value needs to know which orders belong to the same customer. No order has that
            yet. Approve the customer permission when Shopify asks, then import your orders again
            from Settings, Store and data. Only a one-way key is stored: no name, email, phone or
            address.
          </s-paragraph>
        </s-banner>
      )}
      {!data.customerDataMissing && data.orders.withoutCustomer > 0 && total > 0 && (
        <s-banner tone="info">
          <s-paragraph>
            {data.orders.withoutCustomer} of {total} orders in this period have no customer (guest
            checkout) and are not in these figures.
          </s-paragraph>
        </s-banner>
      )}
      {!data.customerDataMissing && (
        <s-text color="subdued">
          Based on the last {data.historyDays} days of imported orders. A customer who first bought
          before that appears as new in the first month, so the oldest month is less reliable.
          Revenue and profit are per customer to date; profit is before advertising.
          {data.adFxGap ? ' Some ad spend has no exchange rate yet and is left out of CAC.' : ''}
        </s-text>
      )}
    </>
  );
}

function LtvKpis({ data, measure }: { data: LtvResponse; measure: Measure }) {
  const k = data.kpis;
  const cur = data.currency;
  const value = measure === 'profit' ? k.profitLtv : k.ltv;
  return (
    <StatGrid minWidth={170}>
      <StatCard
        label="Customers"
        value={String(k.customers)}
        note="First ordered in these months"
        info="Customers whose first imported order is in the months shown. Each is counted once."
      />
      <StatCard
        label="Repurchase rate"
        value={k.repurchaseRate === null ? '—' : formatPercent(k.repurchaseRate, 1)}
        note="Ordered more than once"
        info="The share of these customers with two or more counted orders."
      />
      <StatCard
        label="Revenue"
        value={formatMoney(k.revenue, cur)}
        note="From these customers to date"
      />
      <StatCard
        label={measure === 'profit' ? 'Profit per customer' : 'LTV'}
        value={value === null ? '—' : formatMoney(value, cur)}
        note={measure === 'profit' ? 'Before advertising' : 'Revenue per customer to date'}
        info="Lifetime value so far: what the average customer in these months has brought in. It grows as customers come back."
      />
      <StatCard
        label="CAC"
        value={k.cac === null ? '—' : formatMoney(k.cac, cur)}
        note={k.cac === null ? 'No ad spend in these months' : 'Ad spend per new customer'}
        info="Customer acquisition cost: all the ad spend of the month divided by the new customers of that month. It is blended: it does not know which customers came from ads."
      />
      <StatCard
        label="LTV:CAC"
        value={ratioText(k.ratio)}
        note="Revenue per customer to cost to win one"
        info="How many times a customer's revenue to date pays back what it cost to win them. Under 1 means they have not paid back yet; 3 or more is usually healthy."
      />
    </StatGrid>
  );
}

/** Blue gets darker with the value, like a heat map; the last cell of a row is the cohort's value to date. */
function heat(value: number, max: number): { background: string; color: string } {
  const t = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return {
    background: `rgba(0, 91, 211, ${(0.08 + t * 0.72).toFixed(2)})`,
    color: t > 0.55 ? '#ffffff' : '#1a1a1a',
  };
}

function CohortGrid({ data, measure }: { data: LtvResponse; measure: Measure }) {
  const cur = data.currency;
  const pick = (c: LtvCohort['cumulative'][number]) =>
    Number(measure === 'profit' ? c.profitLtv : c.ltv);
  const columns = Math.max(0, ...data.cohorts.map((c) => c.cumulative.length));
  const max = Math.max(0, ...data.cohorts.flatMap((c) => c.cumulative.map(pick)));
  const cell = {
    padding: '0.5rem 0.75rem',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  };
  return (
    <s-section>
      <s-stack gap="small">
        <CardHeader title="Lifetime value" />
        <s-text color="subdued">
          {measure === 'profit' ? 'Profit' : 'Revenue'} per customer, added up month by month since
          the first order. Each row is the customers who first ordered in that month.
        </s-text>
        <ScrollTable>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', width: '100%' }}>
            <thead>
              <tr>
                <th
                  style={{
                    ...cell,
                    textAlign: 'left',
                    position: 'sticky',
                    left: 0,
                    background: '#f7f7f7',
                  }}
                >
                  First purchase in
                </th>
                {Array.from({ length: columns }, (_, i) => (
                  <th key={i} style={{ ...cell, background: '#f7f7f7' }}>
                    {nth(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.month}>
                  <th
                    scope="row"
                    style={{
                      ...cell,
                      textAlign: 'left',
                      position: 'sticky',
                      left: 0,
                      background: '#ffffff',
                      fontWeight: 500,
                    }}
                  >
                    {monthLabel(c.month)}
                    <div style={{ color: '#616161', fontWeight: 400 }}>
                      {c.customers} {c.customers === 1 ? 'customer' : 'customers'}
                    </div>
                  </th>
                  {c.cumulative.map((v, i) => (
                    <td key={i} style={{ ...cell, ...heat(pick(v), max) }}>
                      {formatMoney(measure === 'profit' ? v.profitLtv : v.ltv, cur)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </s-stack>
    </s-section>
  );
}

function RatioCard({ data }: { data: LtvResponse }) {
  const cur = data.currency;
  const rows = data.cohorts.map((c) => ({
    name: monthLabel(c.month),
    LTV: Number(c.ltv ?? 0),
    CAC: c.cac === null ? null : Number(c.cac),
    Ratio: c.ratio === null ? null : Number(c.ratio),
  }));
  const th = {
    padding: '0.5rem 0.75rem',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  };
  const line = (label: string, f: (c: LtvCohort) => string) => (
    <tr>
      <th scope="row" style={{ ...th, textAlign: 'left', fontWeight: 500 }}>
        {label}
      </th>
      {data.cohorts.map((c) => (
        <td key={c.month} style={th}>
          {f(c)}
        </td>
      ))}
    </tr>
  );
  return (
    <s-section>
      <s-stack gap="small">
        <CardHeader title="LTV:CAC ratio" />
        <div
          role="img"
          aria-label="Lifetime value, customer acquisition cost and their ratio for each first-purchase month. A table version is below."
          style={{ width: '100%', height: 280 }}
        >
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="money"
                tickFormatter={(v: number) => formatMoneyCompact(v, cur)}
                width={56}
                tick={{ fontSize: 11 }}
              />
              <YAxis yAxisId="ratio" orientation="right" width={40} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v, name) =>
                  v === null || v === undefined
                    ? '—'
                    : name === 'LTV:CAC'
                      ? `${Number(v).toFixed(2)} : 1`
                      : formatMoney(String(v), cur)
                }
              />
              <Legend />
              <Bar
                yAxisId="money"
                dataKey="LTV"
                name="Lifetime value (LTV)"
                fill={CHART.revenue}
                isAnimationActive={false}
                maxBarSize={28}
              />
              <Bar
                yAxisId="money"
                dataKey="CAC"
                name="Cost to win a customer (CAC)"
                fill={CHART.spend}
                isAnimationActive={false}
                maxBarSize={28}
              />
              <Line
                yAxisId="ratio"
                dataKey="Ratio"
                name="LTV:CAC"
                stroke={CHART.operating}
                strokeWidth={2}
                dot
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ScrollTable>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', background: '#f7f7f7' }}>
                  First purchase in
                </th>
                {data.cohorts.map((c) => (
                  <th key={c.month} style={{ ...th, background: '#f7f7f7' }}>
                    {monthLabel(c.month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {line('New customers', (c) => String(c.customers))}
              {line('Repurchase rate', (c) => formatPercent(c.repurchaseRate, 0))}
              {line('Revenue', (c) => formatMoney(c.revenue, cur))}
              {line('LTV', (c) => formatMoney(c.ltv, cur))}
              {line('Ad spend', (c) => (c.adSpend === null ? '—' : formatMoney(c.adSpend, cur)))}
              {line('CAC', (c) => (c.cac === null ? '—' : formatMoney(c.cac, cur)))}
              {line('LTV:CAC', (c) => ratioText(c.ratio))}
            </tbody>
          </table>
        </ScrollTable>
      </s-stack>
    </s-section>
  );
}
