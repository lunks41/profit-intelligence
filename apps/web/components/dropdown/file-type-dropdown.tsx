'use client';

import { Dropdown } from './Dropdown';

export function FileTypeDropdown<T extends 'csv' | 'pdf'>({
  label = 'File type',
  value,
  csvFirst = true,
  csvLabel = 'CSV (spreadsheet)',
  onChange,
}: {
  label?: string;
  value: T;
  csvFirst?: boolean;
  csvLabel?: string;
  onChange: (value: T) => void;
}) {
  const csv = { value: 'csv', label: csvLabel };
  const pdf = { value: 'pdf', label: 'PDF' };
  return (
    <Dropdown
      label={label}
      value={value}
      options={csvFirst ? [csv, pdf] : [pdf, csv]}
      onChange={(v) => onChange(v as T)}
    />
  );
}
