'use client';

import { Dropdown } from './Dropdown';

export function CurrencyDropdown({
  label = 'Currency',
  value,
  currencies,
  onChange,
  compact,
}: {
  label?: string;
  compact?: boolean;
  value: string;
  currencies: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      compact={compact}
      label={label}
      value={value}
      options={currencies.map((c) => ({ value: c, label: c }))}
      onChange={onChange}
    />
  );
}
