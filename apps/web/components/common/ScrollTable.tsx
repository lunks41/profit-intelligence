'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Two small style rules for the inside of a Polaris table, which the page's own CSS cannot reach:
 * the table scrolls sideways in a box of its own (that box stops anything inside it from sticking to the frame
 * around the table), and its heading row is a plain block. With the box left open and the heading row sticky, the
 * heading stays at the top of the frame while the rows scroll under it. Worked out and checked in a browser
 * against the table of Polaris; if Polaris changes its inside, the table simply scrolls with its heading.
 */
const TABLE_RULES =
  '.table-wrapper{overflow:visible!important}.table-head{position:sticky;top:0;z-index:5;background:#f7f7f7}';
const BOX_RULES = '.scroll{overflow:visible!important}';

const done = new WeakSet<Element>();

function addRules(root: ShadowRoot | null | undefined, css: string) {
  if (!root || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in root))
    return false;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  return true;
}

/** Freezes the heading row of every Polaris table inside the frame. Safe to call again: a table is done once. */
function freeze(frame: HTMLElement): boolean {
  let pending = false;
  frame.querySelectorAll('s-table').forEach((table) => {
    if (done.has(table)) return;
    const box = table.shadowRoot?.querySelector('s-internal-scroll-box');
    if (!table.shadowRoot || !box?.shadowRoot) {
      pending = true; // the table has not drawn itself yet
      return;
    }
    if (addRules(table.shadowRoot, TABLE_RULES) && addRules(box.shadowRoot, BOX_RULES))
      done.add(table);
  });
  return pending;
}

/**
 * A frame for a table of fixed maximum height. A short table is as high as its rows; a long one stops at the height
 * and scrolls inside its card (down and sideways) with its heading row frozen at the top, so a card never grows with
 * its data and the page below stays where it is. Used for every list of rows in the app.
 */
export function ScrollTable({
  children,
  maxHeight = 'min(60vh, 28rem)',
}: {
  children: ReactNode;
  maxHeight?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (freeze(el) && tries++ < 40) timer = setTimeout(run, 100);
    };
    run();
    // a table that appears later (data arrives) is frozen too
    const observer = new MutationObserver(() => {
      tries = 0;
      run();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <div ref={frame} style={{ maxHeight, overflow: 'auto' }}>
      {children}
    </div>
  );
}
