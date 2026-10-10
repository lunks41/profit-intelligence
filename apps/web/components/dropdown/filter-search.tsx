'use client';

/**
 * A search box the same height and outline as the filter dropdowns, so a row of filters
 * lines up. The label is read aloud and is not drawn above the field.
 */
export function FilterSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="pi-filter-search">
      <s-icon type="search" size="small" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}
