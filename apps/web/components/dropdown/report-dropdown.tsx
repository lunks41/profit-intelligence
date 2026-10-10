'use client';

import { Dropdown } from './Dropdown';
import { REPORTS } from '../reports/catalog';

export function ReportDropdown({
  label = 'Report',
  value,
  onChange,
  chip,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  chip?: boolean;
}) {
  return (
    <Dropdown
      chip={chip}
      label={label}
      value={value}
      options={REPORTS.map((r) => ({ value: r.id, label: r.label }))}
      onChange={onChange}
    />
  );
}
