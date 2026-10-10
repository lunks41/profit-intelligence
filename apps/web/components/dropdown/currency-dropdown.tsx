'use client';

import { Dropdown } from './Dropdown';

export function CurrencyDropdown({
  label = 'Currency',
  value,
  currencies,
  onChange,
  compact,
  chip,
}: {
  label?: string;
  compact?: boolean;
  chip?: boolean;
  value: string;
  currencies: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      chip={chip}
      compact={compact}
      label={label}
      value={value}
      options={currencies.map((c) => ({ value: c, label: c }))}
      onChange={onChange}
    />
  );
}
