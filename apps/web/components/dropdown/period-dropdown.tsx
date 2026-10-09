'use client';

import type { PeriodPreset } from '@pi/contracts';
import { Dropdown } from './Dropdown';

export const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '60d', label: 'Last 60 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

export function PeriodDropdown({
  label = 'Period',
  value,
  onChange,
}: {
  label?: string;
  value: PeriodPreset;
  onChange: (value: PeriodPreset) => void;
}) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={PERIOD_OPTIONS}
      onChange={(v) => onChange(v as PeriodPreset)}
    />
  );
}
