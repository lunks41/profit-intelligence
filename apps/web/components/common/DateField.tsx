'use client';

import { useEffect, useId, useState } from 'react';
import { closePopover } from '../dropdown/Dropdown';
import { formatDate, parseDate, todayInShop } from '../../lib/shop-time';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const two = (n: number) => String(n).padStart(2, '0');

/**
 * A month calendar drawn by the app. The date picker of the browser cannot open inside the Shopify admin (the
 * app runs in a cross-origin iframe), so the app brings its own.
 */
function Calendar({ value, onPick }: { value: string; onPick: (iso: string) => void }) {
  const start = value || todayInShop();
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const [month, setMonth] = useState(Number(start.slice(5, 7)) - 1);
  useEffect(() => {
    const v = value || todayInShop();
    setYear(Number(v.slice(0, 4)));
    setMonth(Number(v.slice(5, 7)) - 1);
  }, [value]);

  const today = todayInShop();
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const step = (by: number) => {
    const d = new Date(Date.UTC(year, month + by, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  };

  return (
    <div style={{ padding: '0.5rem', width: '15rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.5rem',
        }}
      >
        <s-button
          variant="tertiary"
          icon="chevron-left"
          accessibilityLabel="Previous month"
          onClick={() => step(-1)}
        />
        <span style={{ fontWeight: 600 }}>
          {MONTHS[month]} {year}
        </span>
        <s-button
          variant="tertiary"
          icon="chevron-right"
          accessibilityLabel="Next month"
          onClick={() => step(1)}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            style={{
              textAlign: 'center',
              color: '#616161',
              fontSize: '0.75rem',
              padding: '0.25rem 0',
            }}
          >
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />;
          const iso = `${year}-${two(month + 1)}-${two(d)}`;
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              className="pi-dd-option"
              aria-current={selected ? 'date' : undefined}
              onClick={() => onPick(iso)}
              style={{
                margin: 0,
                padding: '0.3rem 0',
                border: selected
                  ? '2px solid #2c6ecb'
                  : iso === today
                    ? '1px solid #8a8a8a'
                    : '2px solid transparent',
                borderRadius: '0.5rem',
                color: '#303030',
                font: 'inherit',
                fontWeight: selected ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The one date field of the app. It shows and accepts dd-MMM-yyyy (12-Oct-2026), whatever the language of the
 * browser, and hands back YYYY-MM-DD. The calendar button opens the calendar of the app.
 */
export function DateField({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  /** YYYY-MM-DD, or empty */
  value: string;
  onChange: (iso: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = `cal-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [text, setText] = useState(value ? formatDate(value) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value ? formatDate(value) : '');
    setBad(false);
  }, [value]);

  function commit() {
    if (text.trim() === '') {
      setBad(false);
      if (value !== '') onChange('');
      return;
    }
    const iso = parseDate(text);
    if (!iso) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(formatDate(iso));
    if (iso !== value) onChange(iso);
  }

  return (
    <>
      <s-text-field
        label={label}
        value={text}
        disabled={disabled}
        placeholder="dd-MMM-yyyy"
        error={bad ? 'Use a date such as 12-Oct-2026' : error}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setBad(false);
        }}
        onBlur={commit}
        onChange={commit}
      >
        <s-button
          slot="accessory"
          variant="tertiary"
          icon="calendar"
          disabled={disabled}
          commandFor={id}
          command="--toggle"
          accessibilityLabel={`Pick ${label} from a calendar`}
        />
      </s-text-field>
      <s-popover id={id}>
        <Calendar
          value={value}
          onPick={(iso) => {
            onChange(iso);
            closePopover(id);
          }}
        />
      </s-popover>
    </>
  );
}
