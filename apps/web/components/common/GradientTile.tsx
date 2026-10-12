'use client';

import type { ReactNode } from 'react';
import type { Delta } from '../../lib/format';
import { InfoTip } from './info-tip';
import { Sparkline } from './sparkline';

/** Dark enough that white text on it reads clearly (4.5:1 or better). */
export const TILE_GRADIENT = {
  net: ['#0d9488', '#0e7490'],
  revenue: ['#2563eb', '#4f46e5'],
  costs: ['#ea580c', '#dc2626'],
  profit: ['#059669', '#0d9488'],
  margin: ['#9333ea', '#7c3aed'],
  expenses: ['#d97706', '#b45309'],
  ads: ['#db2777', '#e11d48'],
} as const;

/**
 * A bold figure card: a coloured gradient, the label in capitals, the figure, how it changed (a white capsule with an
 * arrow), what it is compared with, and the line of how it moved. The colour says what the figure is, the same as in the
 * charts. The change and the text are real words, so the colour is never the only signal.
 */
export function GradientTile({
  label,
  value,
  info,
  gradient,
  delta,
  goodWhenUp = true,
  compare,
  detail,
  spark,
  hero,
  children,
  href,
}: {
  label: string;
  value: string;
  info?: string;
  gradient: readonly [string, string];
  delta?: Delta;
  /** false for costs: a rise is not good news */
  goodWhenUp?: boolean;
  /** "vs 11-Aug – 09-Sep" */
  compare?: string;
  /** one line about what is behind the figure */
  detail?: ReactNode;
  spark?: Array<number | null>;
  /** the main figure of the page: bigger */
  hero?: boolean;
  children?: ReactNode;
  href?: string;
}) {
  const up = delta?.direction === 'up';
  const down = delta?.direction === 'down';
  const good =
    delta && delta.direction !== 'none' && delta.direction !== 'flat' ? up === goodWhenUp : null;
  const arrow = up ? '▲' : down ? '▼' : '';
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        borderRadius: '0.9rem',
        padding: hero ? '1.25rem 1.5rem' : '1rem 1.1rem',
        color: '#fff',
        background: `radial-gradient(circle at 88% -10%, rgba(255,255,255,0.28), transparent 55%), linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 100%)`,
        textShadow: '0 1px 1px rgba(0,0,0,0.14)',
        boxShadow: '0 1px 2px rgba(26,26,26,0.18), 0 6px 16px rgba(26,26,26,0.12)',
        display: 'flex',
        flexDirection: hero ? 'row' : 'column',
        flexWrap: 'wrap',
        gap: hero ? '1rem 2rem' : '0.4rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          flex: '1 1 14rem',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              opacity: 0.92,
            }}
          >
            {label}
          </span>
          {info && (
            <span style={{ color: '#fff', display: 'inline-flex' }}>
              <InfoTip label={label} text={info} />
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: hero ? '2.6rem' : '1.65rem',
            fontWeight: 750,
            lineHeight: 1.1,
            overflowWrap: 'anywhere',
          }}
        >
          {href ? (
            <a href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
              {value}
            </a>
          ) : (
            value
          )}
        </span>
        {delta && delta.direction !== 'none' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                background: '#fff',
                color: good === null ? '#4a4a4a' : good ? '#047b5d' : '#c70a24',
                borderRadius: '999px',
                padding: '0.1rem 0.55rem',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              {arrow && <span aria-hidden="true">{arrow}</span>}
              {delta.text}
            </span>
            {compare && <span style={{ fontSize: '0.75rem', opacity: 0.9 }}>{compare}</span>}
          </div>
        )}
        {detail && (
          <div style={{ fontSize: '0.8rem', opacity: 0.92, lineHeight: 1.35 }}>{detail}</div>
        )}
      </div>
      {children && (
        <div
          style={{
            flex: '1 1 14rem',
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
      {spark && (
        <div style={{ flex: hero ? '1 1 100%' : undefined, marginTop: 'auto', opacity: 0.9 }}>
          <Sparkline values={spark} color="#ffffff" height={hero ? '3.5rem' : '2.25rem'} />
        </div>
      )}
    </div>
  );
}
