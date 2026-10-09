'use client';

import { ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { OrderDetailResponse, OrderListResponse, PeriodPreset } from '@pi/contracts';
import { formatMoney, formatPercent, longDate, periodLabel } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, QualityBadge, RuleNote, SortControls, useApi } from './shared';
import { LabelValueRow } from '../common';

type Sort = 'date' | 'name' | 'revenue' | 'cogs' | 'profit' | 'margin';
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'date', label: 'Date' },
  { value: 'profit', label: 'Profit' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'margin', label: 'Margin' },
  { value: 'cogs', label: 'Product cost' },
  { value: 'name', label: 'Order number' },
];

const today = () => new Date().toISOString().slice(0, 10);

export function OrdersPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
    currency: null,
  });
  const [sort, setSort] = useState<Sort>('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const path = `/profitability/orders?${buildListQuery(filters, { sort, dir, filter, search: applied, page })}`;
  const { data, error, loading, reload } = useApi<OrderListResponse>(selected ? null : path);

  if (selected) return <OrderDetail id={selected} onBack={() => setSelected(null)} />;

  return (
    <>
      <FilterBar
        filters={filters}
        currencies={[]}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      >
        <s-search-field
          label="Order number"
          placeholder="#1001"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <ShowDropdown
          label="Show"
          value={filter}
          options={[
            { value: 'all', label: 'All orders' },
            { value: 'loss', label: 'Losing money' },
            { value: 'missing_cost', label: 'Missing some costs' },
            { value: 'refunded', label: 'Refunded' },
            { value: 'excluded', label: 'Not counted' },
          ]}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />
        <SortControls
          options={SORTS}
          sort={sort}
          dir={dir}
          onChange={(s, d) => {
            setSort(s);
            setDir(d);
            setPage(1);
          }}
        />
      </FilterBar>

      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="orders" />}
      {data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <s-section
            padding="none"
            heading={`Orders, ${periodLabel(data.period.from, data.period.to)}`}
          >
            {data.rows.length === 0 ? (
              <s-empty-state heading="No orders match">
                <s-paragraph>Try a longer period or clear the search and filter.</s-paragraph>
              </s-empty-state>
            ) : (
              <s-stack gap="base">
                <s-table
                  paginate
                  hasPreviousPage={data.paging.page > 1}
                  hasNextPage={data.paging.page < data.paging.totalPages}
                  onPreviousPage={() => setPage(data.paging.page - 1)}
                  onNextPage={() => setPage(data.paging.page + 1)}
                >
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Order</s-table-header>
                    <s-table-header>Date</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header format="numeric">Revenue</s-table-header>
                    <s-table-header format="numeric">Product cost</s-table-header>
                    <s-table-header format="numeric">Profit</s-table-header>
                    <s-table-header format="numeric">Margin</s-table-header>
                    <s-table-header>Details</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {data.rows.map((r) => (
                      <s-table-row key={r.orderShopifyId}>
                        <s-table-cell>{r.name}</s-table-cell>
                        <s-table-cell>{longDate(r.orderDate)}</s-table-cell>
                        <s-table-cell>
                          {r.recognized ? (
                            r.partial ? (
                              <s-badge tone="caution">Partial</s-badge>
                            ) : (
                              <s-badge tone="success">Counted</s-badge>
                            )
                          ) : (
                            <s-badge tone="neutral">Not counted</s-badge>
                          )}
                        </s-table-cell>
                        <s-table-cell>
                          {r.recognized ? formatMoney(r.revenue, data.currency) : '—'}
                        </s-table-cell>
                        <s-table-cell>
                          {!r.recognized ? (
                            '—'
                          ) : r.statuses?.cogs === 'missing' ? (
                            <s-badge tone="caution">Missing</s-badge>
                          ) : (
                            formatMoney(r.cogs, data.currency)
                          )}
                        </s-table-cell>
                        <s-table-cell>{formatMoney(r.profit, data.currency)}</s-table-cell>
                        <s-table-cell>{formatPercent(r.margin)}</s-table-cell>
                        <s-table-cell>
                          <s-button
                            variant="tertiary"
                            accessibilityLabel={`Explain order ${r.name}`}
                            onClick={() => setSelected(r.orderShopifyId)}
                          >
                            Explain
                          </s-button>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              </s-stack>
            )}
          </s-section>
        </div>
      )}
    </>
  );
}

const EXCLUSION: Record<string, string> = {
  test_order: 'It is a test order.',
  awaiting_payment: 'It has not been paid yet.',
  cancelled_unpaid: 'It was cancelled before it was paid.',
  voided_or_expired: 'The payment was voided or expired.',
};

function OrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<OrderDetailResponse>(
    `/profitability/orders/${encodeURIComponent(id)}`,
  );

  return (
    <>
      <s-button onClick={onBack}>Back to orders</s-button>
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="the order" />}
      {data && <OrderBody d={data} />}
    </>
  );
}

function OrderBody({ d }: { d: OrderDetailResponse }) {
  const cur = d.currency;
  return (
    <>
      <s-section heading={`Order ${d.order.name}`}>
        <s-stack gap="small-300">
          <s-text color="subdued">
            {longDate(d.order.orderDate)} ·{' '}
            {d.order.financialStatus.replace(/_/g, ' ').toLowerCase()}
          </s-text>
          {!d.order.recognized && (
            <s-banner tone="info" heading="This order is not counted in your profit">
              <s-paragraph>
                {EXCLUSION[d.order.exclusionReason ?? ''] ??
                  d.order.exclusionReason ??
                  'It does not meet the counting rules.'}
              </s-paragraph>
            </s-banner>
          )}
          {d.order.recognized && (
            <>
              <LabelValueRow label="Revenue" value={formatMoney(d.summary.revenue, cur)} />
              <LabelValueRow label="Product cost" value={formatMoney(d.summary.cogs, cur)} />
              <LabelValueRow label="Payment fees" value={formatMoney(d.summary.paymentFees, cur)} />
              <LabelValueRow
                label="Shipping cost"
                value={formatMoney(d.summary.shippingCost, cur)}
              />
              <LabelValueRow label="Profit" value={formatMoney(d.summary.profit, cur)} strong />
              <s-text color="subdued">Margin {formatPercent(d.summary.margin)}</s-text>
              {d.order.partial && <s-badge tone="caution">Partial: some costs are missing</s-badge>}
            </>
          )}
        </s-stack>
      </s-section>

      {d.entries.length > 0 && (
        <s-section heading="Every figure, and how it was worked out">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Item</s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header format="numeric">Amount</s-table-header>
              <s-table-header>Data</s-table-header>
              <s-table-header>How it was worked out</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.entries.map((e, i) => (
                <s-table-row key={`${e.component}-${i}`}>
                  <s-table-cell>
                    {e.label}
                    {e.memo ? ' (info only)' : ''}
                  </s-table-cell>
                  <s-table-cell>{e.line ?? '—'}</s-table-cell>
                  <s-table-cell>{formatMoney(e.amount, cur)}</s-table-cell>
                  <s-table-cell>
                    <StatusBadge status={e.status} />
                  </s-table-cell>
                  <s-table-cell>{e.explanation}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {d.products.length > 0 && (
        <s-section heading="Profit by product in this order">
          <s-stack gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="numeric">Qty</s-table-header>
                <s-table-header format="numeric">Sales</s-table-header>
                <s-table-header format="numeric">Discounts</s-table-header>
                <s-table-header format="numeric">Refunds</s-table-header>
                <s-table-header format="numeric">Cost</s-table-header>
                <s-table-header format="numeric">Profit</s-table-header>
                <s-table-header>Cost data</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.products.map((p, i) => (
                  <s-table-row key={`${p.title}-${i}`}>
                    <s-table-cell>
                      {p.title}
                      {p.variant ? ` (${p.variant})` : ''}
                    </s-table-cell>
                    <s-table-cell>{p.quantity}</s-table-cell>
                    <s-table-cell>{formatMoney(p.grossSales, cur)}</s-table-cell>
                    <s-table-cell>{formatMoney(p.discounts, cur)}</s-table-cell>
                    <s-table-cell>{formatMoney(p.refunds, cur)}</s-table-cell>
                    <s-table-cell>{formatMoney(p.cogs, cur)}</s-table-cell>
                    <s-table-cell>{formatMoney(p.profit, cur)}</s-table-cell>
                    <s-table-cell>
                      <QualityBadge quality={p.costStatus} />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-text color="subdued">
              Not tied to a product: shipping charged{' '}
              {formatMoney(d.unallocated.shippingRevenue, cur)}, shipping refunded{' '}
              {formatMoney(d.unallocated.shippingRefund, cur)}, payment fees{' '}
              {formatMoney(d.unallocated.paymentFees, cur)}, shipping cost{' '}
              {formatMoney(d.unallocated.shippingCost, cur)}.
            </s-text>
          </s-stack>
        </s-section>
      )}
      <RuleNote text={d.rule} />
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; tone: 'success' | 'caution' | 'critical' | 'neutral' }
  > = {
    actual: { label: 'Confirmed', tone: 'success' },
    estimated: { label: 'Estimated', tone: 'caution' },
    missing: { label: 'Missing', tone: 'critical' },
    not_applicable: { label: 'n/a', tone: 'neutral' },
  };
  const m = map[status] ?? { label: status, tone: 'neutral' as const };
  return <s-badge tone={m.tone}>{m.label}</s-badge>;
}
