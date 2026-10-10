'use client';

import { useId } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
}

/** Closes the Polaris list. The page browser has no commandfor on a plain button. */
function closePopover(id: string) {
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
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled,
  compact,
  chip,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  chip?: boolean;
}) {
  const id = `dd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const current = options.find((o) => o.value === value);
  const name = current?.label ?? 'Select';

  const control = (
    <s-stack gap="small-300">
      {!compact && !chip && <s-text>{label}</s-text>}
      {chip ? (
        <s-button
          variant="secondary"
          inlineSize="auto"
          disabled={disabled}
          commandFor={id}
          command="--toggle"
          accessibilityLabel={`${label}: ${current?.label ?? 'none selected'}`}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            {name}
            <s-icon type="chevron-down" size="small" />
          </span>
        </s-button>
      ) : (
        <s-button
          inlineSize={compact ? 'auto' : 'fill'}
          variant="secondary"
          disabled={disabled}
          commandFor={id}
          command="--toggle"
          accessibilityLabel={`${label}: ${current?.label ?? 'none selected'}`}
        >
          {`${name}  ▾`}
        </s-button>
      )}
      <s-popover id={id} minInlineSize="200px" maxBlockSize="256px">
        <s-stack gap="none" padding="small-300">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                className="pi-dd-option"
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onChange(o.value);
                  closePopover(id);
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
                  color: '#303030',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
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
              </button>
            );
          })}
        </s-stack>
      </s-popover>
    </s-stack>
  );
  if (!chip) return control;
  return <div style={{ width: 'fit-content' }}>{control}</div>;
}
