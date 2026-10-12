import type { ReactNode } from 'react';

/** The heading of a card with an optional button at the right end, always on one row. */
export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        minHeight: '1.75rem',
      }}
    >
      <s-heading>{title}</s-heading>
      {action}
    </div>
  );
}
