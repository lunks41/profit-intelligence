'use client';

import type { ReactNode } from 'react';
import type { Alert, OverviewResponse, PeriodPreset } from '@pi/contracts';
import {
  describeBand,
  describeDelta,
  describePoints,
  formatCount,
  formatMoney,
  formatPercent,
  periodLabel,
  type Delta,
} from '../../lib/format';
import { CurrencyDropdown, PeriodDropdown } from '../dropdown';
import { LabelValueRow, QualifiersBanner, StatCard, StatGrid } from '../common';
import { TrendChart } from './TrendChart';

export interface Filters {
  preset: PeriodPreset;
  from: string;
  to: string;
  currency: string | null;
}

export function FilterBar({
  filters,
  currencies,
  onChange,
  children,
}: {
  filters: Filters;
  currencies: string[];
  onChange: (next: Filters) => void;
  /** more controls that belong in the same row (search, show, sort) */
  children?: ReactNode;
}) {
  return (
    <s-section>
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
        gap="base"
        alignItems="end"
      >
        <PeriodDropdown
          value={filters.preset}
          onChange={(preset) => onChange({ ...filters, preset })}
        />
        {filters.preset === 'custom' && (
          <>
            <s-date-field
              label="From"
              value={filters.from}
              onChange={(e) => onChange({ ...filters, from: e.currentTarget.value })}
            />
            <s-date-field
              label="To"
              value={filters.to}
              onChange={(e) => onChange({ ...filters, to: e.currentTarget.value })}
            />
          </>
        )}
        {currencies.length > 1 && (
          <CurrencyDropdown
            value={filters.currency ?? currencies[0]!}
            currencies={currencies}
            onChange={(currency) => onChange({ ...filters, currency })}
          />
        )}
        {children}
      </s-grid>
    </s-section>
  );
}

function DeltaText({ delta, goodWhenUp = true }: { delta: Delta; goodWhenUp?: boolean }) {
  const tone =
    delta.direction === 'none' || delta.direction === 'flat'
      ? 'subdued'
      : (delta.direction === 'up') === goodWhenUp
        ? 'success'
        : 'critical';
  const arrow = delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : '';
  return (
    <s-text tone={tone === 'subdued' ? 'neutral' : tone}>
      {arrow}
      {delta.text}
      {delta.direction !== 'none' ? ' vs previous period' : ''}
    </s-text>
  );
}

function Kpi({
  label,
  value,
  delta,
  note,
}: {
  label: string;
  value: string;
  delta: Delta;
  note?: string | null;
}) {
  return (
    <StatCard label={label} value={value}>
      <DeltaText delta={delta} />
      {note && <s-badge tone="caution">{note}</s-badge>}
    </StatCard>
  );
}

function ConfidenceCard({ data }: { data: OverviewResponse }) {
  const { confidence } = data.summary;
  const band = describeBand(confidence.band);
  const rows: Array<{ key: 'cost' | 'fees' | 'shipping'; label: string }> = [
    { key: 'cost', label: 'Product costs' },
    { key: 'fees', label: 'Payment fees' },
    { key: 'shipping', label: 'Shipping costs' },
  ];
  return (
    <s-section heading="Profit confidence">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={band.tone}>{band.label}</s-badge>
          {confidence.score !== null && (
            <s-text color="subdued">score {formatPercent(confidence.score, 0)}</s-text>
          )}
        </s-stack>
        <s-text color="subdued">
          Confidence shows how much of this profit rests on costs you have confirmed, rather than
          estimates or gaps.
        </s-text>
        {rows.map(({ key, label }) => {
          const c = confidence.components[key];
          if (!c) {
            return (
              <s-text key={key} color="subdued">
                {label}: not tracked yet
              </s-text>
            );
          }
          return (
            <s-stack key={key} gap="small-300">
              <s-text type="strong">{label}</s-text>
              <s-text>
                Confirmed {formatPercent(c.shares.actual, 0)} · Estimated{' '}
                {formatPercent(c.shares.estimated, 0)} · Missing{' '}
                {formatPercent(c.shares.missing, 0)}
              </s-text>
            </s-stack>
          );
        })}
      </s-stack>
    </s-section>
  );
}

const SEVERITY_TONE = { critical: 'critical', warning: 'warning', info: 'info' } as const;

function AlertItem({ alert }: { alert: Alert }) {
  return (
    <s-banner tone={SEVERITY_TONE[alert.severity]} heading={alert.title}>
      <s-stack gap="small-300">
        <s-text>{alert.evidence}</s-text>
        <s-text color="subdued">Why it matters: {alert.why}</s-text>
        {alert.action && <s-link href={alert.action.href}>{alert.action.label}</s-link>}
      </s-stack>
    </s-banner>
  );
}

export function OverviewView({ data }: { data: OverviewResponse }) {
  const cur = data.currency.code;
  const { summary, deltas } = data;
  const empty = summary.orders === 0;
  const marginNote = summary.partial ? 'Partial: some costs missing' : null;
  const periodText = periodLabel(data.period.from, data.period.to);

  return (
    <>
      {data.currency.note && (
        <s-banner tone="info">
          <s-paragraph>{data.currency.note}</s-paragraph>
        </s-banner>
      )}
      {data.alerts.length > 0 && (
        <s-section heading="Needs attention">
          <s-stack gap="base">
            {data.alerts.map((a) => (
              <AlertItem key={a.id} alert={a} />
            ))}
          </s-stack>
        </s-section>
      )}

      {empty ? (
        <s-section>
          <s-empty-state heading="No paid orders in this period">
            <s-paragraph>
              {periodText}. Try a longer period, or re-sync if you expected orders here.
            </s-paragraph>
          </s-empty-state>
        </s-section>
      ) : (
        <>
          <QualifiersBanner qualifiers={summary.qualifiers} />
          <StatGrid minWidth={220}>
            <Kpi
              label="Revenue"
              value={formatMoney(summary.revenue, cur)}
              delta={describeDelta(deltas.revenue)}
            />
            <Kpi
              label="Contribution profit"
              value={formatMoney(summary.contributionProfit, cur)}
              delta={describeDelta(deltas.contributionProfit)}
              note={marginNote}
            />
            <Kpi
              label="Contribution margin"
              value={formatPercent(summary.contributionMargin)}
              delta={describePoints(deltas.marginPoints)}
              note={marginNote}
            />
            <Kpi
              label="Orders"
              value={formatCount(summary.orders)}
              delta={describeDelta(deltas.orders)}
            />
            <Kpi
              label="Average order value"
              value={formatMoney(summary.averageOrderValue, cur)}
              delta={describeDelta(deltas.averageOrderValue)}
            />
          </StatGrid>

          <s-section heading="Revenue and contribution profit">
            <TrendChart trend={data.trend} currency={cur} />
          </s-section>

          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap="base">
            <ConfidenceCard data={data} />
            <s-section heading="Where the money goes">
              <s-stack gap="small-300">
                <LabelValueRow label="Revenue" value={formatMoney(summary.revenue, cur)} />
                <LabelValueRow label="Product costs" value={formatMoney(summary.cogs, cur)} />
                <LabelValueRow label="Payment fees" value={formatMoney(summary.paymentFees, cur)} />
                <LabelValueRow
                  label="Shipping costs"
                  value={formatMoney(summary.shippingCost, cur)}
                />
                <LabelValueRow
                  label="Contribution profit"
                  value={formatMoney(summary.contributionProfit, cur)}
                  strong
                />
                <LabelValueRow label="Refund rate" value={formatPercent(summary.refundRate)} />
              </s-stack>
            </s-section>
          </s-grid>
        </>
      )}

      {data.awaitingPayment.count > 0 && (
        <s-text color="subdued">
          {formatCount(data.awaitingPayment.count)} unpaid{' '}
          {data.awaitingPayment.count === 1 ? 'order' : 'orders'} (
          {formatMoney(data.awaitingPayment.amount, cur)}) are not counted until they are paid.
        </s-text>
      )}
    </>
  );
}

export function OverviewSkeleton() {
  return (
    <s-section>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-spinner accessibilityLabel="Loading overview" />
        <s-text>Loading your profit overview…</s-text>
      </s-stack>
    </s-section>
  );
}
