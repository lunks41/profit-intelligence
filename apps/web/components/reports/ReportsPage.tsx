'use client';

import { FileTypeDropdown, FilterSearch, ReportDropdown, ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { PeriodPreset, ReportTableResponse } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { buildListQuery } from '../../lib/query';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from '../settings/shared';
import type { REPORTS } from './catalog';
import { Downloads } from './Downloads';
import { Notifications } from './Notifications';
import { ReportTable } from './ReportTable';
import { Schedules } from './Schedules';

type Tab = 'reports' | 'downloads' | 'schedules' | 'notifications';

const today = () => new Date().toISOString().slice(0, 10);

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('reports');
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  return (
    <>
      <s-stack direction="inline" gap="small">
        {(
          [
            ['reports', 'Reports'],
            ['downloads', 'Downloads'],
            ['schedules', 'Scheduled emails'],
            ['notifications', 'Notifications'],
          ] as const
        ).map(([id, label]) => (
          <s-button
            key={id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </s-button>
        ))}
      </s-stack>
      {tab === 'reports' && (
        <Preview
          onQueued={() => {
            refresh();
            setTab('downloads');
          }}
        />
      )}
      {tab === 'downloads' && <Downloads version={version} onChanged={refresh} />}
      {tab === 'schedules' && <Schedules version={version} onChanged={refresh} />}
      {tab === 'notifications' && <Notifications version={version} onChanged={refresh} />}
    </>
  );
}

function Preview({ onQueued }: { onQueued: () => void }) {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
    currency: null,
  });
  const [kind, setKind] = useState<(typeof REPORTS)[number]['id']>('profit_loss');
  const download = useAction();
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  // refunds and missing costs can be searched, filtered and sorted on screen; a download has every row
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('default');
  const lists = kind === 'refunds' || kind === 'missing_costs';
  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setSearch('');
    setApplied('');
    setStatus('all');
    setSort('default');
  }, [kind]);

  const query = buildListQuery(filters, {
    kind,
    search: lists ? applied : undefined,
    filter: kind === 'missing_costs' ? status : undefined,
    sort: lists ? sort : undefined,
  });
  const orders = kind === 'orders';
  const { data, error, loading, reload } = useApi<ReportTableResponse>(
    orders ? null : `/reports/preview?${query}`,
  );

  async function queueExport() {
    const body = {
      kind,
      format,
      preset: filters.preset,
      ...(filters.preset === 'custom' ? { from: filters.from, to: filters.to } : {}),
    };
    if (await download.run(() => apiPost('/reports/exports', body))) onQueued();
  }

  return (
    <>
      <FilterBar chip filters={filters} currencies={[]} onChange={setFilters}>
        <ReportDropdown chip value={kind} onChange={(v) => setKind(v as typeof kind)} />
        {lists && (
          <FilterSearch
            label={kind === 'refunds' ? 'Order or product' : 'Product or SKU'}
            placeholder={kind === 'refunds' ? '#1001 or shirt' : 'shirt or SKU-1'}
            value={search}
            onChange={setSearch}
          />
        )}
        {kind === 'missing_costs' && (
          <ShowDropdown
            chip
            label="Show"
            value={status}
            options={[
              { value: 'all', label: 'Missing and estimated' },
              { value: 'missing', label: 'No cost known' },
              { value: 'estimated', label: 'Shopify estimate only' },
            ]}
            onChange={setStatus}
          />
        )}
        {lists && (
          <ShowDropdown
            chip
            label="Sort by"
            value={sort}
            options={[
              {
                value: 'default',
                label: kind === 'refunds' ? 'Newest first' : 'Largest sales first',
              },
              { value: 'name', label: 'Product name' },
              ...(kind === 'refunds' ? [{ value: 'amount', label: 'Largest refund' }] : []),
            ]}
            onChange={setSort}
          />
        )}
        <FileTypeDropdown chip value={format} onChange={setFormat} />
        <s-button variant="primary" disabled={download.busy} onClick={() => void queueExport()}>
          Prepare download
        </s-button>
      </FilterBar>
      <FormError message={download.error} />
      {lists && (
        <s-text color="subdued">
          Search, filter and sort change what you see here. A download always has every row.
        </s-text>
      )}
      {orders && (
        <s-banner tone="info" heading="The order report is large">
          <s-paragraph>
            It is prepared in the background. Choose a file type and press Prepare download, then
            open it from the Downloads tab.
          </s-paragraph>
        </s-banner>
      )}
      {!orders && error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {!orders && loading && !data && <Loading what="the report" />}
      {!orders && data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <ReportTable report={data} />
        </div>
      )}
    </>
  );
}
