import type { ReactNode } from 'react';

/** A figure with a label, an optional note, and optional extra lines (change, badge). */
export function StatCard({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: string;
  note?: string | null;
  children?: ReactNode;
}) {
  return (
    <s-section>
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
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
    <s-grid gridTemplateColumns={`repeat(auto-fit, minmax(${minWidth}px, 1fr))`} gap="base">
      {children}
    </s-grid>
  );
}
