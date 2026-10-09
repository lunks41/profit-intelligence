'use client';

import { Dropdown } from './Dropdown';

export function SortOrderDropdown({
  label = 'Order',
  value,
  onChange,
}: {
  label?: string;
  value: 'asc' | 'desc';
  onChange: (value: 'asc' | 'desc') => void;
}) {
  return (
    <Dropdown
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
