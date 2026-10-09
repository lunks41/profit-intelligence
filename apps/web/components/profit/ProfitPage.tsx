'use client';

import { useState } from 'react';
import type {
  FindingResponse,
  LeakageResponse,
  OverviewResponse,
  PeriodPreset,
  ReportTableResponse,
} from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { QualifiersBanner } from '../common';
import { SampleBars } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { ReportTable } from '../reports/ReportTable';
import { StatCard, StatGrid } from '../common';

type Tab = 'statement' | 'trend' | 'leakage' | 'quality';
const today = () => new Date().toISOString().slice(0, 10);
const QUALITY_RULES = new Set(['missing_costs', 'missing_fees', 'missing_shipping_cost']);

export function ProfitPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
    currency: null,
  });
  const [tab, setTab] = useState<Tab>('statement');
  const query = buildListQuery(filters, {});

  const overview = useApi<OverviewResponse>(`/dashboard/overview?${query}`);
  const leakage = useApi<LeakageResponse>(`/leakage?${query}`);
  const pnl = useApi<ReportTableResponse>(`/reports/preview?kind=profit_loss&${query}`);

  const money = leakage.data?.findings.filter((f) => !QUALITY_RULES.has(f.id)) ?? [];
  const quality = leakage.data?.findings.filter((f) => QUALITY_RULES.has(f.id)) ?? [];
  const serious = money.filter((f) => f.severity !== 'info').length;

  return (
    <>
      <FilterBar filters={filters} currencies={[]} onChange={setFilters} />
      {overview.data && <Kpis data={overview.data} />}
      {overview.data && <QualifiersBanner qualifiers={overview.data.summary.qualifiers} />}
      <s-stack direction="inline" gap="small">
        {(
          [
            ['statement', 'Profit and loss'],
            ['trend', 'Monthly trend'],
            ['leakage', `Profit leakage${serious > 0 ? ` (${serious})` : ''}`],
            ['quality', `Data quality${quality.length > 0 ? ` (${quality.length})` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <s-button
            key={id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </s-button>
        ))}
      </s-stack>

      {tab === 'statement' && (
        <>
          {pnl.error && <ErrorBanner message={pnl.error} onRetry={() => void pnl.reload()} />}
          {pnl.loading && !pnl.data && <Loading what="the profit and loss" />}
          {pnl.data && <ReportTable report={pnl.data} />}
        </>
      )}
      {tab === 'trend' && (
        <Trend pnl={pnl.data} loading={pnl.loading} error={pnl.error} reload={pnl.reload} />
      )}
      {tab === 'leakage' && (
        <Findings
          title="Profit leakage"
          empty="No profit leaks found in this period."
          data={leakage.data}
          findings={money}
          loading={leakage.loading}
          error={leakage.error}
          reload={leakage.reload}
          planLimited={leakage.errorCode === 'plan_limit'}
        />
      )}
      {tab === 'quality' && (
        <>
          {overview.data && <Coverage data={overview.data} />}
          <Findings
            title="Data quality"
            empty="Nothing is missing that stops your figures from being trusted."
            data={leakage.data}
            findings={quality}
            loading={leakage.loading}
            error={leakage.error}
            reload={leakage.reload}
            planLimited={leakage.errorCode === 'plan_limit'}
          />
        </>
      )}
    </>
  );
}

function Kpis({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  return (
    <StatGrid>
      <StatCard label="Revenue" value={formatMoney(s.revenue, cur)} />
      <StatCard
        label="Contribution profit"
        value={formatMoney(s.contributionProfit, cur)}
        note={s.partial ? 'Partial: some costs missing' : undefined}
      />
      <StatCard label="Contribution margin" value={formatPercent(s.contributionMargin)} />
      <StatCard
        label="Estimated net profit"
        value={s.estimatedNetProfit === null ? '—' : formatMoney(s.estimatedNetProfit, cur)}
        note={
          s.estimatedNetProfit === null
            ? 'Add operating expenses to see it'
            : s.statuses?.estimatedNetProfit === 'estimated'
              ? 'Estimate: some inputs are missing or estimated'
              : 'After advertising and expenses'
        }
      />
    </StatGrid>
  );
}

function Trend({
  pnl,
  loading,
  error,
  reload,
}: {
  pnl: ReportTableResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}) {
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !pnl) return <Loading what="the trend" />;
  if (!pnl) return null;
  const all = [...pnl.rows, ...pnl.totalRows];
  const line = (label: string) => all.find((r) => r[0] === label);
  const months = pnl.columns.slice(1).filter((c) => c.label !== 'Total');
  const revenue = line('Revenue');
  const profit = line('Contribution profit');
  const net = line('Estimated net profit');
  if (!revenue || !profit || !net) return null;
  const data = months.map((m, i) => ({
    name: m.label,
    Revenue: Number(revenue[i + 1]),
    'Contribution profit': Number(profit[i + 1]),
    'Net profit': Number(net[i + 1]),
  }));
  return (
    <s-section heading="Revenue and profit by month">
      <SampleBars
        data={data}
        keys={[
          { key: 'Revenue', name: 'Revenue', color: '#005bd3' },
          { key: 'Contribution profit', name: 'Contribution profit', color: '#047b5d' },
          { key: 'Net profit', name: 'Net profit', color: '#b98900' },
        ]}
      />
      <s-text color="subdued">
        Calendar months in your store time zone. The first and last month may be partial.
      </s-text>
    </s-section>
  );
}

function Coverage({ data }: { data: OverviewResponse }) {
  const c = data.summary.confidence.components;
  const rows: Array<
    [string, { shares: { actual: string; estimated: string; missing: string } } | undefined]
  > = [
    ['Product costs', c.cost],
    ['Payment fees', c.fees],
    ['Shipping costs', c.shipping],
  ];
  return (
    <s-section heading="How complete your data is">
      <s-stack gap="small">
        <s-text>
          Profit confidence is{' '}
          <s-text type="strong">{data.summary.confidence.band ?? 'not available yet'}</s-text>
          {data.summary.confidence.score !== null
            ? ` (score ${formatPercent(data.summary.confidence.score, 0)})`
            : ''}
          .
        </s-text>
        {rows.map(([label, v]) => (
          <s-text key={label}>
            {label}:{' '}
            {v
              ? `${formatPercent(v.shares.actual, 0)} confirmed, ${formatPercent(v.shares.estimated, 0)} estimated, ${formatPercent(v.shares.missing, 0)} missing`
              : 'not tracked yet'}
          </s-text>
        ))}
      </s-stack>
    </s-section>
  );
}

const TONE = { critical: 'critical', warning: 'warning', info: 'info' } as const;

function Findings({
  title,
  empty,
  data,
  findings,
  loading,
  error,
  reload,
  planLimited,
}: {
  title: string;
  empty: string;
  data: LeakageResponse | null;
  findings: FindingResponse[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  planLimited: boolean;
}) {
  if (planLimited) {
    return (
      <s-banner tone="info" heading="Not part of your plan">
        <s-stack gap="small-300">
          <s-paragraph>{error}</s-paragraph>
          <s-link href="/settings">See plans</s-link>
        </s-stack>
      </s-banner>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <Loading what="findings" />;
  if (!data) return null;
  const cur = data.currency;
  return (
    <s-section heading={title}>
      <s-stack gap="base">
        {findings.length === 0 && (
          <s-stack gap="small-300">
            <s-text>{empty}</s-text>
            <s-text color="subdued">
              Checked {data.checked.orders} orders and {data.checked.products} products against your
              limits (margin {Number(data.limits.marginPct)}%, refunds{' '}
              {Number(data.limits.refundRatePct)}%).
              {data.checked.orders < 10
                ? ' With fewer than 10 orders most checks are not applied.'
                : ''}
            </s-text>
          </s-stack>
        )}
        {findings.map((f) => (
          <s-banner key={f.id} tone={TONE[f.severity]} heading={f.title}>
            <s-stack gap="small-300">
              <s-text>{f.evidence}</s-text>
              <s-text color="subdued">Why it matters: {f.why}</s-text>
              {f.impact && (
                <s-text>
                  Money involved: <s-text type="strong">{formatMoney(f.impact.amount, cur)}</s-text>
                  . {f.impact.note}
                </s-text>
              )}
              {f.items.length > 0 && (
                <ul style={{ margin: '4px 0', paddingInlineStart: 20 }}>
                  {f.items.map((i) => (
                    <li key={`${i.label}-${i.detail}`}>
                      {i.label}: {i.detail}
                    </li>
                  ))}
                </ul>
              )}
              {f.disclosure && <s-text color="subdued">{f.disclosure}</s-text>}
              {f.action && <s-link href={f.action.href}>{f.action.label}</s-link>}
            </s-stack>
          </s-banner>
        ))}
      </s-stack>
    </s-section>
  );
}
