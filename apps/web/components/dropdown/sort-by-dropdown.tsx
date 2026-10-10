'use client';

import { Dropdown } from './Dropdown';

export function SortByDropdown<S extends string>({
  label = 'Sort by',
  value,
  options,
  onChange,
  chip,
}: {
  label?: string;
  value: S;
  options: Array<{ value: S; label: string }>;
  onChange: (value: S) => void;
  chip?: boolean;
}) {
  return (
    <Dropdown
      chip={chip}
      label={label}
      value={value}
      options={options}
      onChange={(v) => onChange(v as S)}
    />
  );
}
