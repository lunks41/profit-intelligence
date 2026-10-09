'use client';

import { Dropdown, ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { CostHistoryResponse, CostListResponse, CostRow } from '@pi/contracts';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { formatMoney, longDate } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, Saved, isAmount, todayLocal, useAction } from './shared';
import { readParam } from '../../lib/url-params';

const QUALITY = {
  actual: { label: 'Entered by you', tone: 'success' },
  estimated: { label: 'Shopify cost (estimate)', tone: 'caution' },
  missing: { label: 'Missing', tone: 'critical' },
} as const;

export function CostsTab({ onChanged }: { onChanged: () => void }) {
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const f = readParam('filter', ['all', 'missing', 'estimated', 'entered'] as const);
    if (f) setFilter(f);
  }, []);
  const [sort, setSort] = useState('attention');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CostRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const q = new URLSearchParams({ filter, sort, page: String(page), pageSize: '15' });
  if (applied) q.set('search', applied);
  q.set('_', String(reloadKey)); // forces a reload after a save; ignored by the server
  const { data, error, loading, reload } = useApi<CostListResponse>(`/settings/costs?${q}`);

  function saved() {
    setSelected(null);
    setJustSaved(true);
    setReloadKey((k) => k + 1);
    onChanged();
  }

  return (
    <>
      {data && (data.totals.missing > 0 || data.totals.estimated > 0) && (
        <s-banner
          tone={data.totals.missing > 0 ? 'warning' : 'info'}
          heading={
            data.totals.missing > 0
              ? `${data.totals.missing} products have no cost`
              : 'Some costs are Shopify estimates'
          }
        >
          <s-paragraph>
            {data.totals.entered} confirmed by you, {data.totals.estimated} using Shopify&apos;s
            cost, {data.totals.missing} with none. Products sold most recently are listed first.
          </s-paragraph>
        </s-banner>
      )}
      {justSaved && <ApplyBanner onDone={() => setJustSaved(false)} />}

      <s-section heading="Product costs">
        <s-stack gap="base">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
            gap="base"
            alignItems="end"
          >
            <s-search-field
              label="Search"
              placeholder="Product name or SKU"
              value={search}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
            <ShowDropdown
              label="Show"
              value={filter}
              options={[
                { value: 'all', label: 'All products' },
                { value: 'missing', label: 'Cost missing' },
                { value: 'estimated', label: 'Shopify estimate only' },
                { value: 'entered', label: 'Entered by you' },
              ]}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
            />
            <Dropdown
              label="Sort by"
              value={sort}
              options={[
                { value: 'attention', label: 'Needs a cost first' },
                { value: 'name', label: 'Name' },
              ]}
              onChange={(v) => {
                setSort(v);
                setPage(1);
              }}
            />
          </s-grid>

          {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
          {loading && !data && <Loading what="products" />}
          {data && data.rows.length === 0 && (
            <s-empty-state heading="No products match">
              <s-paragraph>Try clearing the search or the filter.</s-paragraph>
            </s-empty-state>
          )}
          {data && data.rows.length > 0 && (
            <div
              aria-busy={loading}
              style={{
                opacity: loading ? 0.6 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <s-stack gap="base">
                <s-table
                  paginate
                  hasPreviousPage={data.paging.page > 1}
                  hasNextPage={data.paging.page < data.paging.totalPages}
                  onPreviousPage={() => setPage(data.paging.page - 1)}
                  onNextPage={() => setPage(data.paging.page + 1)}
                >
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Product</s-table-header>
                    <s-table-header format="numeric">Price</s-table-header>
                    <s-table-header format="numeric">Cost now</s-table-header>
                    <s-table-header>Source</s-table-header>
                    <s-table-header format="numeric">Sold (90 days)</s-table-header>
                    <s-table-header>Action</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {data.rows.map((r) => {
                      const cost = r.merchantCost?.amount ?? r.shopifyCost;
                      const qd = QUALITY[r.quality];
                      return (
                        <s-table-row key={r.variantShopifyId}>
                          <s-table-cell>
                            {r.productTitle}
                            {r.variantTitle && r.variantTitle !== 'Default Title'
                              ? ` (${r.variantTitle})`
                              : ''}
                          </s-table-cell>
                          <s-table-cell>{formatMoney(r.price, data.currency)}</s-table-cell>
                          <s-table-cell>
                            {cost === null ? 'Not set' : formatMoney(cost, data.currency)}
                          </s-table-cell>
                          <s-table-cell>
                            <s-badge tone={qd.tone}>{qd.label}</s-badge>
                          </s-table-cell>
                          <s-table-cell>{r.unitsSold90d}</s-table-cell>
                          <s-table-cell>
                            <s-button
                              variant="tertiary"
                              accessibilityLabel={`Set cost for ${r.productTitle}`}
                              onClick={() => {
                                setJustSaved(false);
                                setSelected(r);
                              }}
                            >
                              {r.merchantCost ? 'Change' : 'Set cost'}
                            </s-button>
                          </s-table-cell>
                        </s-table-row>
                      );
                    })}
                  </s-table-body>
                </s-table>
              </s-stack>
            </div>
          )}
        </s-stack>
      </s-section>

      {selected && data && (
        <CostEditor
          row={selected}
          currency={data.currency}
          onSaved={saved}
          onCancel={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ApplyBanner({ onDone }: { onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [done, setDone] = useState(false);
  return (
    <s-banner tone="success" heading="Cost saved">
      <s-stack gap="small">
        <s-paragraph>
          New orders use it straight away. To fill in existing orders that had no cost, apply it
          now. Costs already used on past orders stay as they are.
        </s-paragraph>
        <FormError message={error} />
        {done ? (
          <s-text>Started. Figures update in a minute or two.</s-text>
        ) : (
          <s-stack direction="inline" gap="small">
            <s-button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                if (await run(() => apiPost('/settings/recalculate', { mode: 'fill_gaps' })))
                  setDone(true);
              }}
            >
              Apply to existing orders
            </s-button>
            <s-button variant="tertiary" onClick={onDone}>
              Not now
            </s-button>
          </s-stack>
        )}
      </s-stack>
    </s-banner>
  );
}

function CostEditor({
  row,
  currency,
  onSaved,
  onCancel,
}: {
  row: CostRow;
  currency: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(row.merchantCost?.amount.replace(/\.?0+$/, '') ?? '');
  const [from, setFrom] = useState(todayLocal());
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const [history, setHistory] = useState<CostHistoryResponse | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    let live = true;
    apiGet<CostHistoryResponse>(`/settings/costs/${row.variantShopifyId}/history`)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
  }, [row.variantShopifyId, historyKey]);

  const amountOk = isAmount(amount);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && from <= todayLocal();

  async function save() {
    setTouched(true);
    if (!amountOk || !dateOk) return;
    const ok = await run(() =>
      apiPut(`/settings/costs/${row.variantShopifyId}`, {
        amount: amount.trim(),
        effectiveFrom: from,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    );
    if (ok) onSaved();
  }

  return (
    <s-section heading={`Cost for ${row.productTitle}`}>
      <s-stack gap="base">
        <s-text color="subdued">
          Price {formatMoney(row.price, currency)}
          {row.shopifyCost !== null
            ? ` · Shopify cost ${formatMoney(row.shopifyCost, currency)}`
            : ''}
        </s-text>
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
          gap="base"
          alignItems="end"
        >
          <s-text-field
            label={`Cost per unit (${currency})`}
            value={amount}
            error={touched && !amountOk ? 'Enter a number such as 12.50' : undefined}
            onInput={(e) => setAmount(e.currentTarget.value)}
          />
          <s-date-field
            label="Applies from"
            value={from}
            error={touched && !dateOk ? 'Choose a date that is not in the future' : undefined}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
          <s-text-field
            label="Note (optional)"
            value={reason}
            onInput={(e) => setReason(e.currentTarget.value)}
          />
        </s-grid>
        <s-text color="subdued">
          Orders from this date on use this cost. Earlier orders keep the cost that applied on their
          day.
        </s-text>
        <FormError message={error} />
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" disabled={busy} onClick={() => void save()}>
            Save cost
          </s-button>
          <s-button onClick={onCancel}>Cancel</s-button>
        </s-stack>

        {history && history.rows.length > 0 && (
          <s-stack gap="small">
            <s-text type="strong">History</s-text>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">From</s-table-header>
                <s-table-header format="numeric">Cost</s-table-header>
                <s-table-header>Entered</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {history.rows.map((h) => (
                  <s-table-row key={h.id}>
                    <s-table-cell>{longDate(h.effectiveFrom)}</s-table-cell>
                    <s-table-cell>{formatMoney(h.amount, history.currency)}</s-table-cell>
                    <s-table-cell>{longDate(h.createdAt.slice(0, 10))}</s-table-cell>
                    <s-table-cell>{h.revokedAt ? 'Replaced or removed' : 'In use'}</s-table-cell>
                    <s-table-cell>
                      {!h.revokedAt && (
                        <RemoveButton
                          id={h.id}
                          onDone={() => {
                            setHistoryKey((k) => k + 1);
                            onSaved();
                          }}
                        />
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

function RemoveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <s-button
      variant="tertiary"
      tone="critical"
      disabled={busy}
      onClick={async () => {
        if (await run(() => apiDelete(`/settings/costs/entry/${id}`))) onDone();
      }}
    >
      Remove
    </s-button>
  );
}

export { Saved };
