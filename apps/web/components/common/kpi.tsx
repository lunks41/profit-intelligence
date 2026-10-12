'use client';

import type { ReactNode } from 'react';
import { shortDate, type Delta } from '../../lib/format';
import { InfoTip } from './info-tip';
import { Sparkline } from './sparkline';

const range = (from: string, to: string) =>
  from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;

export type KpiIcon =
  'cart' | 'wallet' | 'chart-vertical' | 'discount' | 'calendar' | 'receipt' | 'target';

const TILE: Record<KpiIcon, { bg: string; fg: string }> = {
  cart: { bg: '#e3f6ef', fg: '#047b5d' },
  wallet: { bg: '#fdebe8', fg: '#d72c0d' },
  'chart-vertical': { bg: '#e5efff', fg: '#005bd3' },
  discount: { bg: '#f1eaff', fg: '#7b4bd6' },
  calendar: { bg: '#e5efff', fg: '#005bd3' },
  receipt: { bg: '#fff3d6', fg: '#b98900' },
  target: { bg: '#f1eaff', fg: '#7b4bd6' },
};

/** The line colour that goes with each icon tile. */
export const KPI_COLOR: Record<KpiIcon, string> = {
  cart: '#047b5d',
  wallet: '#d72c0d',
  'chart-vertical': '#005bd3',
  discount: '#7b4bd6',
  calendar: '#005bd3',
  receipt: '#b98900',
  target: '#7b4bd6',
};

/** The change against the equivalent previous period, on two lines like the figure beside it. */
export function Change({
  delta,
  previous,
  suffix,
  goodWhenUp = true,
}: {
  delta: Delta;
  previous: { from: string; to: string };
  suffix?: string | null;
  /** false for costs: a rise is not good news */
  goodWhenUp?: boolean;
}) {
  if (delta.direction === 'none') return <s-text color="subdued">No comparison</s-text>;
  const tone =
    delta.direction === 'flat'
      ? 'neutral'
      : (delta.direction === 'up') === goodWhenUp
        ? 'success'
        : 'critical';
  const arrow = delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : '';
  return (
    <s-stack gap="none">
      <s-text tone={tone} type="strong">
        {arrow}
        {delta.text}
      </s-text>
      <s-text color="subdued">
        vs {range(previous.from, previous.to)}
        {suffix ? ` (${suffix})` : ''}
      </s-text>
    </s-stack>
  );
}

/**
 * One figure card: an icon tile, the label and big figure, a line of detail (the change, or a
 * note), and the small line chart of how it moved. Used on the Overview, Profit and Expenses.
 */
export function Kpi({
  icon,
  label,
  value,
  info,
  change,
  notes,
  spark,
  large,
}: {
  icon: KpiIcon;
  label: string;
  value: string;
  info?: string;
  /** the change, or any short line under the figure */
  change?: ReactNode;
  notes?: ReactNode;
  /** points for the small chart; omitted or too few means no chart */
  spark?: Array<number | null>;
  /** the main figure of a screen: a bigger number */
  large?: boolean;
}) {
  const tile = TILE[icon];
  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <div
            aria-hidden="true"
            style={{
              width: '3rem',
              height: '3rem',
              borderRadius: '0.75rem',
              background: tile.bg,
              color: tile.fg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <s-icon type={icon} size="base" />
          </div>
          <s-stack gap="none">
            <s-stack direction="inline" alignItems="center" gap="small-300">
              <s-text color="subdued">{label}</s-text>
              {info && <InfoTip label={label} text={info} />}
            </s-stack>
            <span
              style={{ fontSize: large ? '2.25rem' : '1.75rem', fontWeight: 700, lineHeight: 1.2 }}
            >
              {value}
            </span>
          </s-stack>
        </s-stack>
        <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="end">
          <div>{change}</div>
          {spark ? <Sparkline values={spark} color={KPI_COLOR[icon]} /> : <div />}
        </s-grid>
        {notes}
      </s-stack>
    </s-section>
  );
}
