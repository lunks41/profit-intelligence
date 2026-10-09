'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { apiGet, ApiRequestError } from '../../lib/api';
import { buildQuery, readSavedCurrency, saveCurrency } from '../../lib/query';
import { FilterBar, OverviewSkeleton, OverviewView, type Filters } from './OverviewView';

const today = () => new Date().toISOString().slice(0, 10);

export function OverviewPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d',
    from: today(),
    to: today(),
    currency: null,
  });
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const saved = readSavedCurrency();
    if (saved) setFilters((f) => ({ ...f, currency: saved }));
  }, []);

  const load = useCallback(async (f: Filters) => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const next = await apiGet<OverviewResponse>(`/dashboard/overview?${buildQuery(f)}`);
      if (ticket !== latest.current) return; // a newer request superseded this one
      setData(next);
      setError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setError(
        e instanceof ApiRequestError && e.status !== 0
          ? e.message
          : 'Could not load your overview. Check your connection and try again.',
      );
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait briefly so App Bridge has loaded before the first token request.
    const t = setTimeout(() => void load(filters), 400);
    return () => clearTimeout(t);
  }, [filters, load]);

  function change(next: Filters) {
    if (next.currency && next.currency !== filters.currency) saveCurrency(next.currency);
    setFilters(next);
  }

  return (
    <>
      <FilterBar filters={filters} currencies={data?.currency.available ?? []} onChange={change} />
      {error && (
        <s-banner tone="critical" heading="Overview unavailable">
          <s-paragraph>{error}</s-paragraph>
          <s-button onClick={() => void load(filters)}>Try again</s-button>
        </s-banner>
      )}
      {loading && !data && <OverviewSkeleton />}
      {data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <OverviewView data={data} />
        </div>
      )}
    </>
  );
}
