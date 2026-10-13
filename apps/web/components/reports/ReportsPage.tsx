'use client';

import { FileTypeDropdown, FilterSearch, ReportDropdown, ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { ExportRowResponse, PeriodPreset, ReportTableResponse } from '@pi/contracts';
import { apiGet, apiPost, downloadFile } from '../../lib/api';
import { buildListQuery } from '../../lib/query';
import { readParam } from '../../lib/url-params';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from '../settings/shared';
import { PlanLock } from '../common/PlanLock';
import { forgetPlan, planWith, usePlan } from '../../lib/plan';
import type { REPORTS } from './catalog';
import { LtvReport } from './LtvReport';
import { Notifications } from './Notifications';
import { ReportTable } from './ReportTable';
import { todayInShop } from '../../lib/shop-time';

type Tab = 'reports' | 'ltv' | 'notifications';

const today = todayInShop;

export function ReportsPage() {
  const plan = usePlan();
  const [tab, setTab] = useState<Tab>('reports');
  useEffect(() => {
    const t = readParam('tab', ['reports', 'ltv', 'notifications'] as const);
    if (t) setTab(t);
  }, []);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  return (
    <>
      <s-stack direction="inline" gap="small">
        {(
          [
            ['reports', 'Reports'],
            ['ltv', plan && !plan.entitlements.ltvReport ? '🔒 LTV' : 'LTV'],
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
      {tab === 'reports' && <Preview />}
      {tab === 'ltv' && <LtvReport />}
      {tab === 'notifications' && <Notifications version={version} onChanged={refresh} />}
    </>
  );
}

function Preview() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
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

  const plan = usePlan();
  const exportsUsedUp =
    plan !== null && plan.usage.exportsThisMonth >= plan.entitlements.exportsPerMonth;
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Asks for the file, waits while it is prepared in the background (the top bar says so), and downloads it as soon as
   * it is ready. A big report can take a minute; after two minutes the merchant is told to try again.
   */
  async function downloadReport() {
    if (exportsUsedUp) return;
    setNote(null);
    setPreparing(true);
    try {
      const body = {
        kind,
        format,
        preset: filters.preset,
        ...(filters.preset === 'custom' ? { from: filters.from, to: filters.to } : {}),
      };
      const queued = await download.run(() => apiPost<ExportRowResponse>('/reports/exports', body));
      if (!queued) return;
      let current = queued;
      const deadline = Date.now() + 120_000;
      while (
        (current.status === 'queued' || current.status === 'running') &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 1500));
        const list = await apiGet<{ rows: ExportRowResponse[] }>('/reports/exports');
        current = list.rows.find((r) => r.id === queued.id) ?? current;
      }
      if (current.status === 'ready') {
        await download.run(() =>
          downloadFile(`/reports/exports/${queued.id}/download`, `${kind}.${format}`),
        );
      } else if (current.status === 'failed') {
        setNote(
          `The file could not be prepared${current.error ? `: ${current.error}` : ''}. Try again.`,
        );
      } else {
        setNote('The file is taking longer than usual. Try again in a minute.');
      }
    } finally {
      forgetPlan();
      setPreparing(false);
    }
  }

  return (
    <>
      <FilterBar chip filters={filters} onChange={setFilters}>
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
        <s-button
          variant="primary"
          loading={preparing}
          disabled={preparing || exportsUsedUp}
          onClick={() => void downloadReport()}
        >
          {preparing ? 'Preparing…' : 'Download'}
        </s-button>
      </FilterBar>
      <FormError message={download.error ?? note} />
      {plan && exportsUsedUp && (
        <PlanLock
          plan={planWith(plan.plan, (e) => e.exportsPerMonth > plan.entitlements.exportsPerMonth)}
        >
          {`Your ${plan.plan} plan includes ${plan.entitlements.exportsPerMonth} report files a month and they are used. The reports stay on screen; downloads open again next month.`}
        </PlanLock>
      )}
      {lists && (
        <s-text color="subdued">
          Search, filter and sort change what you see here. A download always has every row.
        </s-text>
      )}
      {orders && (
        <s-banner tone="info" heading="The order report is large">
          <s-paragraph>
            It is prepared in the background, which can take a minute. Choose a file type and press
            Download; the file downloads by itself when it is ready.
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
