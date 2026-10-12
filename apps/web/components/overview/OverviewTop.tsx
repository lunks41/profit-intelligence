'use client';

import type { ReactNode } from 'react';
import type { MarketingResponse, OverviewResponse } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { Card } from '../common';
import { CardHeader } from '../common/CardHeader';
import { Kpi } from '../common/kpi';
import { LabelValueRow } from '../common/label-value-row';
import { AdAccountsCard } from '../marketing/AdAccountsCard';
import { useApi } from '../profitability/shared';
import { ChannelDonut } from './ChannelDonut';
import { overviewKpis } from './KpiCards';
import { TrendCard } from './TrendCard';

const cell = (area: string, children: ReactNode) => (
  <div style={{ gridArea: area }}>{children}</div>
);

/**
 * The main screen of the Overview, in the order of the sketch: the profit that is left, the four headline figures,
 * what was spent on expenses and ads, the connected ad accounts, the trend, sales by channel and the product and
 * order lists. Anything that does not fit here is lower on the page.
 */
export function OverviewTop({
  data,
  topSelling,
  topReturned,
  recentOrders,
}: {
  data: OverviewResponse;
  topSelling?: ReactNode;
  topReturned?: ReactNode;
  recentOrders?: ReactNode;
}) {
  const k = overviewKpis(data);
  return (
    <div className="pi-ov-top">
      {cell('net', <NetProfit data={data} />)}
      {cell('rev', k.revenue)}
      {cell('cost', k.costs)}
      {cell('cp', k.profit)}
      {cell('cm', k.margin)}
      {cell('exp', <ExpensesTile data={data} />)}
      {cell('ads', <AdsTile data={data} />)}
      {cell('acc', <ConnectedAccounts data={data} />)}
      {cell('trend', <TrendCard page={data} />)}
      {cell('chan', <ChannelDonut page={data} />)}
      {topSelling && cell('top', topSelling)}
      {topReturned && cell('ret', topReturned)}
      {recentOrders && cell('rec', recentOrders)}
    </div>
  );
}

/** What is left after everything: contribution profit, less advertising and operating expenses. */
function NetProfit({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const profit = s.estimatedOperatingProfit;
  const money = (v: string | null) => (v === null ? '—' : formatMoney(v, cur));
  return (
    <Kpi
      large
      icon="chart-vertical"
      label="Net profit"
      value={profit === null ? '—' : formatMoney(profit, cur)}
      info="What is left of revenue after product cost, payment fees, shipping, advertising and operating expenses. It is an estimate while any cost is estimated or missing, and it needs expenses to be set up."
      change={
        s.operatingMargin === null ? (
          <s-text color="subdued">Add expenses to see it</s-text>
        ) : (
          <s-text color="subdued">{formatPercent(s.operatingMargin)} of revenue</s-text>
        )
      }
      notes={
        <s-stack gap="small-300">
          <LabelValueRow label="Contribution profit" value={money(s.contributionProfit)} />
          <LabelValueRow label="less Advertising" value={money(s.adSpend)} />
          <LabelValueRow label="less Operating expenses" value={money(s.operatingExpenses)} />
          <LabelValueRow label="Net profit" value={money(profit)} strong />
          {s.operatingExpenses === null && <s-link href="/expenses">Add expenses</s-link>}
          {s.partial && <s-badge tone="caution">Partial: some costs missing</s-badge>}
        </s-stack>
      }
    />
  );
}

function ExpensesTile({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  return (
    <Kpi
      icon="wallet"
      label="All expenses"
      value={s.operatingExpenses === null ? '—' : formatMoney(s.operatingExpenses, cur)}
      info="Rent, salaries, software and other operating expenses for the period. Advertising is shown apart, and product cost, fees and shipping are already in Costs."
      change={
        <s-link href="/expenses">
          {s.operatingExpenses === null ? 'Add expenses' : 'Open Expenses'}
        </s-link>
      }
    />
  );
}

function AdsTile({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  return (
    <Kpi
      icon="receipt"
      label="All ads"
      value={s.adSpend === null ? '—' : formatMoney(s.adSpend, cur)}
      info="Advertising spend imported or entered for the period. It comes off contribution profit on the way to net profit."
      change={
        <s-link href="/marketing">
          {s.adSpend === null ? 'Connect ad accounts' : 'Open Marketing'}
        </s-link>
      }
    />
  );
}

/** The ad accounts with their logos, or an invitation to connect one. */
function ConnectedAccounts({ data }: { data: OverviewResponse }) {
  const q = new URLSearchParams({
    preset: 'custom',
    from: data.period.from,
    to: data.period.to,
    currency: data.currency.code,
  });
  const { data: marketing } = useApi<MarketingResponse>(`/marketing/overview?${q}`);
  const connected = marketing?.accounts.some((a) => a.status !== 'disconnected');
  if (marketing && connected) return <AdAccountsCard data={marketing} limit={3} />;
  return (
    <Card>
      <CardHeader
        title="Connected ad accounts"
        action={
          <s-button variant="secondary" href="/marketing">
            {marketing ? 'Connect' : 'Open'}
          </s-button>
        }
      />
      <s-text color="subdued">
        {marketing
          ? 'No ad account is connected. Connect Meta, Google or TikTok to see what advertising costs and what is left after it.'
          : 'Loading…'}
      </s-text>
    </Card>
  );
}
