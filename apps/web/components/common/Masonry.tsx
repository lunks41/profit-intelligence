'use client';

import { Children, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const GAP = 8; // px between cards, down and across

/** One card: reports its own height so the grid can give it exactly that many rows. */
function Item({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(0);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setRows(el.offsetHeight > 0 ? Math.ceil(el.offsetHeight) + GAP : 0);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // a card with nothing to show takes no room, so it leaves no gap
  return (
    <div
      style={{
        gridRowEnd: `span ${Math.max(rows, 1)}`,
        display: rows === 0 && inner.current ? 'none' : 'block',
      }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}

/**
 * Cards packed into columns the way a wall of bricks is: each card goes to the highest free place, so the next card
 * always sits right under the shortest column and no card is stretched to match its neighbour. The number of columns
 * follows the width (`min` is the narrowest a column may be). Cards keep their order, left to right then down.
 */
export function Masonry({ children, min = '20rem' }: { children: ReactNode; min?: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}), 1fr))`,
        gridAutoRows: 1,
        columnGap: GAP,
        gridAutoFlow: 'row dense',
        marginBottom: -GAP, // the last row of cards carries its own gap
      }}
    >
      {Children.toArray(children).map((c, i) => (
        <Item key={i}>{c}</Item>
      ))}
    </div>
  );
}
