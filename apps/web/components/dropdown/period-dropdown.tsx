'use client';

import type { PeriodPreset } from '@pi/contracts';
import { planWith, usePlan } from '../../lib/plan';
import { addDays, presetRange } from '../../lib/period-range';
import { todayInShop } from '../../lib/shop-time';
import { Dropdown } from './Dropdown';

export const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '60d', label: 'Last 60 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'custom', label: 'Custom range' },
];

export function PeriodDropdown({
  label = 'Period',
  value,
  onChange,
  chip,
}: {
  label?: string;
  value: PeriodPreset;
  onChange: (value: PeriodPreset) => void;
  chip?: boolean;
}) {
  const plan = usePlan();
  const days = plan?.entitlements.historyDays;
  const options = PERIOD_OPTIONS.map((o) => {
    if (!plan || days === undefined || o.value === value) return o;
    const range = presetRange(o.value, todayInShop());
    const first = addDays(todayInShop(), -(days - 1));
    if (!range || range.from >= first) return o;
    // the cheapest plan whose history reaches back far enough for this period
    const needed =
      Math.round((Date.parse(todayInShop()) - Date.parse(range.from)) / 86_400_000) + 1;
    const better = planWith(plan.plan, (e) => e.historyDays >= needed);
    return { ...o, locked: true, hint: better ?? 'Not in plan' };
  });
  return (
    <Dropdown
      chip={chip}
      label={label}
      value={value}
      options={options}
      onChange={(v) => onChange(v as PeriodPreset)}
    />
  );
}
