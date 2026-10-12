import type { ReactNode } from 'react';

/**
 * A frame for a table of fixed maximum height. A short table is as high as its rows; a long one stops at the
 * height and scrolls inside its card (down and sideways), so a card never grows with its data and the page below
 * stays where it is. Used for every list of rows in the app.
 */
export function ScrollTable({
  children,
  maxHeight = 'min(60vh, 28rem)',
}: {
  children: ReactNode;
  maxHeight?: string;
}) {
  return <div style={{ maxHeight, overflow: 'auto' }}>{children}</div>;
}
