import type { CSSProperties, ReactNode } from 'react';

/**
 * A dashboard card. Cards in a row are all as tall as the tallest, and the card body is a column
 * that can grow, so a chart or a list can fill the space instead of leaving a blank area under it.
 */
export function Card({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  /** false for a card whose table runs edge to edge (the header then pads itself) */
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: padded ? '1rem' : 0,
        background: 'var(--p-color-bg-surface, #fff)',
        borderRadius: '0.75rem',
        boxShadow: '0 0 0 1px rgba(26,26,26,0.07), 0 1px 2px rgba(26,26,26,0.1)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Padding for a card header inside an edge-to-edge (unpadded) card. */
export function CardPad({ children }: { children: ReactNode }) {
  return <div style={{ padding: '1rem 1rem 0' }}>{children}</div>;
}
