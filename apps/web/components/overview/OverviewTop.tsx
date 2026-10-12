'use client';

import type { ReactNode } from 'react';
import type { MarketingResponse, OverviewResponse } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { Card } from '../common';
import { CardHeader } from '../common/CardHeader';
import { FigureTile, TILE_COLOR } from '../common/FigureTile';
import { AdAccountsCard } from '../marketing/AdAccountsCard';
import { MarketingSummaryCard } from '../marketing/MarketingSummaryCard';
import { useApi } from '../profitability/shared';
import { sparkSeries } from '../../lib/series';
import { ChannelDonut } from './ChannelDonut';
import { CostBreakdownCard } from './CostBreakdownCard';
import { DataQualityCard } from './DataQualityCard';
import { Highlights } from './Highlights';
import { overviewKpis } from './KpiCards';
import { MoneyFlow } from './MoneyFlow';
import { ProfitBreakdown } from './ProfitBreakdown';
import { Reminders } from './Reminders';
import { TrendCard } from './TrendCard';
import { WhatChangedCard } from './WhatChangedCard';

/**
 * The Overview as a few bands that follow one another with no blank space: the figures across the top, the trend
 * beside sales by channel, then cards that flow into balanced columns (a card goes under the one above it, never into
 * a row of its own), and the tables last, in balanced columns too. The number of columns follows the width of the
 * page, so a wide screen is full and a phone is one column.
 */
export function OverviewBoard({
  data,
  topSelling,
  topReturned,
  recentOrders,
  opportunities,
  insights,
}: {
  data: OverviewResponse;
  topSelling?: ReactNode;
  topReturned?: ReactNode;
  recentOrders?: ReactNode;
  opportunities?: ReactNode;
  insights?: ReactNode;
}) {
  const k = overviewKpis(data);
  const item = (node: ReactNode) => <div className="pi-mason-item">{node}</div>;
  return (
    <div className="pi-board-wrap">
      <div className="pi-board">
        <div className="pi-figures">
          <div className="pi-figures-hero">
            <NetProfit data={data} />
          </div>
          {k.revenue}
          {k.costs}
          {k.profit}
          {k.margin}
          <ExpensesTile data={data} />
          <AdsTile data={data} />
        </div>

        <div className="pi-split-60-40">
          <TrendCard page={data} />
          <ChannelDonut page={data} />
        </div>

        <div className="pi-mason pi-mason-narrow">
          {item(<Reminders data={data} />)}
          {item(<MoneyFlow data={data} />)}
          {item(<ConnectedAccounts data={data} />)}
          {item(<Highlights data={data} />)}
          {item(<CostBreakdownCard page={data} />)}
          {item(<WhatChangedCard data={data} />)}
          {item(opportunities)}
          {item(
            <MarketingSummaryCard
              period={data.period}
              currency={data.currency.code}
              showSpend={false}
              showAccounts={false}
            />,
          )}
        </div>

        <div className="pi-mason pi-mason-wide">
          {item(topSelling)}
          {item(topReturned)}
          {item(recentOrders)}
          {item(<ProfitBreakdown data={data} />)}
          {item(<DataQualityCard quality={data.dataQuality} issues={data.issues} />)}
          {item(insights)}
        </div>
      </div>
    </div>
  );
}

/** What is left after everything: contribution profit, less advertising and operating expenses. */
function NetProfit({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const profit = s.estimatedOperatingProfit;
  const money = (v: string | null) => (v === null ? '—' : formatMoney(v, cur));
  const spark = sparkSeries(data.trend);
  const row = (label: string, value: string, strong?: boolean) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '1rem',
        fontSize: '0.85rem',
        fontWeight: strong ? 700 : 400,
        borderTop: strong ? '1px solid #e3e3e3' : undefined,
        paddingTop: strong ? '0.3rem' : undefined,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <FigureTile
      hero
      label="Net profit"
      value={profit === null ? '—' : formatMoney(profit, cur)}
      color={TILE_COLOR.net}
      info="What is left of revenue after product cost, payment fees, shipping, advertising and operating expenses. It is an estimate while any cost is estimated or missing, and it needs expenses to be set up."
      detail={
        s.operatingMargin !== null ? (
          `${formatPercent(s.operatingMargin)} of revenue${s.partial ? '. Some costs are missing.' : ''}`
        ) : (
          <a href="/expenses" style={{ color: '#005bd3' }}>
            Add your expenses to see it
          </a>
        )
      }
      spark={spark.profit}
    >
      {row('Contribution profit', money(s.contributionProfit))}
      {row('less Advertising', money(s.adSpend))}
      {row('less Operating expenses', money(s.operatingExpenses))}
      {row('Net profit', money(profit), true)}
    </FigureTile>
  );
}

function ExpensesTile({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  return (
    <FigureTile
      label="All expenses"
      value={s.operatingExpenses === null ? '—' : formatMoney(s.operatingExpenses, cur)}
      color={TILE_COLOR.expenses}
      info="Rent, salaries, software and other operating expenses for the period. Advertising is shown apart, and product cost, fees and shipping are already in Costs."
      detail={
        <a href="/expenses" style={{ color: '#005bd3' }}>
          {s.operatingExpenses === null ? 'Add expenses' : 'Open Expenses'}
        </a>
      }
    />
  );
}

function AdsTile({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const roas =
    s.adSpend !== null && Number(s.adSpend) > 0 ? Number(s.revenue) / Number(s.adSpend) : null;
  return (
    <FigureTile
      label="All ads"
      value={s.adSpend === null ? '—' : formatMoney(s.adSpend, cur)}
      color={TILE_COLOR.ads}
      info="Advertising spend imported or entered for the period. It comes off contribution profit on the way to net profit."
      detail={
        s.adSpend === null ? (
          <a href="/marketing" style={{ color: '#005bd3' }}>
            Connect ad accounts
          </a>
        ) : roas === null ? (
          'No spend in this period'
        ) : (
          `${roas.toFixed(1)}x revenue per ad dollar`
        )
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
  if (marketing && connected) return <AdAccountsCard data={marketing} limit={4} />;
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
