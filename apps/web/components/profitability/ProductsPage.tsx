'use client';

import { QualifiersBanner } from '../common';
import { Sparkline } from '../common/sparkline';
import { ProductInsights } from './ProductInsights';
import { FilterSearch, ShowDropdown } from '../dropdown';

import { useEffect, useState } from 'react';
import type { PeriodPreset, ProductDetailResponse, ProductListResponse } from '@pi/contracts';
import { formatMoney, formatPercent, longDate, periodLabel } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, QualityBadge, RuleNote, SortControls, useApi } from './shared';
import { readParam } from '../../lib/url-params';
import { CostsTab } from '../settings/CostsTab';
import { FormError, useAction } from '../settings/shared';
import { downloadText } from '../../lib/import-summary';
import { apiGet } from '../../lib/api';

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

/**
 * The Products screen, in one view: the table first. Product costs are set from here too, without leaving
 * the page: a row's Set cost button, Import costs (CSV), Download template and Set product costs all open the
 * cost tools in a panel above the table, and closing it returns to the table.
 */
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
  const [view, setView] = useState<'products' | 'variants'>('products');
  useEffect(() => {
    const f = readParam('filter', ['all', 'missing_cost', 'loss'] as const);
    if (f) setFilter(f);
  }, []);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  // the cost tools: closed until asked for. `n` makes the panel start afresh for each request.
  const [costs, setCosts] = useState<{ search: string; n: number } | null>(null);
  const [saved, setSaved] = useState(0);
  const template = useAction();
  useEffect(() => {
    // old links (/products?tab=costs...) open the cost tools straight away
    if (readParam('tab', ['profit', 'costs'] as const) === 'costs') setCosts({ search: '', n: 1 });
  }, []);
  const openCosts = (search = '') => setCosts((c) => ({ search, n: (c?.n ?? 0) + 1 }));

  // Wait for the typing to pause before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const path = `/profitability/products?${buildListQuery(filters, { sort, dir, filter, search: applied, page, view })}&_=${saved}`;
  const { data, error, loading, reload } = useApi<ProductListResponse>(selected ? null : path);

  if (selected) {
    return (
      <ProductDetail productKey={selected} filters={filters} onBack={() => setSelected(null)} />
    );
  }

  return (
    <>
      <FilterBar
        chip
        filters={filters}
        currencies={[]}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      >
        <FilterSearch
          label="Search"
          placeholder="Product name or SKU"
          value={search}
          onChange={setSearch}
        />
        <ShowDropdown
          chip
          label="View"
          value={view}
          options={[
            { value: 'products', label: 'By product' },
            { value: 'variants', label: 'By variant and SKU' },
          ]}
          onChange={(v) => {
            setView(v as 'products' | 'variants');
            setPage(1);
          }}
        />
        <ShowDropdown
          chip
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
          chip
          options={SORTS}
          sort={sort}
          dir={dir}
          onChange={(s, d) => {
            setSort(s);
            setDir(d);
            setPage(1);
          }}
        />
        <s-button onClick={() => openCosts()}>Set product costs</s-button>
        <s-button onClick={() => openCosts()}>Import costs (CSV)</s-button>
        <s-button
          variant="tertiary"
          disabled={template.busy}
          onClick={async () => {
            const file = await template.run(() =>
              apiGet<{ csv: string }>('/settings/costs/export'),
            );
            if (file) downloadText('product-costs-template.csv', file.csv);
          }}
        >
          Download template
        </s-button>
      </FilterBar>
      <FormError message={template.error} />

      {costs && (
        <s-stack gap="small">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text type="strong">Set product costs</s-text>
            <s-button variant="tertiary" onClick={() => setCosts(null)}>
              Close
            </s-button>
          </s-stack>
          <CostsTab
            key={costs.n}
            initialSearch={costs.search}
            onChanged={() => setSaved((v) => v + 1)}
          />
        </s-stack>
      )}

      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="products" />}
      {data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <ProductsTable
            data={data}
            onOpen={setSelected}
            onPage={setPage}
            onSetCost={(title) => openCosts(title)}
          />
        </div>
      )}
    </>
  );
}

function ProductsTable({
  data,
  onOpen,
  onPage,
  onSetCost,
}: {
  data: ProductListResponse;
  onOpen: (key: string) => void;
  onPage: (p: number) => void;
  onSetCost: (title: string) => void;
}) {
  const cur = data.currency;
  const rec = data.reconciliation;
  const un = rec.unallocated;
  return (
    <>
      <QualifiersBanner qualifiers={rec.qualifiers} />
      {data.insights.length > 0 && (
        <s-text>
          <s-link href="#product-insights">
            {data.insights.length} {data.insights.length === 1 ? 'thing' : 'things'} to improve
          </s-link>{' '}
          <s-text color="subdued">({data.insights.map((i) => i.title).join('; ')})</s-text>
        </s-text>
      )}
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
                <s-table-header>Variant</s-table-header>
                <s-table-header>SKU</s-table-header>
                <s-table-header format="numeric">Units</s-table-header>
                <s-table-header format="numeric">Net sales</s-table-header>
                <s-table-header format="numeric">Product cost</s-table-header>
                <s-table-header format="numeric">Profit</s-table-header>
                <s-table-header format="numeric">Margin</s-table-header>
                <s-table-header>Profit trend</s-table-header>
                <s-table-header>Cost data</s-table-header>
                <s-table-header>Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((r) => (
                  <s-table-row key={r.key}>
                    <s-table-cell>{r.title}</s-table-cell>
                    <s-table-cell>{r.variant ?? 'All variants'}</s-table-cell>
                    <s-table-cell>{r.sku ?? '—'}</s-table-cell>
                    <s-table-cell>{r.units}</s-table-cell>
                    <s-table-cell>{formatMoney(r.netSales, cur)}</s-table-cell>
                    <s-table-cell>
                      {r.costQuality === 'missing' ? 'Missing' : formatMoney(r.cogs, cur)}
                    </s-table-cell>
                    <s-table-cell>{formatMoney(r.profit, cur)}</s-table-cell>
                    <s-table-cell>
                      {r.costQuality === 'missing' ? '—' : formatPercent(r.margin)}
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ width: '6.5rem' }}>
                        <Sparkline
                          values={r.trend}
                          color={Number(r.profit) >= 0 ? '#047b5d' : '#d72c0d'}
                          height="2rem"
                        />
                      </div>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <QualityBadge quality={r.costQuality} />
                        {(r.costQuality === 'missing' || r.costQuality === 'estimated') && (
                          <s-button variant="tertiary" onClick={() => onSetCost(r.title)}>
                            Set cost
                          </s-button>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        accessibilityLabel={`Show orders for ${r.title}`}
                        onClick={() => onOpen(r.productKey)}
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
      <ProductInsights insights={data.insights} currency={cur} />

      <s-section heading="How products add up to your profit">
        <s-stack gap="small-300">
          <s-text color="subdued">
            Sales, discounts and refunds are split over an order&apos;s products, and each product
            carries its own product cost. Shipping, payment fees and shipping cost belong to the
            whole order, so they are not given to any product. They are listed below as unallocated
            so the products add up to the contribution profit on the Overview.
          </s-text>
          <Line label="All products" value={formatMoney(rec.productProfit, cur)} />
          <Line label="Shipping charged" value={formatMoney(un.shippingRevenue, cur)} />
          <Line label="Shipping refunded" value={formatMoney(un.shippingRefund, cur)} />
          <Line label="Payment fees" value={formatMoney(un.paymentFees, cur)} />
          <Line label="Shipping cost" value={formatMoney(un.shippingCost, cur)} />
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
          {data.variants.length > 1 && (
            <s-section padding="none" heading="By variant">
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Variant</s-table-header>
                  <s-table-header>SKU</s-table-header>
                  <s-table-header format="numeric">Units</s-table-header>
                  <s-table-header format="numeric">Net sales</s-table-header>
                  <s-table-header format="numeric">Cost</s-table-header>
                  <s-table-header format="numeric">Profit</s-table-header>
                  <s-table-header>Cost data</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.variants.map((v) => (
                    <s-table-row key={v.key}>
                      <s-table-cell>{v.variant ?? 'Default'}</s-table-cell>
                      <s-table-cell>{v.sku ?? '—'}</s-table-cell>
                      <s-table-cell>{v.units}</s-table-cell>
                      <s-table-cell>{formatMoney(v.netSales, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(v.cogs, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(v.profit, data.currency)}</s-table-cell>
                      <s-table-cell>
                        <QualityBadge quality={v.costQuality} />
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-section>
          )}
          {data.trend.length > 1 && (
            <s-section heading="Net sales and profit by day">
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Day</s-table-header>
                  <s-table-header format="numeric">Units</s-table-header>
                  <s-table-header format="numeric">Net sales</s-table-header>
                  <s-table-header format="numeric">Profit</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.trend.map((t) => (
                    <s-table-row key={t.date}>
                      <s-table-cell>{longDate(t.date)}</s-table-cell>
                      <s-table-cell>{t.units}</s-table-cell>
                      <s-table-cell>{formatMoney(t.netSales, data.currency)}</s-table-cell>
                      <s-table-cell>{formatMoney(t.profit, data.currency)}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              <s-text color="subdued">
                By order date. Refunds are counted on the day they were processed.
              </s-text>
            </s-section>
          )}
          <s-section heading="Cost history">
            {data.product.missingCostLines > 0 && (
              <s-banner tone="warning" heading="Some sales have no cost">
                <s-paragraph>
                  {data.product.missingCostLines} sold lines of this product have no cost, so its
                  profit is overstated.{' '}
                  <s-link href="/products?tab=costs&filter=missing">Add the cost</s-link>.
                </s-paragraph>
              </s-banner>
            )}
            {data.costHistory.length === 0 ? (
              <s-text color="subdued">
                You have not entered a cost for this product. Orders use Shopify&apos;s current cost
                where it has one (marked as an estimate), otherwise the cost is missing.
              </s-text>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Applies from</s-table-header>
                  <s-table-header>Variant</s-table-header>
                  <s-table-header>SKU</s-table-header>
                  <s-table-header format="numeric">Cost</s-table-header>
                  <s-table-header>Source</s-table-header>
                  <s-table-header>Note</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.costHistory.map((c, i) => (
                    <s-table-row key={`${c.effectiveFrom}-${i}`}>
                      <s-table-cell>
                        {longDate(c.effectiveFrom)}
                        {c.revoked ? ' (removed)' : ''}
                      </s-table-cell>
                      <s-table-cell>{c.variantTitle ?? '—'}</s-table-cell>
                      <s-table-cell>{c.sku ?? '—'}</s-table-cell>
                      <s-table-cell>{formatMoney(c.amount, c.currency)}</s-table-cell>
                      <s-table-cell>{c.source === 'import' ? 'Imported' : 'Entered'}</s-table-cell>
                      <s-table-cell>{c.reason ?? '—'}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
            <s-text color="subdued">
              A new cost applies to orders from its date. Earlier orders keep the cost they used.
            </s-text>
          </s-section>
          <s-section heading="Refund history">
            {data.refundHistory.length === 0 ? (
              <s-text color="subdued">No refunds on this product in the period.</s-text>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header>Order date</s-table-header>
                  <s-table-header>Variant</s-table-header>
                  <s-table-header>SKU</s-table-header>
                  <s-table-header format="numeric">Qty</s-table-header>
                  <s-table-header format="numeric">Refunded</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.refundHistory.map((r, i) => (
                    <s-table-row key={`${r.orderShopifyId}-${i}`}>
                      <s-table-cell>{r.orderName}</s-table-cell>
                      <s-table-cell>{longDate(r.orderDate)}</s-table-cell>
                      <s-table-cell>{r.variant ?? '—'}</s-table-cell>
                      <s-table-cell>{r.sku ?? '—'}</s-table-cell>
                      <s-table-cell>{r.quantity}</s-table-cell>
                      <s-table-cell>{formatMoney(r.refunds, data.currency)}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
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
                  <s-table-header>Variant</s-table-header>
                  <s-table-header>SKU</s-table-header>
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
                      <s-table-cell>{l.variant ?? '—'}</s-table-cell>
                      <s-table-cell>{l.sku ?? '—'}</s-table-cell>
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
