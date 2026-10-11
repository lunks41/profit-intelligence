'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationListResponse, SessionResponse } from '@pi/contracts';
import { apiGet, apiPost } from '../lib/api';
import { newTabUrl } from '../lib/new-tab-url';

const REFRESH_MS = 60_000;
const TONE = {
  info: 'info',
  success: 'success',
  warning: 'caution',
  critical: 'critical',
} as const;

/** One of the two icons: a large square button so it is easy to see and to hit. */
function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: 'notification' | 'external';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: '2.5rem',
        height: '2.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '0.5rem',
        border: '1px solid #babfc3',
        background: '#ffffff',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <s-icon type={icon} size="base" />
    </button>
  );
}

/**
 * Two icons in the top right of every page: a bell with the number of unread notifications (click for the
 * latest ones, mark them read, or see them all), and one that opens this page again in a new browser tab.
 * Outside the Shopify admin there is no session, so it stays hidden rather than showing broken controls.
 */
export function TopBar() {
  const [notes, setNotes] = useState<NotificationListResponse | null>(null);
  const [shop, setShop] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await apiGet<NotificationListResponse>('/notifications'));
    } catch {
      // the bell is a convenience: a failed refresh keeps the last count
    }
  }, []);

  useEffect(() => {
    // wait briefly so App Bridge has loaded before the first token request
    const first = setTimeout(() => {
      void load();
      apiGet<SessionResponse>('/session')
        .then((s) => setShop(s.shop.domain))
        .catch(() => undefined);
    }, 600);
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!notes && !shop) return null;
  const unread = notes?.unread ?? 0;
  const latest = (notes?.rows ?? []).slice(0, 6);

  async function act(path: string) {
    setBusy(true);
    try {
      await apiPost(path);
      await load();
    } catch {
      // shown again on the next refresh
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0 1rem',
        flex: 'none',
      }}
    >
      <div ref={box} style={{ position: 'relative' }}>
        <IconButton
          icon="notification"
          label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'}
          onClick={() => setOpen((v) => !v)}
        />
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '-0.4rem',
              right: '-0.4rem',
              minWidth: '1.3rem',
              height: '1.3rem',
              padding: '0 0.3rem',
              borderRadius: '0.65rem',
              background: '#d72c0d',
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 700,
              lineHeight: '1.3rem',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {open && (
          <div
            role="dialog"
            aria-label="Notifications"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 20,
              width: 'min(22rem, 90vw)',
              maxHeight: '26rem',
              overflowY: 'auto',
              background: 'var(--p-color-bg-surface, #fff)',
              border: '1px solid var(--p-color-border, #d0d0d0)',
              borderRadius: '0.75rem',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              padding: '0.75rem',
            }}
          >
            <s-stack gap="small">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text type="strong">Notifications</s-text>
                {unread > 0 && (
                  <s-button
                    variant="tertiary"
                    disabled={busy}
                    onClick={() => void act('/notifications/read-all')}
                  >
                    Mark all as read
                  </s-button>
                )}
              </s-stack>
              {latest.length === 0 && (
                <s-text color="subdued">
                  Nothing yet. Finished reports and problems appear here.
                </s-text>
              )}
              {latest.map((n) => (
                <s-stack key={n.id} gap="small-300">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone={TONE[n.severity]}>{n.severity}</s-badge>
                    <s-text type={n.read ? undefined : 'strong'}>
                      {n.read ? '' : '● '}
                      {n.title}
                    </s-text>
                  </s-stack>
                  <s-text color="subdued">{n.body}</s-text>
                  <s-stack direction="inline" gap="small">
                    {n.link && <s-link href={n.link}>Open</s-link>}
                    {!n.read && (
                      <s-button
                        variant="tertiary"
                        disabled={busy}
                        onClick={() => void act(`/notifications/${n.id}/read`)}
                      >
                        Mark as read
                      </s-button>
                    )}
                  </s-stack>
                </s-stack>
              ))}
              <s-link href="/reports?tab=notifications">See all notifications</s-link>
            </s-stack>
          </div>
        )}
      </div>
      {shop && (
        <IconButton
          icon="external"
          label="Open this page in a new tab"
          onClick={() => {
            const url = newTabUrl(shop, process.env.NEXT_PUBLIC_SHOPIFY_API_KEY, window.location);
            if (url) window.open(url, '_blank');
          }}
        />
      )}
    </div>
  );
}
