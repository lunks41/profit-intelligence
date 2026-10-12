'use client';

import type { Issue, OverviewResponse } from '@pi/contracts';
import { prettyDates } from '../../lib/shop-time';
import { Card } from '../common';

const ACCENT: Record<Issue['severity'], string> = {
  critical: '#d72c0d',
  warning: '#e8a317',
  info: '#005bd3',
};
const WORD: Record<Issue['severity'], string> = {
  critical: 'Needs attention',
  warning: 'Check',
  info: 'Suggestion',
};

interface Item {
  id: string;
  accent: string;
  word: string;
  title: string;
  detail: string;
  href: string;
  action: string;
}

/**
 * The things that need doing, as short rows with a coloured edge: the unresolved data problems of the Overview, most
 * important first, and a note when the data is not fresh. Nothing to do is said, not left blank.
 */
export function Reminders({ data }: { data: OverviewResponse }) {
  const items: Item[] = data.issues.slice(0, 4).map((i) => ({
    id: i.id,
    accent: ACCENT[i.severity],
    word: WORD[i.severity],
    title: i.title,
    detail: i.detail,
    href: i.action.href,
    action: i.action.label,
  }));
  if (data.freshness.stale) {
    items.push({
      id: 'stale',
      accent: ACCENT.warning,
      word: 'Check',
      title: 'Data may be out of date',
      detail: 'The last import is older than expected, so the newest orders may be missing.',
      href: '/settings',
      action: 'Open sync status',
    });
  }
  const more = Math.max(0, data.issues.length - 4);

  return (
    <Card>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            aria-hidden="true"
            style={{ width: 8, height: 8, borderRadius: 8, background: '#e8a317' }}
          />
          <s-heading>Reminders</s-heading>
        </div>
        <s-text color="subdued">Items that need action</s-text>
      </div>
      {items.length === 0 ? (
        <div
          style={{
            borderLeft: '4px solid #047b5d',
            background: '#f1faf6',
            borderRadius: '0.5rem',
            padding: '0.6rem 0.8rem',
          }}
        >
          <s-text type="strong">All clear</s-text>
          <div>
            <s-text color="subdued">No missing costs or setup gaps for this period.</s-text>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {items.map((it) => (
            <div
              key={it.id}
              style={{
                borderLeft: `4px solid ${it.accent}`,
                border: '1px solid #e3e3e3',
                borderLeftWidth: 4,
                borderLeftColor: it.accent,
                borderRadius: '0.5rem',
                padding: '0.55rem 0.75rem',
                background: '#fff',
                display: 'grid',
                gap: '0.15rem',
              }}
            >
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#616161',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {it.word}
              </span>
              <s-text type="strong">{it.title}</s-text>
              <div
                style={{
                  color: '#616161',
                  fontSize: '0.8rem',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {prettyDates(it.detail)}
              </div>
              <s-link href={it.href}>{it.action}</s-link>
            </div>
          ))}
          {more > 0 && (
            <s-text color="subdued">{more} more in Data quality, lower on the page.</s-text>
          )}
        </div>
      )}
    </Card>
  );
}
