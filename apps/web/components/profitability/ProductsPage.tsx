'use client';

import { QualifiersBanner, StatCard, StatGrid } from '../common';
import { Modal } from '../common/Modal';
import { Sparkline } from '../common/sparkline';
import { ProductInsights } from './ProductInsights';
import { BulkCostTools } from './BulkCostDialog';
import { RankCard } from './RankCard';
import { FilterSearch, ShowDropdown } from '../dropdown';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { PeriodPreset, ProductDetailResponse, ProductListResponse } from '@pi/contracts';
import { formatMoney, formatPercent, longDate, periodLabel, spent } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { ErrorBanner, Loading, QualityBadge, RuleNote, SortControls, useApi } from './shared';
import { readParam } from '../../lib/url-params';
import { CostsTab } from '../settings/CostsTab';
import { todayInShop } from '../../lib/shop-time';

type Sort = 'profit' | 'revenue' | 'margin' | 'units' | 'cogs' | 'refunds' | 'title';
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'profit', label: 'Profit' },
  { value: 'revenue', label: 'Net sales' },
  { value: 'margin', label: 'Margin' },
  { value: 'units', label: 'Units sold' },
  { value: 'cogs', label: 'Product cost' },
  { value: 'refunds', label: 'Refunds' },
  { value: 'title', label: 'Name' },
];

const STATUS_FILTERS = ['all', 'missing_cost', 'estimated_cost', 'loss', 'high_refunds'] as const;

const today = todayInShop;

/**
 * The Products screen. The product table is the page: figures first, then the table. Below it the top-selling
 * and top-returned products, what needs attention, and (collapsed) how the numbers add up. Product costs are set
 * in two dialogs opened from here: a row's Set cost (one product) and Bulk Product Cost (import, bulk edit, export).
 */
export function ProductsPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
  });
  const [sort, setSort] = useState<Sort>('profit');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<'products' | 'variants'>('products');
  useEffect(() => {
    const f = readParam('filter', STATUS_FILTERS);
    if (f) setFilter(f);
  }, []);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  // the cost dialogs: closed until asked for. `n` makes the single-product dialog start afresh for each request.
  const [dialog, setDialog] = useState<
    { kind: 'single'; search: string; n: number } | { kind: 'bulk' } | null
  >(null);
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    // old links (/products?tab=costs...) open the cost dialog straight away
    if (readParam('tab', ['profit', 'costs'] as const) === 'costs') {
      setDialog({ kind: 'single', search: '', n: 1 });
    }
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const setCost = (search = '') =>
    setDialog((d) => ({ kind: 'single', search, n: (d?.kind === 'single' ? d.n : 0) + 1 }));

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
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      />
      {data && (
        <SummaryCards
          data={data}
          filters={filters}
          onView={(f) => {
            setFilter(f);
            setView('products');
            setPage(1);
            document.getElementById('products-table')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: '0.75rem',
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
          label="Status"
          value={filter}
          options={[
            { value: 'all', label: 'All products' },
            { value: 'missing_cost', label: 'Cost missing' },
            { value: 'estimated_cost', label: 'Cost estimated' },
            { value: 'loss', label: 'Losing money' },
            { value: 'high_refunds', label: 'High refund rate' },
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
        <div style={{ marginLeft: 'auto' }}>
          <s-button variant="primary" onClick={() => setDialog({ kind: 'bulk' })}>
            Bulk Product Cost
          </s-button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="products" />}
      {data && (
        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div id="products-table" />
          <ProductsTable
            data={data}
            filters={filters}
            onOpen={setSelected}
            onPage={setPage}
            onSetCost={setCost}
          />
        </div>
      )}

      {dialog?.kind === 'single' && (
        <Modal heading="Set product cost" onClose={closeDialog}>
          <CostsTab
            key={dialog.n}
            initialSearch={dialog.search}
            onClose={closeDialog}
            onChanged={() => setSaved((v) => v + 1)}
          />
        </Modal>
      )}
      {dialog?.kind === 'bulk' && (
        <Modal heading="Bulk Product Cost" onClose={closeDialog}>
          <BulkCostTools onSaved={() => setSaved((v) => v + 1)} />
        </Modal>
      )}
    </>
  );
}

/** The four figures that say how the products are doing: sales, profit, and what is missing or losing money. */
function SummaryCards({
  data,
  filters,
  onView,
}: {
  data: ProductListResponse;
  filters: Filters;
  onView: (filter: string) => void;
}) {
  const s = data.summary;
  const cur = data.currency;
  // the names behind the two warning cards (the worst three of each)
  const named = (filter: string, dir: 'asc' | 'desc', count: number) =>
    count > 0
      ? `/profitability/products?${buildListQuery(filters, { sort: 'profit', dir, filter, pageSize: 3 })}`
      : null;
  const missing = useApi<ProductListResponse>(named('missing_cost', 'desc', s.productsMissingCost));
  const losing = useApi<ProductListResponse>(named('loss', 'asc', s.productsLosingMoney));
  const names = (r: ProductListResponse | null, total: number) => {
    if (!r || r.rows.length === 0) return null;
    const list = r.rows.map((x) => x.title).join(', ');
    return total > r.rows.length ? `${list} and ${total - r.rows.length} more` : list;
  };
  return (
    <StatGrid>
      <StatCard
        label="Net sales"
        value={formatMoney(s.netSales, cur)}
        note={`${s.products} products, ${periodLabel(data.period.from, data.period.to)}`}
        info="Gross sales minus discounts and product refunds, before any cost. Tax is never counted, and shipping charged to customers is not part of it."
      />
      <StatCard
        label="Contribution profit"
        value={formatMoney(s.contributionProfit, cur)}
        note="Of the products below"
        info="Revenue (net sales plus shipping charged) minus product cost, payment fees and shipping cost. Advertising and operating expenses are not taken off, so it is the profit the products themselves make. A product with no cost yet is counted without one, so its profit is overstated until you set it."
      />
      <StatCard
        label="Missing costs"
        value={`${s.productsMissingCost} ${s.productsMissingCost === 1 ? 'product' : 'products'}`}
        tone={s.productsMissingCost > 0 ? 'critical' : undefined}
        info="Products sold in this period that have no cost, neither one you entered nor one from Shopify. Their profit is overstated, because a missing cost is never counted as zero."
        action={
          s.productsMissingCost > 0
            ? { label: 'View', onClick: () => onView('missing_cost') }
            : undefined
        }
        note={
          s.productsMissingCost > 0
            ? (names(missing.data, s.productsMissingCost) ?? 'Profit is overstated for these')
            : 'Every product has a cost'
        }
      />
      <StatCard
        label="Loss-making products"
        value={`${s.productsLosingMoney} ${s.productsLosingMoney === 1 ? 'product' : 'products'}`}
        tone={s.productsLosingMoney > 0 ? 'critical' : undefined}
        info="Products whose profit is below zero in this period: what they sold for was less than their cost, fees, shipping and refunds. Products with a missing cost are not counted here, because their real result is not known."
        action={
          s.productsLosingMoney > 0 ? { label: 'View', onClick: () => onView('loss') } : undefined
        }
        note={
          s.productsLosingMoney > 0
            ? (names(losing.data, s.productsLosingMoney) ?? 'They earned less than they cost')
            : 'None lost money'
        }
      />
    </StatGrid>
  );
}

/** A section that stays closed until it is wanted. */
function Expandable({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
          <s-heading>{title}</s-heading>
          <s-button
            variant="tertiary"
            accessibilityLabel={`${open ? 'Hide' : 'Show'} ${title}`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Show'}
          </s-button>
        </s-stack>
        {open && children}
      </s-stack>
    </s-section>
  );
}

function ProductsTable({
  data,
  filters,
  onOpen,
  onPage,
  onSetCost,
}: {
  data: ProductListResponse;
  filters: Filters;
  onOpen: (key: string) => void;
  onPage: (p: number) => void;
  onSetCost: (title: string) => void;
}) {
  const cur = data.currency;
  const rec = data.reconciliation;
  const un = rec.unallocated;
  const query = buildListQuery(filters, {});
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
                <s-table-header>Variant</s-table-header>
                <s-table-header>SKU</s-table-header>
                <s-table-header format="numeric">Units sold</s-table-header>
                <s-table-header format="numeric">Net sales</s-table-header>
                <s-table-header format="numeric">Product cost</s-table-header>
                <s-table-header format="numeric">Contribution profit</s-table-header>
                <s-table-header format="numeric">Margin</s-table-header>
                <s-table-header>Profit trend</s-table-header>
                <s-table-header>Cost status</s-table-header>
                <s-table-header>Actions</s-table-header>
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
                      {r.costQuality === 'missing' ? 'Missing' : formatMoney(spent(r.cogs), cur)}
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
                      <QualityBadge quality={r.costQuality} />
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-300" alignItems="center">
                        <s-button
                          variant="tertiary"
                          accessibilityLabel={`Set cost for ${r.title}`}
                          onClick={() => onSetCost(r.title)}
                        >
                          Set cost
                        </s-button>
                        <s-button
                          variant="tertiary"
                          accessibilityLabel={`Show orders for ${r.title}`}
                          onClick={() => onOpen(r.productKey)}
                        >
                          Orders
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-box paddingInline="base" paddingBlockEnd="base">
              <s-text color="subdued">
                Product cost is money spent, shown as a positive amount and subtracted from net
                sales to give contribution profit.
              </s-text>
            </s-box>
          </s-stack>
        )}
      </s-section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 21.25rem), 1fr))',
          gap: '1rem',
          alignItems: 'stretch',
        }}
      >
        <RankCard
          title="Top selling products"
          mode="selling"
          query={query}
          onOpen={onOpen}
          headerRight={
            <s-text color="subdued">{periodLabel(data.period.from, data.period.to)}</s-text>
          }
        />
        <RankCard
          title="Top returned products"
          mode="returned"
          query={query}
          onOpen={onOpen}
          headerRight={
            <s-text color="subdued">{periodLabel(data.period.from, data.period.to)}</s-text>
          }
        />
      </div>

      <ProductInsights insights={data.insights} currency={cur} />

      <Expandable title="Financial reconciliation and calculation rules">
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
          <Line
            label="Payment fees"
            value={
              isUnknown(rec.qualifiers, 'Payment fees')
                ? 'Missing'
                : formatMoney(spent(un.paymentFees), cur)
            }
          />
          <Line
            label="Shipping cost"
            value={
              isUnknown(rec.qualifiers, 'Shipping cost')
                ? 'Missing'
                : formatMoney(spent(un.shippingCost), cur)
            }
          />
          <Line label="Contribution profit" value={formatMoney(rec.total, cur)} strong />
          <s-text color="subdued">
            {rec.matches
              ? `Matches the Overview figure (${formatMoney(rec.dashboardContributionProfit, cur)}).`
              : `Does not match the Overview figure (${formatMoney(rec.dashboardContributionProfit, cur)}). Please report this.`}
          </s-text>
          <s-text type="strong">How this is calculated</s-text>
          <s-text color="subdued">{data.rule}</s-text>
        </s-stack>
      </Expandable>
    </>
  );
}

/** A cost line the profit leaves out ("Payment fees are missing for ...") is Missing, never $0.00. */
function isUnknown(qualifiers: string[], word: string): boolean {
  return qualifiers.some((q) => q.startsWith(word) && /missing/i.test(q));
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
              <Line
                label="Product cost"
                value={formatMoney(spent(data.product.cogs), data.currency)}
              />
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
                      <s-table-cell>{formatMoney(spent(v.cogs), data.currency)}</s-table-cell>
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
