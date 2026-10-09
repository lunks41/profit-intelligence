'use client';

import { useId } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * The one dropdown used across the app. Every other dropdown in this folder is built on it, so
 * label, width, and behaviour stay the same on every screen.
 *
 * The list is a Polaris popover drawn inside the page, not the browser's own select list (which
 * ignores the page's styling and can draw an oversized blank panel).
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = `dd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const current = options.find((o) => o.value === value);

  return (
    <s-stack gap="small-300">
      <s-text>{label}</s-text>
      <s-button
        inlineSize="fill"
        variant="secondary"
        disabled={disabled}
        commandFor={id}
        command="--toggle"
        accessibilityLabel={`${label}: ${current?.label ?? 'none selected'}`}
      >
        {`${current?.label ?? 'Select'}  ▾`}
      </s-button>
      <s-popover id={id} minInlineSize="220px" maxBlockSize="320px">
        <s-stack gap="none" padding="small-300">
          {options.map((o) => (
            <s-button
              key={o.value}
              variant="tertiary"
              inlineSize="fill"
              icon={o.value === value ? 'check' : undefined}
              commandFor={id}
              command="--hide"
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </s-button>
          ))}
        </s-stack>
      </s-popover>
    </s-stack>
  );
}
