'use client';

import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';

/** Draws the small messages of lib/toast at the top right of the screen, above everything else. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '0.75rem',
        right: '0.75rem',
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        maxWidth: '22rem',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.6rem 0.75rem',
            borderRadius: '0.75rem',
            background: '#303030',
            color: '#fff',
            boxShadow: '0 0.25rem 1rem rgba(0,0,0,0.25)',
            fontSize: '0.8125rem',
          }}
        >
          {t.state === 'busy' && <s-spinner accessibilityLabel="Working" size="base" />}
          {t.state === 'done' && <s-icon type="check-circle" size="small" />}
          {t.state === 'error' && <s-icon type="alert-circle" size="small" />}
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.state !== 'busy' && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
              style={{
                border: 0,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '1rem',
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
