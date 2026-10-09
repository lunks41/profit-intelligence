'use client';

import { Dropdown } from './Dropdown';

export function CategoryDropdown({
  label = 'Category',
  value,
  categories,
  onChange,
}: {
  label?: string;
  value: string;
  categories: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={categories.map((c) => ({ value: c.id, label: c.name }))}
      onChange={onChange}
    />
  );
}
