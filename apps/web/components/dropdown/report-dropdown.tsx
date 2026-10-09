'use client';

import { Dropdown } from './Dropdown';
import { REPORTS } from '../reports/catalog';

export function ReportDropdown({
  label = 'Report',
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={REPORTS.map((r) => ({ value: r.id, label: r.label }))}
      onChange={onChange}
    />
  );
}
