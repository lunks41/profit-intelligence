'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDate, parseDate } from '../../lib/shop-time';

/**
 * The one date field of the app. It shows and accepts dd-MMM-yyyy (12-Oct-2026), whatever the language of the
 * browser, and hands back YYYY-MM-DD. The calendar button opens the date picker of the browser.
 */
export function DateField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  /** YYYY-MM-DD, or empty */
  value: string;
  onChange: (iso: string) => void;
  error?: string;
}) {
  const [text, setText] = useState(value ? formatDate(value) : '');
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
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
    <div style={{ position: 'relative' }}>
      <s-stack direction="inline" gap="small-300" alignItems="end">
        <div style={{ flex: 1, minWidth: 0 }}>
          <s-text-field
            label={label}
            value={text}
            placeholder="12-Oct-2026"
            error={bad ? 'Use a date such as 12-Oct-2026' : error}
            onInput={(e) => {
              setText(e.currentTarget.value);
              setBad(false);
            }}
            onBlur={commit}
            onChange={commit}
          />
        </div>
        <s-button
          variant="tertiary"
          icon="calendar"
          accessibilityLabel={`Pick ${label} from a calendar`}
          onClick={() => picker.current?.showPicker?.()}
        />
      </s-stack>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(e) => e.currentTarget.value && onChange(e.currentTarget.value)}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 0, height: 0, opacity: 0 }}
      />
    </div>
  );
}
