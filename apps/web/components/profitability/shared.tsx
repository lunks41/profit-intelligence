'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, ApiRequestError } from '../../lib/api';
import { SortByDropdown, SortOrderDropdown } from '../dropdown';

/** Loads a path from the API; reloads when the path changes. A newer request replaces an older one. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const next = await apiGet<T>(path);
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
      setErrorCode(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setErrorCode(e instanceof ApiRequestError ? e.code : null);
      setError(
        e instanceof ApiRequestError && (e.status !== 0 || e.code === 'not_embedded')
          ? e.message
          : 'Could not load this page. Check your connection and try again.',
      );
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // Let App Bridge finish loading before the first token request.
    const t = setTimeout(() => void load(), 400);
    return () => clearTimeout(t);
  }, [load]);

  return { data, error, errorCode, loading, reload: load };
}

const QUALITY: Record<
  string,
  { label: string; tone: 'success' | 'caution' | 'critical' | 'neutral' }
> = {
  actual: { label: 'Cost confirmed', tone: 'success' },
  estimated: { label: 'Cost estimated', tone: 'caution' },
  missing: { label: 'Cost missing', tone: 'critical' },
  none: { label: 'No cost data', tone: 'neutral' },
};

export function QualityBadge({ quality }: { quality: string }) {
  const q = QUALITY[quality] ?? QUALITY.none!;
  return <s-badge tone={q.tone}>{q.label}</s-badge>;
}

export function Loading({ what }: { what: string }) {
  return (
    <s-section>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-spinner accessibilityLabel={`Loading ${what}`} />
        <s-text>Loading {what}…</s-text>
      </s-stack>
    </s-section>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <s-banner tone="critical" heading="Something went wrong">
      <s-paragraph>{message}</s-paragraph>
      <s-button onClick={onRetry}>Try again</s-button>
    </s-banner>
  );
}

export function RuleNote({ text }: { text: string }) {
  return (
    <s-section heading="How this is calculated">
      <s-paragraph>{text}</s-paragraph>
    </s-section>
  );
}

export function SortControls<S extends string>({
  options,
  sort,
  dir,
  onChange,
}: {
  options: Array<{ value: S; label: string }>;
  sort: S;
  dir: 'asc' | 'desc';
  onChange: (sort: S, dir: 'asc' | 'desc') => void;
}) {
  return (
    <>
      <SortByDropdown value={sort} options={options} onChange={(v) => onChange(v, dir)} />
      <SortOrderDropdown value={dir} onChange={(d) => onChange(sort, d)} />
    </>
  );
}
