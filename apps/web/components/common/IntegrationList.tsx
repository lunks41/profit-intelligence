'use client';

import type { ReactNode } from 'react';

export interface IntegrationAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  tone?: 'critical';
  disabled?: boolean;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  /** the round mark in front of the name: the first letters in the colour of the service */
  mark: { text: string; background: string; color?: string };
  /** connected: green check; idle: nothing to say; soon: not built yet; unavailable: cannot be used on this server */
  status: 'connected' | 'idle' | 'soon' | 'unavailable';
  statusLabel?: string;
  /** what is going on with it (accounts, last import, spend); shown under the description */
  detail?: ReactNode;
  actions?: IntegrationAction[];
}

/**
 * The list of services the app can read from, one row each: a mark, the name with its status, a line about it, and
 * the button on the right (Connect, Import invoice, Manage). Used for the ad platforms on Marketing and for the
 * carriers on Shipping, so both look and work alike.
 */
export function IntegrationList({ items }: { items: Integration[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((it, i) => (
        <div
          key={it.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.85rem 0',
            borderTop: i === 0 ? 'none' : '1px solid #e3e3e3',
            opacity: it.status === 'soon' ? 0.7 : 1,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              flex: 'none',
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: it.mark.background,
              color: it.mark.color ?? '#fff',
              fontWeight: 700,
              fontSize: '0.8rem',
              letterSpacing: '0.02em',
            }}
          >
            {it.mark.text}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <s-text type="strong">{it.name}</s-text>
              {it.status === 'connected' && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                    color: '#047b5d',
                    fontWeight: 550,
                  }}
                >
                  <s-icon type="check" size="small" />
                  {it.statusLabel ?? 'Connected'}
                </span>
              )}
              {it.status === 'soon' && <s-badge tone="neutral">Coming soon</s-badge>}
              {it.status === 'unavailable' && <s-badge tone="caution">Not available yet</s-badge>}
              {it.status === 'idle' && it.statusLabel && (
                <s-text color="subdued">{it.statusLabel}</s-text>
              )}
            </div>
            <s-text color="subdued">{it.description}</s-text>
            {it.detail && <div style={{ marginTop: '0.35rem' }}>{it.detail}</div>}
          </div>
          {it.actions && it.actions.length > 0 && (
            <div style={{ flex: 'none', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {it.actions.map((a) => (
                <s-button
                  key={a.label}
                  variant={a.variant ?? 'secondary'}
                  tone={a.tone}
                  disabled={a.disabled}
                  onClick={a.onClick}
                >
                  {a.label}
                </s-button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
