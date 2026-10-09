'use client';

import { Dropdown, type DropdownOption } from './Dropdown';

/** The "Show" filter on list screens; each screen passes its own choices. */
export function ShowDropdown({
  label = 'Show',
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}) {
  return <Dropdown label={label} value={value} options={options} onChange={onChange} />;
}
