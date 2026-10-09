'use client';

import { Dropdown } from './Dropdown';

export function SortByDropdown<S extends string>({
  label = 'Sort by',
  value,
  options,
  onChange,
}: {
  label?: string;
  value: S;
  options: Array<{ value: S; label: string }>;
  onChange: (value: S) => void;
}) {
  return (
    <Dropdown label={label} value={value} options={options} onChange={(v) => onChange(v as S)} />
  );
}
