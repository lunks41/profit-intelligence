'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverviewResponse, SessionResponse } from '@pi/contracts';
import { apiGet, ApiRequestError } from '../../lib/api';
import { buildListQuery, buildQuery, readSavedCurrency, saveCurrency } from '../../lib/query';
import { useApi } from '../profitability/shared';
import { SyncNotice } from '../sync/SyncNotice';
import { SyncSection } from '../sync/SyncSection';
import { useSyncStatus } from '../sync/useSyncStatus';
import { Opportunities } from './Opportunities';
import { describeFreshness } from '../../lib/freshness';
import { OverviewHeader } from './OverviewHeader';
import { RecentOrders } from './RecentOrders';
import { SecondaryInsights } from './SecondaryInsights';
import { TopSelling } from './TopSelling';
import { OverviewSkeleton, OverviewView, type Filters } from './OverviewView';

const today = () => new Date().toISOString().slice(0, 10);

/** The period of the figures on screen, for the lists loaded beside them (never the filter being typed). */
const detailQuery = (d: OverviewResponse) =>
  buildListQuery(
    { preset: d.period.preset, from: d.period.from, to: d.period.to, currency: null },
    {},
  );

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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const latest = useRef(0);
  const session = useApi<SessionResponse>('/session');
  const sync = useSyncStatus();

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
      setUpdatedAt(new Date());
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
      <OverviewHeader
        storeName={session.data?.shop.name ?? null}
        period={data ? data.period : null}
        currency={data ? data.currency.code : null}
        currencies={data?.currency.available ?? []}
        updatedAt={updatedAt}
        freshness={data ? describeFreshness(data.freshness, data.period, new Date()) : null}
        loading={loading}
        preset={filters.preset}
        onPreset={(preset) => change({ ...filters, preset })}
        onCurrency={(currency) => change({ ...filters, currency })}
        onRefresh={() => void load(filters)}
      />
      {error && (
        <s-banner tone="critical" heading="Overview unavailable">
          <s-paragraph>{error}</s-paragraph>
          <s-button onClick={() => void load(filters)}>Try again</s-button>
        </s-banner>
      )}
      <SyncNotice status={sync.status} />
      {loading && !data && <OverviewSkeleton />}
      {data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <OverviewView
            data={data}
            topSelling={<TopSelling page={data} />}
            recentOrders={<RecentOrders page={data} />}
            after={
              <>
                <Opportunities data={data} query={detailQuery(data)} />
                <SecondaryInsights data={data} query={detailQuery(data)} />
              </>
            }
          />
        </div>
      )}
      <SyncSection
        status={sync.status}
        error={sync.error}
        starting={sync.starting}
        onResync={() => void sync.resync()}
      />
    </>
  );
}
