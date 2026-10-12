'use client';

import type { ReactNode } from 'react';
import type { OverviewResponse, PeriodPreset } from '@pi/contracts';
import { describeFreshness } from '../../lib/freshness';
import { periodLabel } from '../../lib/format';
import { PeriodDropdown } from '../dropdown';
import { CostBreakdownCard } from './CostBreakdownCard';
import { DataQualityCard } from './DataQualityCard';
import { MarketingSummaryCard } from '../marketing/MarketingSummaryCard';
import { ExpensesSummaryCard } from './ExpensesSummaryCard';
import { KpiCards } from './KpiCards';
import { ProfitBreakdown } from './ProfitBreakdown';
import { TrendSection } from './TrendCard';
import { WhatChangedCard } from './WhatChangedCard';

export interface Filters {
  preset: PeriodPreset;
  from: string;
  to: string;
}

export function FilterBar({
  filters,
  onChange,
  children,
  chip,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** more controls that belong in the same row (search, show, sort) */
  children?: ReactNode;
  /** compact left-aligned controls, instead of a full-width labeled row */
  chip?: boolean;
}) {
  const period = (
    <PeriodDropdown
      chip={chip}
      value={filters.preset}
      onChange={(preset) => onChange({ ...filters, preset })}
    />
  );
  const dates = filters.preset === 'custom' && (
    <>
      <div style={{ width: '11rem' }}>
        <s-date-field
          label="From"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.currentTarget.value })}
        />
      </div>
      <div style={{ width: '11rem' }}>
        <s-date-field
          label="To"
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.currentTarget.value })}
        />
      </div>
    </>
  );
  if (chip) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        {period}
        {dates}
        {children}
      </div>
    );
  }

  return (
    <s-section>
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
        gap="base"
        alignItems="end"
      >
        {period}
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
        {children}
      </s-grid>
    </s-section>
  );
}

export function OverviewView({
  data,
  topSelling,
  recentOrders,
  topReturned,
  after,
}: {
  data: OverviewResponse;
  /** lists loaded beside the overview (kept out of this component so it needs only `data`) */
  topSelling?: ReactNode;
  recentOrders?: ReactNode;
  topReturned?: ReactNode;
  /** what follows the breakdown: opportunities, secondary figures */
  after?: ReactNode;
}) {
  const { summary } = data;
  const empty = summary.orders === 0;
  const periodText = periodLabel(data.period.from, data.period.to);
  const freshness = describeFreshness(data.freshness, data.period, new Date());

  return (
    <>
      {data.currency.note && (
        <s-banner tone="info">
          <s-paragraph>{data.currency.note}</s-paragraph>
        </s-banner>
      )}
      {freshness.detail && freshness.tone !== 'success' && (
        <s-banner
          tone={
            freshness.tone === 'critical'
              ? 'critical'
              : freshness.tone === 'caution'
                ? 'warning'
                : 'info'
          }
        >
          <s-paragraph>{`${freshness.badge}. ${freshness.detail}`}</s-paragraph>
        </s-banner>
      )}
      {empty ? (
        <>
          <s-section>
            <s-empty-state heading="No paid orders in this period">
              <s-paragraph>
                {periodText}. Try a longer period, or re-sync if you expected orders here.
              </s-paragraph>
            </s-empty-state>
          </s-section>
          {data.issues.length > 0 && (
            <DataQualityCard quality={data.dataQuality} issues={data.issues} />
          )}
        </>
      ) : (
        <>
          <KpiCards data={data} />

          <MarketingSummaryCard period={data.period} currency={data.currency.code} />

          <ExpensesSummaryCard data={data} />

          <WhatChangedCard data={data} />

          <TrendSection page={data} />

          {/* three cards of the same height; they wrap to fewer columns on a narrower page */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 21.25rem), 1fr))',
              gap: '1rem',
              alignItems: 'stretch',
            }}
          >
            {topSelling}
            {topReturned}
            {recentOrders}
            <CostBreakdownCard page={data} />
          </div>

          <DataQualityCard quality={data.dataQuality} issues={data.issues} />
          <ProfitBreakdown data={data} />
          {after}
        </>
      )}
    </>
  );
}

/** Placeholder cards while the first figures load, so no zero is shown before the real number. */
export function OverviewSkeleton() {
  return (
    <s-stack gap="base">
      <s-text color="subdued" accessibilityVisibility="exclusive">
        Loading your profit overview…
      </s-text>
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(13.75rem, 1fr))" gap="base">
        {['Revenue', 'Costs', 'Contribution profit', 'Contribution margin'].map((label) => (
          <s-section key={label}>
            <s-stack gap="small-300">
              <s-text color="subdued">{label}</s-text>
              <s-box background="strong" borderRadius="base" blockSize="22px" inlineSize="60%" />
              <s-box background="subdued" borderRadius="base" blockSize="13px" inlineSize="80%" />
            </s-stack>
          </s-section>
        ))}
      </s-grid>
      <s-section>
        <s-box background="subdued" borderRadius="base" blockSize="176px" />
      </s-section>
    </s-stack>
  );
}
