'use client';

import { Dropdown } from './Dropdown';

export function CurrencyDropdown({
  label = 'Currency',
  value,
  currencies,
  onChange,
}: {
  label?: string;
  value: string;
  currencies: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={currencies.map((c) => ({ value: c, label: c }))}
      onChange={onChange}
    />
  );
}
