'use client';

import { useState } from 'react';
import type { NotificationListResponse } from '@pi/contracts';
import { shortAgo } from '../lib/format';
import { prettyDates } from '../lib/shop-time';

type Row = NotificationListResponse['rows'][number];

const LOOK: Record<
  Row['severity'],
  { icon: 'check-circle' | 'info' | 'alert-circle'; bg: string; fg: string }
> = {
  success: { icon: 'check-circle', bg: '#dcf5e7', fg: '#047b5d' },
  info: { icon: 'info', bg: '#e0efff', fg: '#005bd3' },
  warning: { icon: 'alert-circle', bg: '#fff0cf', fg: '#8a6116' },
  critical: { icon: 'alert-circle', bg: '#fde3e6', fg: '#c4295c' },
};

/**
 * The list that opens from the bell. A round icon in the colour of the kind of message, the title with how long ago
 * it came, the text (two lines), a green dot while it is unread, and the buttons for it: Open, Mark as read. The All
 * and Unread switch at the top narrows the list.
 */
export function NotificationPanel({
  rows,
  unread,
  busy,
  onAct,
}: {
  rows: Row[];
  unread: number;
  busy: boolean;
  onAct: (path: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const shown = filter === 'unread' ? rows.filter((r) => !r.read) : rows;
  const now = new Date();

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      style={{
        position: 'absolute',
        top: 'calc(100% + 0.5rem)',
        right: 0,
        zIndex: 20,
        width: 'min(25rem, 92vw)',
        background: '#fff',
        borderRadius: '1rem',
        boxShadow: '0 0.75rem 2rem rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #ececec',
        }}
      >
        <s-heading>Notifications</s-heading>
        <div
          role="tablist"
          aria-label="Show"
          style={{
            display: 'inline-flex',
            background: '#f1f1f1',
            borderRadius: '0.6rem',
            padding: '0.15rem',
          }}
        >
          {(
            [
              ['all', 'All'],
              ['unread', unread > 0 ? `Unread ${unread}` : 'Unread'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              style={{
                border: 0,
                cursor: 'pointer',
                padding: '0.3rem 0.8rem',
                borderRadius: '0.45rem',
                font: 'inherit',
                fontWeight: 550,
                color: filter === id ? '#303030' : '#616161',
                background: filter === id ? '#fff' : 'transparent',
                boxShadow: filter === id ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxHeight: '26rem', overflowY: 'auto' }}>
        {shown.length === 0 && (
          <div style={{ padding: '1.5rem 1.25rem' }}>
            <s-text color="subdued">
              {filter === 'unread'
                ? 'You are all caught up.'
                : 'Nothing yet. Finished reports and changes appear here.'}
            </s-text>
          </div>
        )}
        {shown.map((n, i) => {
          const look = LOOK[n.severity];
          return (
            <div
              key={n.id}
              style={{
                display: 'flex',
                gap: '0.85rem',
                padding: '0.9rem 1.25rem',
                borderTop: i === 0 ? 'none' : '1px solid #ececec',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: 'none',
                  width: '2.5rem',
                  height: '2.5rem',
                  borderRadius: '50%',
                  background: look.bg,
                  color: look.fg,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <s-icon type={look.icon} size="base" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontWeight: n.read ? 500 : 650, color: '#303030' }}>
                    {n.title}
                  </span>
                  <span style={{ color: '#8a8a8a', fontSize: '0.8em', flex: 'none' }}>
                    {shortAgo(n.createdAt, now)}
                  </span>
                </div>
                <div
                  style={{
                    color: '#616161',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    marginTop: '0.1rem',
                  }}
                >
                  {prettyDates(n.body)}
                </div>
                {(n.link || !n.read) && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                    {!n.read && (
                      <s-button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => onAct(`/notifications/${n.id}/read`)}
                      >
                        Mark as read
                      </s-button>
                    )}
                    {n.link && (
                      <s-button variant="primary" href={n.link}>
                        Open
                      </s-button>
                    )}
                  </div>
                )}
              </div>
              {!n.read && (
                <span
                  aria-label="Unread"
                  style={{
                    flex: 'none',
                    marginTop: '0.35rem',
                    width: '0.55rem',
                    height: '0.55rem',
                    borderRadius: '50%',
                    background: '#2ebd59',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.25rem',
          borderTop: '1px solid #ececec',
          background: '#fafafa',
        }}
      >
        {unread > 0 ? (
          <s-button
            variant="secondary"
            disabled={busy}
            onClick={() => onAct('/notifications/read-all')}
          >
            Mark all as read
          </s-button>
        ) : (
          <span />
        )}
        <s-link href="/reports?tab=notifications">See all notifications</s-link>
      </div>
    </div>
  );
}
