'use client';

import { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  /** not in the merchant's plan: shown with a lock and a hint, and cannot be chosen */
  locked?: boolean;
  /** short words beside a locked option, e.g. the plan that has it */
  hint?: string;
}

/** Closes the Polaris list. The page browser has no commandfor on a plain button. */
export function closePopover(id: string) {
  const host = document.getElementById(id);
  const panel = host?.shadowRoot?.querySelector('[popover]');
  if (panel instanceof HTMLElement && panel.matches(':popover-open')) panel.hidePopover();
}

/**
 * The one dropdown used across the app. Every other dropdown in this folder is built on it, so
 * label, width, and behaviour stay the same on every screen.
 *
 * The list is a Polaris popover drawn inside the page, not the browser's own select list (which
 * ignores the page's styling and can draw an oversized blank panel). The chosen row has a check
 * beside the words and a blue outline. The words themselves stay plain text.
 *
 * `compact` drops the label above and shows only the button (the label is still read aloud), for
 * the small filters in a card's header.
 *
 * `chip` is the short left-aligned button with a chevron, and the same list underneath.
 */
interface DropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  chip?: boolean;
}

export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled,
  compact,
  chip,
}: DropdownProps) {
  // in a filter bar (chip or compact) the button is short and has no label above it
  const short = Boolean(chip || compact);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: 0, left: 0, width: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (button.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('[data-pi-field-list]')) return;
      close();
    };
    document.addEventListener('keydown', esc);
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const control = (
    <s-stack gap="small-300">
      {!short && <s-text>{label}</s-text>}
      <button
        ref={button}
        type="button"
        className={short ? 'pi-field-select pi-field-short' : 'pi-field-select'}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? 'none selected'}`}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) setAt({ top: r.bottom + 4, left: r.left, width: r.width });
          setOpen((v) => !v);
        }}
      >
        <span className="pi-field-select-text">{current?.label ?? 'Select'}</span>
        <s-icon type="chevron-down" size="small" />
      </button>
      {open && (
        <div
          data-pi-field-list
          role="listbox"
          style={{
            position: 'fixed',
            top: at.top,
            left: at.left,
            minWidth: short ? Math.max(at.width, 192) : at.width,
            maxHeight: '24rem',
            overflowY: 'auto',
            zIndex: 2147483000,
            background: '#fff',
            borderRadius: '0.75rem',
            boxShadow: '0 0.25rem 1rem rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08)',
            padding: '0.25rem',
          }}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={o.locked || undefined}
                className="pi-dd-option"
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  if (o.locked) return;
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  margin: 0,
                  padding: '0.35rem 0.5rem',
                  border: selected ? '2px solid #2c6ecb' : '2px solid transparent',
                  borderRadius: '0.5rem',
                  color: o.locked ? '#8a8a8a' : '#303030',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: o.locked ? 'not-allowed' : 'pointer',
                }}
              >
                <span
                  style={{
                    width: '1rem',
                    flex: '0 0 1rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected ? <s-icon type="check" size="small" /> : null}
                </span>
                <span>{o.label}</span>
                {o.locked && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#616161' }}>
                    <span aria-hidden="true">🔒 </span>
                    {o.hint ?? 'Locked'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </s-stack>
  );
  return short ? <div style={{ width: 'fit-content' }}>{control}</div> : control;
}
