'use client';

import { Dropdown } from './Dropdown';

export function SortOrderDropdown({
  label = 'Order',
  value,
  onChange,
  chip,
}: {
  label?: string;
  value: 'asc' | 'desc';
  onChange: (value: 'asc' | 'desc') => void;
  chip?: boolean;
}) {
  return (
    <Dropdown
      chip={chip}
      label={label}
      value={value}
      options={[
        { value: 'desc', label: 'High to low' },
        { value: 'asc', label: 'Low to high' },
      ]}
      onChange={(v) => onChange(v as 'asc' | 'desc')}
    />
  );
}
