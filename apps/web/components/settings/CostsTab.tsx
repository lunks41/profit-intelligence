'use client';

import { Dropdown, ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { CostHistoryResponse, CostListResponse, CostRow } from '@pi/contracts';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';

import { formatMoney, longDate } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, Saved, isAmount, todayLocal, useAction } from './shared';
import { readParam } from '../../lib/url-params';

const ALL = 'all-variants';

const QUALITY = {
  actual: { label: 'Entered by you', tone: 'success' },
  estimated: { label: 'Shopify cost (estimate)', tone: 'caution' },
  missing: { label: 'Missing', tone: 'critical' },
} as const;

export function CostsTab({
  onChanged,
  initialSearch = '',
  onClose,
}: {
  onChanged: () => void;
  /** closes the dialog the tab is in (used by the one-product form) */
  onClose?: () => void;
  /** open already searching for this product (the row's Set cost button) */
  initialSearch?: string;
}) {
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const f = readParam('filter', ['all', 'missing', 'estimated', 'entered'] as const);
    if (f) setFilter(f);
  }, []);
  const [sort, setSort] = useState('attention');
  const [search, setSearch] = useState(initialSearch);
  const [applied, setApplied] = useState(initialSearch);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CostRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  // opened from one product's Set cost button: show that product's form, not the whole list
  const [focused, setFocused] = useState(initialSearch !== '');
  const [allVariants, setAllVariants] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const q = new URLSearchParams({
    filter,
    sort,
    page: String(page),
    pageSize: focused ? '50' : '15',
  });
  if (applied) q.set('search', applied);
  q.set('_', String(reloadKey)); // forces a reload after a save; ignored by the server
  const { data, error, loading, reload } = useApi<CostListResponse>(`/settings/costs?${q}`);

  const matches = data
    ? data.rows.filter((r) => r.productTitle === initialSearch).length > 0
      ? data.rows.filter((r) => r.productTitle === initialSearch)
      : data.rows
    : [];
  useEffect(() => {
    if (focused && !selected && !justSaved && matches.length > 0) setSelected(matches[0]!);
  }, [focused, selected, justSaved, matches]);

  function saved() {
    setSelected(null);
    setJustSaved(true);
    setReloadKey((k) => k + 1);
    onChanged();
  }

  if (focused) {
    return (
      <>
        {justSaved && <ApplyBanner onDone={() => setJustSaved(false)} />}
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
        {loading && !data && <Loading what="product" />}
        {justSaved ? (
          <div>
            <s-button variant="primary" onClick={onClose}>
              Done
            </s-button>
          </div>
        ) : selected && data ? (
          <>
            {matches.length > 1 && (
              <Dropdown
                label="Variant"
                value={allVariants ? ALL : String(selected.variantShopifyId)}
                options={[
                  { value: ALL, label: `All ${matches.length} variants (one cost for all)` },
                  ...matches.map((r) => ({
                    value: String(r.variantShopifyId),
                    label: `${r.variantTitle || 'Default'} (${
                      (r.merchantCost?.amount ?? r.shopifyCost)
                        ? formatMoney((r.merchantCost?.amount ?? r.shopifyCost)!, data.currency)
                        : 'no cost'
                    })`,
                  })),
                ]}
                onChange={(v) => {
                  setAllVariants(v === ALL);
                  if (v !== ALL)
                    setSelected(matches.find((r) => String(r.variantShopifyId) === v) ?? selected);
                }}
              />
            )}
            <CostEditor
              key={allVariants ? ALL : selected.variantShopifyId}
              row={selected}
              allIds={allVariants ? matches.map((r) => r.variantShopifyId) : undefined}
              currency={data.currency}
              onSaved={saved}
              onCancel={() => onClose?.()}
            />
          </>
        ) : (
          data && (
            <s-section heading={initialSearch}>
              <s-stack gap="base">
                <s-text color="subdued">
                  {matches.length === 0
                    ? 'No variant found for this product.'
                    : 'Choose the variant to set a cost for.'}
                </s-text>
                {matches.map((r) => (
                  <s-stack
                    key={r.variantShopifyId}
                    direction="inline"
                    gap="base"
                    alignItems="center"
                  >
                    <s-text>{r.variantTitle || 'Default'}</s-text>
                    <s-text color="subdued">
                      {(r.merchantCost?.amount ?? r.shopifyCost)
                        ? formatMoney(r.merchantCost?.amount ?? r.shopifyCost!, data.currency)
                        : 'No cost'}
                    </s-text>
                    <s-button variant="tertiary" onClick={() => setSelected(r)}>
                      {r.merchantCost ? 'Change' : 'Set cost'}
                    </s-button>
                  </s-stack>
                ))}
                <div>
                  <s-button variant="tertiary" onClick={() => setFocused(false)}>
                    Show all products
                  </s-button>
                </div>
              </s-stack>
            </s-section>
          )
        )}
      </>
    );
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
  allIds,
  currency,
  onSaved,
  onCancel,
}: {
  row: CostRow;
  /** set when one cost is saved for every variant of the product */
  allIds?: string[];
  currency: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(
    allIds ? '' : (row.merchantCost?.amount.replace(/\.?0+$/, '') ?? ''),
  );
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
      allIds
        ? apiPost('/settings/costs/bulk', {
            amount: amount.trim(),
            effectiveFrom: from,
            by: 'variants',
            value: allIds.join(','),
          })
        : apiPut(`/settings/costs/${row.variantShopifyId}`, {
            amount: amount.trim(),
            effectiveFrom: from,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
    );
    if (ok) onSaved();
  }

  return (
    <s-section
      heading={
        allIds
          ? `Cost for all ${allIds.length} variants of ${row.productTitle}`
          : `Cost for ${row.productTitle}`
      }
    >
      <s-stack gap="base">
        {allIds && (
          <s-banner tone="info" heading={`One cost for all ${allIds.length} variants`}>
            <s-paragraph>
              The cost you enter is saved for every variant of this product, from the date you
              choose. Variants that already have a cost get a new entry in their history; earlier
              orders keep the cost they used. Use the variant list to set one variant on its own.
            </s-paragraph>
          </s-banner>
        )}
        {!allIds && (
          <s-text color="subdued">
            Price {formatMoney(row.price, currency)}
            {row.shopifyCost !== null
              ? ` · Shopify cost ${formatMoney(row.shopifyCost, currency)}`
              : ''}
          </s-text>
        )}
        {!allIds && (
          <s-banner
            tone={row.merchantCost ? 'info' : row.quality === 'estimated' ? 'warning' : 'critical'}
            heading={
              row.merchantCost
                ? `Current cost ${formatMoney(row.merchantCost.amount, currency)} (entered by you)`
                : row.quality === 'estimated'
                  ? 'No cost entered: Shopify\u2019s cost is used as an estimate'
                  : 'No cost yet: profit for this product is overstated'
            }
          >
            <s-paragraph>
              {row.merchantCost
                ? `Applies from ${longDate(row.merchantCost.effectiveFrom)}. Saving a new cost adds it to the history from the date you choose; it never rewrites earlier orders.`
                : 'A missing cost is never treated as zero. Enter the cost per unit in US dollars (USD).'}
            </s-paragraph>
          </s-banner>
        )}
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
          gap="base"
          alignItems="end"
        >
          <s-text-field
            label="Cost per unit (USD)"
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

        {!allIds && history && history.rows.length > 0 && (
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
