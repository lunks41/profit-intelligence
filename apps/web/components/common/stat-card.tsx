import type { ReactNode } from 'react';
import { InfoTip } from './info-tip';

/** A figure with a label, an optional note, and optional extra lines (change, badge). */
export function StatCard({
  label,
  value,
  note,
  info,
  tone,
  action,
  children,
}: {
  label: string;
  value: string;
  note?: string | null;
  /** what the figure is made of, shown in a tooltip next to the label */
  info?: string;
  /** red when something needs fixing */
  tone?: 'critical';
  /** a small button at the top right of the card, e.g. View */
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <s-section>
      <s-stack gap="small-300">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small">
          {info ? (
            <s-stack direction="inline" alignItems="center" gap="small-300">
              <s-text color="subdued">{label}</s-text>
              <InfoTip label={label} text={info} />
            </s-stack>
          ) : (
            <s-text color="subdued">{label}</s-text>
          )}
          {action && (
            <s-button
              variant="tertiary"
              accessibilityLabel={`${action.label}: ${label}`}
              onClick={action.onClick}
            >
              {action.label}
            </s-button>
          )}
        </s-stack>
        <s-heading>
          <span style={tone === 'critical' ? { color: '#8e1f0b' } : undefined}>{value}</span>
        </s-heading>
        {note && (
          <s-text color="subdued">
            <span style={tone === 'critical' ? { color: '#8e1f0b' } : undefined}>{note}</span>
          </s-text>
        )}
        {children}
      </s-stack>
    </s-section>
  );
}

/** The row of StatCards at the top of a screen. */
export function StatGrid({ children, minWidth = 200 }: { children: ReactNode; minWidth?: number }) {
  return (
    <s-grid gridTemplateColumns={`repeat(auto-fit, minmax(${minWidth / 16}rem, 1fr))`} gap="small">
      {children}
    </s-grid>
  );
}
