'use client';

import { Modal } from './common/Modal';
import { SupportForm } from './settings/SupportForm';
import { ActivityIndicator } from './ActivityIndicator';
import { NotificationPanel } from './NotificationPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationListResponse, SessionResponse } from '@pi/contracts';
import { apiGet, apiPost } from '../lib/api';
import { newTabUrl } from '../lib/new-tab-url';

const REFRESH_MS = 60_000;

/** One of the two icons: a large square button so it is easy to see and to hit. */
function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: 'notification' | 'external' | 'question-circle' | 'settings';
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
  const [support, setSupport] = useState(false);
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
    // a change was saved: its message is in the bell a moment later
    let soon: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      if (soon) clearTimeout(soon);
      soon = setTimeout(() => void load(), 1200);
    };
    window.addEventListener('pi:changed', changed);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      if (soon) clearTimeout(soon);
      window.removeEventListener('pi:changed', changed);
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
      <ActivityIndicator />
      <IconButton icon="question-circle" label="Contact support" onClick={() => setSupport(true)} />
      {support && (
        <Modal heading="Contact support" onClose={() => setSupport(false)}>
          <s-section>
            <SupportForm onCancel={() => setSupport(false)} />
          </s-section>
        </Modal>
      )}
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
          <NotificationPanel
            rows={notes?.rows ?? []}
            unread={unread}
            busy={busy}
            onAct={(path) => void act(path)}
          />
        )}
      </div>
      <s-link href="/settings" accessibilityLabel="Settings">
        <span
          title="Settings"
          style={{
            width: '2.5rem',
            height: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '0.5rem',
            border: '1px solid #babfc3',
            background: '#ffffff',
          }}
        >
          <s-icon type="settings" size="base" />
        </span>
      </s-link>
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
