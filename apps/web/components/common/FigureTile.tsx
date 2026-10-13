'use client';

import type { ReactNode } from 'react';
import type { Delta } from '../../lib/format';
import { CHART } from '../../lib/chart-colors';
import { InfoTip } from './info-tip';
import { Sparkline } from './sparkline';

/** One colour for each figure, the same as in the charts: the tile shows it in its line. */
export const TILE_COLOR = {
  net: '#0e7490',
  revenue: CHART.revenue,
  costs: CHART.costs,
  profit: CHART.profit,
  margin: CHART.operating,
  expenses: CHART.spend,
  ads: '#d6336c',
} as const;

/**
 * A figure card: white, with the label in capitals, the figure, how it changed (a
 * capsule with an arrow), what it is compared with, one line of what is behind it, and the line of how it moved in the
 * figure's colour. The change is always written out, so colour is never the only signal.
 */
export function FigureTile({
  label,
  value,
  info,
  color,
  delta,
  goodWhenUp = true,
  compare,
  detail,
  spark,
  hero,
  children,
}: {
  label: string;
  value: string;
  info?: string;
  color: string;
  delta?: Delta;
  /** false for costs: a rise is not good news */
  goodWhenUp?: boolean;
  /** "vs 11-Aug – 09-Sep" */
  compare?: string;
  /** one line about what is behind the figure */
  detail?: ReactNode;
  spark?: Array<number | null>;
  /** the main figure of the page: bigger, with room for a breakdown beside it */
  hero?: boolean;
  children?: ReactNode;
}) {
  const up = delta?.direction === 'up';
  const down = delta?.direction === 'down';
  const known = delta && delta.direction !== 'none' && delta.direction !== 'flat';
  const good = known ? up === goodWhenUp : null;
  const pill =
    good === null
      ? { bg: '#f1f1f1', fg: '#4a4a4a' }
      : good
        ? { bg: '#e3f6ef', fg: '#047b5d' }
        : { bg: '#fdebe8', fg: '#c70a24' };
  return (
    <div
      style={{
        boxSizing: 'border-box',
        borderRadius: '0.75rem',
        padding: hero ? '1.1rem 1.25rem' : '0.9rem 1rem',
        background: '#fff',
        boxShadow: '0 0 0 1px rgba(26,26,26,0.07), 0 1px 2px rgba(26,26,26,0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 2rem' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            flex: '1 1 12rem',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#616161' }}>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {label}
            </span>
            {info && <InfoTip label={label} text={info} />}
          </div>
          <span
            style={{
              fontSize: hero ? '2.25rem' : '1.55rem',
              fontWeight: 750,
              lineHeight: 1.1,
              color: '#1a1a1a',
              overflowWrap: 'anywhere',
            }}
          >
            {value}
          </span>
          {delta && delta.direction !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: pill.bg,
                  color: pill.fg,
                  borderRadius: '999px',
                  padding: '0.1rem 0.55rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                {(up || down) && <span aria-hidden="true">{up ? '▲' : '▼'}</span>}
                {delta.text}
              </span>
              {compare && <span style={{ fontSize: '0.75rem', color: '#616161' }}>{compare}</span>}
            </div>
          )}
          {detail && (
            <div style={{ fontSize: '0.8rem', color: '#616161', lineHeight: 1.35 }}>{detail}</div>
          )}
        </div>
        {children && (
          <div
            style={{
              flex: '1 1 12rem',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              justifyContent: 'center',
            }}
          >
            {children}
          </div>
        )}
      </div>
      {spark && <Sparkline values={spark} color={color} height={hero ? '3.25rem' : '2.25rem'} />}
    </div>
  );
}
