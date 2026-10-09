'use client';

import { QualifiersBanner } from '../common';
import { ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { PeriodPreset, ProductDetailResponse, ProductListResponse } from '@pi/contracts';
import { formatMoney, formatPercent, longDate, periodLabel } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, QualityBadge, RuleNote, SortControls, useApi } from './shared';
import { readParam } from '../../lib/url-params';

type Sort = 'profit' | 'revenue' | 'margin' | 'units' | 'cogs' | 'title';
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'profit', label: 'Profit' },
  { value: 'revenue', label: 'Net sales' },
  { value: 'margin', label: 'Margin' },
  { value: 'units', label: 'Units sold' },
  { value: 'cogs', label: 'Product cost' },
  { value: 'title', label: 'Name' },
];

const today = () => new Date().toISOString().slice(0, 10);

export function ProductsPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
    currency: null,
  });
  const [sort, setSort] = useState<Sort>('profit');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const f = readParam('filter', ['all', 'missing_cost', 'loss'] as const);
    if (f) setFilter(f);
  }, []);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  // Wait for the typing to pause before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const path = `/profitability/products?${buildListQuery(filters, { sort, dir, filter, search: applied, page })}`;
  const { data, error, loading, reload } = useApi<ProductListResponse>(selected ? null : path);

  if (selected) {
    return (
      <ProductDetail productKey={selected} filters={filters} onBack={() => setSelected(null)} />
    );
  }

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
          label="Search by name"
          placeholder="Product name"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <ShowDropdown
          label="Show"
          value={filter}
          options={[
            { value: 'all', label: 'All products' },
            { value: 'missing_cost', label: 'Cost missing' },
            { value: 'loss', label: 'Losing money' },
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
      {loading && !data && <Loading what="products" />}
      {data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <ProductsTable data={data} onOpen={setSelected} onPage={setPage} />
        </div>
      )}
    </>
  );
}

function ProductsTable({
  data,
  onOpen,
  onPage,
}: {
  data: ProductListResponse;
  onOpen: (key: string) => void;
  onPage: (p: number) => void;
}) {
  const cur = data.currency;
  const rec = data.reconciliation;
  const un = rec.unallocated;
  return (
    <>
      <QualifiersBanner qualifiers={rec.qualifiers} />
      <s-section
        padding="none"
        heading={`Products, ${periodLabel(data.period.from, data.period.to)}`}
      >
        {data.rows.length === 0 ? (
          <s-empty-state heading="No products match">
            <s-paragraph>Try a longer period or clear the search and filter.</s-paragraph>
          </s-empty-state>
        ) : (
          <s-stack gap="base">
            <s-table
              paginate
              hasPreviousPage={data.paging.page > 1}
              hasNextPage={data.paging.page < data.paging.totalPages}
              onPreviousPage={() => onPage(data.paging.page - 1)}
              onNextPage={() => onPage(data.paging.page + 1)}
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="numeric">Units</s-table-header>
                <s-table-header format="numeric">Net sales</s-table-header>
                <s-table-header format="numeric">Product cost</s-table-header>
                <s-table-header format="numeric">Profit</s-table-header>
                <s-table-header format="numeric">Margin</s-table-header>
                <s-table-header>Cost data</s-table-header>
                <s-table-header>Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((r) => (
                  <s-table-row key={r.key}>
                    <s-table-cell>{r.title}</s-table-cell>
                    <s-table-cell>{r.units}</s-table-cell>
                    <s-table-cell>{formatMoney(r.netSales, cur)}</s-table-cell>
                    <s-table-cell>{formatMoney(r.cogs, cur)}</s-table-cell>
                    <s-table-cell>{formatMoney(r.profit, cur)}</s-table-cell>
                    <s-table-cell>{formatPercent(r.margin)}</s-table-cell>
                    <s-table-cell>
                      <QualityBadge quality={r.costQuality} />
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        accessibilityLabel={`Show orders for ${r.title}`}
                        onClick={() => onOpen(r.key)}
                      >
                        Orders
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>

      <s-section heading="How products add up to your profit">
        <s-stack gap="small-300">
          <Line label="All products" value={formatMoney(rec.productProfit, cur)} />
          <Line label="Shipping charged" value={formatMoney(un.shippingRevenue, cur)} />
          <Line label="Shipping refunded" value={formatMoney(un.shippingRefund, cur)} />
          <Line label="Payment fees" value={formatMoney(un.paymentFees, cur)} />
          <Line label="Shipping cost" value={formatMoney(un.shippingCost, cur)} />
          {Number(un.advertising) !== 0 && (
            <Line label="Advertising" value={formatMoney(un.advertising, cur)} />
          )}
          <Line label="Contribution profit" value={formatMoney(rec.total, cur)} strong />
          <s-text color="subdued">
            {rec.matches
              ? `Matches the Overview figure (${formatMoney(rec.dashboardContributionProfit, cur)}).`
              : `Does not match the Overview figure (${formatMoney(rec.dashboardContributionProfit, cur)}). Please report this.`}
          </s-text>
        </s-stack>
      </s-section>
      <RuleNote text={data.rule} />
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text type={strong ? 'strong' : undefined}>{label}</s-text>
      <s-text type={strong ? 'strong' : undefined}>{value}</s-text>
    </s-stack>
  );
}

function ProductDetail({
  productKey,
  filters,
  onBack,
}: {
  productKey: string;
  filters: Filters;
  onBack: () => void;
}) {
  const [page, setPage] = useState(1);
  const q = new URLSearchParams(buildListQuery(filters, { page }));
  q.set('key', productKey);
  const { data, error, loading, reload } = useApi<ProductDetailResponse>(
    `/profitability/products/detail?${q.toString()}`,
  );

  return (
    <>
      <s-button onClick={onBack}>Back to products</s-button>
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="orders" />}
      {data && (
        <>
          <s-section heading={data.product.title}>
            <s-stack gap="small-300">
              <Line label="Units sold" value={String(data.product.units)} />
              <Line
                label="Sales before discounts"
                value={formatMoney(data.product.grossSales, data.currency)}
              />
              <Line label="Discounts" value={formatMoney(data.product.discounts, data.currency)} />
              <Line label="Refunds" value={formatMoney(data.product.refunds, data.currency)} />
              <Line label="Product cost" value={formatMoney(data.product.cogs, data.currency)} />
              <Line label="Profit" value={formatMoney(data.product.profit, data.currency)} strong />
              <QualityBadge quality={data.product.costQuality} />
            </s-stack>
          </s-section>
          <s-section heading="Orders that make up these figures">
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
                  <s-table-header format="numeric">Qty</s-table-header>
                  <s-table-header format="numeric">Sales</s-table-header>
                  <s-table-header format="numeric">Discounts</s-table-header>
                  <s-table-header format="numeric">Refunds</s-table-header>
                  <s-table-header format="numeric">Cost</s-table-header>
                  <s-table-header format="numeric">Profit</s-table-header>
                  <s-table-header>Cost data</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.lines.map((l, i) => (
                    <s-table-row key={`${l.orderShopifyId}-${i}`}>
                      <s-table-cell>{l.orderName}</s-table-cell>
                      <s-table-cell>{longDate(l.orderDate)}</s-table-cell>
                      <s-table-cell>{l.quantity}</s-table-cell>
                      <s-table-cell>{formatMoney(l.grossSales, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(l.discounts, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(l.refunds, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(l.cogs, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(l.profit, data.currency)}</s-table-cell>
                      <s-table-cell>
                        <QualityBadge quality={l.costStatus} />
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-stack>
          </s-section>
          <RuleNote text={data.rule} />
        </>
      )}
    </>
  );
}
