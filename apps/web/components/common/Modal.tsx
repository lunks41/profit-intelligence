'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * A focused dialog over the page: a heading, a close button, and the content. Escape or a click on the dark
 * area closes it; focus moves into it when it opens and returns to where it was when it closes.
 */
export function Modal({
  heading,
  onClose,
  children,
}: {
  heading: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '2rem 1rem',
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        style={{
          background: '#ffffff',
          borderRadius: '0.75rem',
          width: 'min(60rem, 100%)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3)',
          padding: '1rem 1.25rem 1.25rem',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '0.75rem',
          }}
        >
          <s-heading>{heading}</s-heading>
          <s-button variant="tertiary" icon="x" accessibilityLabel="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
