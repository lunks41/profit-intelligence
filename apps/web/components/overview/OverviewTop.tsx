'use client';

import type { ReactNode } from 'react';
import type { MarketingResponse, OverviewResponse } from '@pi/contracts';
import { formatCount, formatMoney, formatPercent } from '../../lib/format';
import { Card } from '../common';
import { CardHeader } from '../common/CardHeader';
import { FigureTile, TILE_COLOR } from '../common/FigureTile';
import { Masonry } from '../common/Masonry';
import { AdAccountsCard } from '../marketing/AdAccountsCard';
import { MarketingSummaryCard } from '../marketing/MarketingSummaryCard';
import { useApi } from '../profitability/shared';
import { sparkSeries } from '../../lib/series';
import { ChannelDonut } from './ChannelDonut';
import { CostBreakdownCard } from './CostBreakdownCard';
import { overviewKpis } from './KpiCards';
import { MoneyFlow } from './MoneyFlow';
import { Reminders } from './Reminders';
import { TrendCard } from './TrendCard';

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
}: {
  data: OverviewResponse;
  topSelling?: ReactNode;
  topReturned?: ReactNode;
  recentOrders?: ReactNode;
}) {
  const k = overviewKpis(data);
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
          <MoreTiles data={data} />
        </div>

        <div className="pi-split-60-40">
          <TrendCard page={data} />
          <ChannelDonut page={data} />
        </div>

        <Masonry min="28rem">
          <Reminders data={data} />
          <MoneyFlow data={data} />
          <ConnectedAccounts data={data} />
          <CostBreakdownCard page={data} />
          <MarketingSummaryCard
            period={data.period}
            currency={data.currency.code}
            showSpend={false}
            showAccounts={false}
          />
        </Masonry>

        <Masonry min="38rem">
          {topSelling}
          {topReturned}
          {recentOrders}
        </Masonry>
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

/** Eight more figures of the period, each as plain as All ads and All expenses: what it is and what it comes to. */
function MoreTiles({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const money = (v: string) => formatMoney(v.replace(/^-/, ''), cur);
  const revenue = Number(s.revenue);
  const share = (v: string) =>
    revenue > 0 ? `${formatPercent(Math.abs(Number(v)) / revenue)} of revenue` : undefined;
  const perDay = data.period.days > 0 ? s.orders / data.period.days : 0;
  return (
    <>
      <FigureTile
        label="Orders"
        value={formatCount(s.orders)}
        color={TILE_COLOR.revenue}
        info="Orders counted in profit for the period."
        detail={`${perDay.toFixed(1)} a day`}
        spark={data.trend.map((t) => t.orders)}
      />
      <FigureTile
        label="Average order"
        value={s.averageOrderValue === null ? '—' : formatMoney(s.averageOrderValue, cur)}
        color={TILE_COLOR.revenue}
        info="Revenue divided by orders."
        detail="Revenue per order"
      />
      <FigureTile
        label="Gross sales"
        value={money(s.grossSales)}
        color={TILE_COLOR.revenue}
        info="Product sales before discounts and refunds."
        detail="Before discounts"
      />
      <FigureTile
        label="Discounts"
        value={money(s.discounts)}
        color={TILE_COLOR.expenses}
        info="Discounts given to customers."
        detail={share(s.discounts) ?? 'Given to customers'}
      />
      <FigureTile
        label="Refunds"
        value={money(s.productRefunds)}
        color={TILE_COLOR.costs}
        info="Product money refunded in the period."
        detail={`${formatPercent(s.refundRate)} of sales refunded`}
      />
      <FigureTile
        label="Product cost"
        value={money(s.cogs)}
        color={TILE_COLOR.costs}
        info="What the products you sold cost you."
        detail={share(s.cogs) ?? 'Cost of goods sold'}
      />
      <FigureTile
        label="Payment fees"
        value={money(s.paymentFees)}
        color={TILE_COLOR.expenses}
        info="Fees charged on payments, reported by Shopify or estimated from your fee rule."
        detail={share(s.paymentFees) ?? 'On payments'}
      />
      <FigureTile
        label="Shipping cost"
        value={money(s.shippingCost)}
        color={TILE_COLOR.margin}
        info="What you pay to ship the orders."
        detail={share(s.shippingCost) ?? 'To ship orders'}
      />
    </>
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
