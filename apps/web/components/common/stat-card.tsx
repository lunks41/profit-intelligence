import type { ReactNode } from 'react';
import { InfoTip } from './info-tip';

/** A figure with a label, an optional note, and optional extra lines (change, badge). */
export function StatCard({
  label,
  value,
  note,
  info,
  children,
}: {
  label: string;
  value: string;
  note?: string | null;
  /** what the figure is made of, shown in a tooltip next to the label */
  info?: string;
  children?: ReactNode;
}) {
  return (
    <s-section>
      <s-stack gap="small-300">
        {info ? (
          <s-stack direction="inline" alignItems="center" gap="small-300">
            <s-text color="subdued">{label}</s-text>
            <InfoTip label={label} text={info} />
          </s-stack>
        ) : (
          <s-text color="subdued">{label}</s-text>
        )}
        <s-heading>{value}</s-heading>
        {note && <s-text color="subdued">{note}</s-text>}
        {children}
      </s-stack>
    </s-section>
  );
}

/** The row of StatCards at the top of a screen. */
export function StatGrid({ children, minWidth = 200 }: { children: ReactNode; minWidth?: number }) {
  return (
    <s-grid gridTemplateColumns={`repeat(auto-fit, minmax(${minWidth / 16}rem, 1fr))`} gap="base">
      {children}
    </s-grid>
  );
}
