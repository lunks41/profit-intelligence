'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const HOST_ID = 'pi-page-notices';
/** The most the strip is ever pulled outward; a guard against a surprising page layout. */
const MAX_PULL = 64;

/**
 * The place at the very top of a page where notices are stacked, flush under Shopify's page title
 * like an information bar. Put it as a direct child of `s-page` (it uses the page's top slot). It
 * pulls itself out over the page's own padding (top and sides) so there is no gap above or beside
 * it, and only does so while it holds a notice, so a page with none is unchanged.
 */
export function PageNotices() {
  const ref = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState({ top: 0, left: 0, right: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.childElementCount === 0) {
        setPull((p) =>
          p.top === 0 && p.left === 0 && p.right === 0 ? p : { top: 0, left: 0, right: 0 },
        );
        return;
      }
      const applied = el.style.margin;
      el.style.margin = '0';
      const r = el.getBoundingClientRect();
      const clamp = (n: number) => Math.min(Math.max(Math.round(n), 0), MAX_PULL);
      const next = {
        top: clamp(r.top + window.scrollY),
        left: clamp(r.left),
        right: clamp(document.documentElement.clientWidth - r.right),
      };
      el.style.margin = applied;
      setPull((p) =>
        p.top === next.top && p.left === next.left && p.right === next.right ? p : next,
      );
    };
    measure();
    // the page may still be settling (fonts, Polaris upgrading its elements): measure again
    const timers = [setTimeout(measure, 300), setTimeout(measure, 1200)];
    const observer = new MutationObserver(measure);
    observer.observe(el, { childList: true });
    window.addEventListener('resize', measure);
    return () => {
      timers.forEach(clearTimeout);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div
      ref={ref}
      id={HOST_ID}
      slot="supplemental-start"
      style={{ margin: `${-pull.top}px ${-pull.right}px 0 ${-pull.left}px` }}
    />
  );
}

const TONES = {
  info: { bg: '#eaf4ff', line: '#b4d6fa' },
  critical: { bg: '#fdf0ee', line: '#f2b8b5' },
} as const;

/**
 * A slim notice: one row, full width, stacked with the others at the top of the page (in the
 * PageNotices host). On a page without a host (a preview) it simply shows in place.
 */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | 'inline' | null>(null);
  useEffect(() => setTarget(document.getElementById(HOST_ID) ?? 'inline'), []);
  if (target === null) return null;
  const t = TONES[tone];
  const strip = (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      style={{
        background: t.bg,
        borderBottom: `1px solid ${t.line}`,
        padding: '0.125rem 1rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 0.75rem' }}>
        <s-icon type={tone === 'critical' ? 'alert-circle' : 'info'} size="base" />
        {children}
      </div>
    </div>
  );
  return target === 'inline' ? strip : createPortal(strip, target);
}
