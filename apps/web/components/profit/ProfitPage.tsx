'use client';

import { useState, useEffect } from 'react';
import type {
  FindingResponse,
  LeakageResponse,
  OverviewResponse,
  PeriodPreset,
  ReportTableResponse,
} from '@pi/contracts';
import { describeDelta, describePoints, formatMoney, formatPercent } from '../../lib/format';
import { sparkSeries } from '../../lib/series';
import { buildListQuery } from '../../lib/query';
import { MonthlyPnl } from './MonthlyPnl';
import { DataQualityCard } from '../overview/DataQualityCard';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { describeFreshness } from '../../lib/freshness';
import { QualifiersBanner } from '../common';
import { SampleBars } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { ReportTable } from '../reports/ReportTable';
import { InfoTip } from '../common/info-tip';
import { Change, Kpi } from '../common/kpi';
import { readParam } from '../../lib/url-params';
import { todayInShop, prettyDates } from '../../lib/shop-time';
import { formatDateTime } from '../../lib/shop-time';

type Tab = 'statement' | 'monthly' | 'trend' | 'leakage' | 'quality';
const today = todayInShop;
const QUALITY_RULES = new Set(['missing_costs', 'missing_fees', 'missing_shipping_cost']);

export function ProfitPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
  });
  const [tab, setTab] = useState<Tab>('statement');
  useEffect(() => {
    const t = readParam('tab', ['statement', 'trend', 'leakage', 'quality'] as const);
    if (t) setTab(t);
  }, []);
  const query = buildListQuery(filters, {});

  const overview = useApi<OverviewResponse>(`/dashboard/overview?${query}`);
  const leakage = useApi<LeakageResponse>(`/leakage?${query}`);
  const pnl = useApi<ReportTableResponse>(`/reports/preview?kind=profit_loss&${query}`);

  const money = leakage.data?.findings.filter((f) => !QUALITY_RULES.has(f.id)) ?? [];
  const quality = leakage.data?.findings.filter((f) => QUALITY_RULES.has(f.id)) ?? [];
  const serious = money.filter((f) => f.severity !== 'info').length;

  return (
    <>
      <FilterBar chip filters={filters} onChange={setFilters}>
        {overview.data && <Freshness data={overview.data} />}
      </FilterBar>
      {overview.data?.currency.note && (
        <s-text color="subdued">{overview.data.currency.note}</s-text>
      )}
      {overview.data && <Kpis data={overview.data} />}
      {overview.data && <QualifiersBanner qualifiers={overview.data.summary.qualifiers} />}
      <s-stack direction="inline" gap="small">
        {(
          [
            ['statement', 'Profit and loss'],
            ['monthly', 'Monthly profit and loss'],
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
          {pnl.data && <ReportTable report={pnl.data} showType />}
        </>
      )}
      {tab === 'monthly' && <MonthlyPnl />}
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
          <Findings
            lead={overview.data && <Coverage data={overview.data} />}
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
      {overview.data && tab !== 'quality' && (
        <DataQualityCard quality={overview.data.dataQuality} issues={overview.data.issues} />
      )}
    </>
  );
}

function Freshness({ data }: { data: OverviewResponse }) {
  const view = describeFreshness(data.freshness, data.period, new Date());
  // a capsule level with the period dropdown: when the last import was and how old it is; the rest is in the tip
  const when = data.freshness.lastSuccessAt
    ? formatDateTime(data.freshness.lastSuccessAt)
    : 'never';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', minHeight: '28px' }}>
      <s-badge tone={view.tone}>{`Last import: ${when} · ${view.badge}`}</s-badge>
      {view.detail && <InfoTip label="About the last import" text={prettyDates(view.detail)} />}
    </div>
  );
}

function times(numerator: string, denominator: string | null): string {
  if (denominator === null) return '—';
  const den = Number(denominator);
  if (!den) return '—';
  return `${(Number(numerator) / den).toFixed(2)}x`;
}

function Kpis({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const spark = sparkSeries(data.trend);
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(15rem, 1fr))" gap="small">
      <Kpi
        icon="cart"
        label="Revenue"
        value={formatMoney(s.revenue, cur)}
        info="Sales after discounts and product refunds, plus shipping charged (net of shipping refunds). Tax is not included."
        change={
          <Change delta={describeDelta(data.deltas.revenue)} previous={data.previousPeriod} />
        }
        spark={spark.revenue}
      />
      <Kpi
        icon="chart-vertical"
        label="Contribution profit"
        value={formatMoney(s.contributionProfit, cur)}
        info="Revenue minus product cost, payment fees, shipping cost and advertising (when set up). Operating expenses are not taken off."
        change={
          <Change
            delta={describeDelta(data.deltas.contributionProfit)}
            previous={data.previousPeriod}
          />
        }
        notes={s.partial ? <s-badge tone="caution">Partial: some costs missing</s-badge> : null}
        spark={spark.profit}
      />
      <Kpi
        icon="discount"
        label="Contribution margin"
        value={formatPercent(s.contributionMargin)}
        info="Contribution profit divided by revenue."
        change={
          <Change delta={describePoints(data.deltas.marginPoints)} previous={data.previousPeriod} />
        }
        spark={spark.margin}
      />
      {s.adSpend !== null && (
        <Kpi
          icon="chart-vertical"
          label="Ad spend"
          value={formatMoney(s.adSpend, cur)}
          info="Spend imported for this period, in the display currency. Blended ROAS is revenue divided by that spend. POAS is contribution profit divided by that spend."
          change={
            <s-text color="subdued">
              ROAS {times(s.revenue, s.adSpend)} · POAS {times(s.contributionProfit, s.adSpend)}
            </s-text>
          }
        />
      )}
      <Kpi
        icon="target"
        label="Estimated operating profit"
        value={
          s.estimatedOperatingProfit === null ? '—' : formatMoney(s.estimatedOperatingProfit, cur)
        }
        info="Contribution profit minus advertising and other operating expenses. Shown only when operating expenses are set up, and called an estimate unless every input is confirmed."
        change={
          <s-text color="subdued">
            {s.estimatedOperatingProfit === null
              ? 'Add operating expenses to see it'
              : s.statuses?.estimatedOperatingProfit === 'estimated'
                ? 'Estimate: some inputs are missing or estimated'
                : 'After advertising and expenses'}
          </s-text>
        }
      />
    </s-grid>
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
  const net = line('Estimated operating profit');
  if (!revenue || !profit || !net) return null;
  const data = months.map((m, i) => ({
    name: m.label,
    Revenue: Number(revenue[i + 1]),
    'Contribution profit': Number(profit[i + 1]),
    'Operating profit': Number(net[i + 1]),
  }));
  return (
    <s-section heading="Revenue and profit by month">
      <SampleBars
        data={data}
        keys={[
          { key: 'Revenue', name: 'Revenue', color: '#005bd3' },
          { key: 'Contribution profit', name: 'Contribution profit', color: '#047b5d' },
          { key: 'Operating profit', name: 'Estimated operating profit', color: '#b98900' },
        ]}
      />
      <s-text color="subdued">
        Calendar months in your store time zone. The first and last month may be partial.
      </s-text>
    </s-section>
  );
}

/** How complete the figures are (confidence and the share of each cost that is confirmed, estimated or missing). */
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
  lead,
}: {
  /** shown first inside the same card (the completeness of the data) */
  lead?: React.ReactNode;
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
        {lead}
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
                      {i.label}: {prettyDates(i.detail)}
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
