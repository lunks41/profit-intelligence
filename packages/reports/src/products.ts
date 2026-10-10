import { getProductTitles, getProfitFingerprint, loadPeriodBundles } from '@pi/db';
import type { Db, OrderBundle } from '@pi/db';
import { D, allocateOrder, dec, toStored } from '@pi/profit-engine';
import type { CostStatus, Dec } from '@pi/profit-engine';

export interface ProductRowData {
  /** product id, or "line:<title>" for custom items without a product */
  key: string;
  /** the product's key; the same as `key` on a product row, the owning product on a variant row */
  productKey: string;
  /** variant rows only: the variant title and SKU. On a product row, `sku` lists up to three SKUs. */
  variant: string | null;
  sku: string | null;
  title: string;
  units: number;
  orders: number;
  grossSales: string;
  discounts: string;
  refunds: string;
  netSales: string;
  cogs: string;
  profit: string;
  margin: string | null;
  costQuality: CostStatus;
  missingCostLines: number;
}

export interface ProductLineRecord {
  sku: string | null;
  orderShopifyId: string;
  orderName: string;
  orderDate: string;
  variant: string | null;
  quantity: number;
  grossSales: string;
  discounts: string;
  refunds: string;
  cogs: string;
  profit: string;
  costStatus: CostStatus;
}

export interface Unallocated {
  shippingRevenue: Dec;
  shippingRefund: Dec;
  paymentFees: Dec;
  shippingCost: Dec;
  unlinkedCost: Dec;
}

interface Acc {
  key: string;
  productKey: string;
  variant: string | null;
  skus: Set<string>;
  title: string;
  units: number;
  orders: Set<string>;
  gross: Dec;
  discounts: Dec;
  refunds: Dec;
  cogs: Dec;
  quality: CostStatus;
  missingLines: number;
  lastDate: string;
}

const RANK: Record<CostStatus, number> = { none: 0, actual: 1, estimated: 2, missing: 3 };
const worse = (a: CostStatus, b: CostStatus): CostStatus => (RANK[b] > RANK[a] ? b : a);
const productKey = (productId: string | null, title: string) =>
  productId ?? `line:${title.toLowerCase()}`;

interface Computed {
  acc: Map<string, Acc>;
  accV: Map<string, Acc>;
  lines: Map<string, ProductLineRecord[]>;
  unallocated: Unallocated;
  productIds: Set<string>;
  orders: number;
}

/**
 * Allocating every order of a long period costs seconds for a big shop, and the answer only changes
 * when some order is recalculated. So the allocation for a period with many orders is kept, per
 * shop and period, until the shop's ledger fingerprint changes (any recalculation, new refund or
 * removed order). Small periods are fast and are never kept. Product titles are read again on every
 * request. At most a few results are held, the oldest dropped first.
 */
const keepFromOrders = () => Number(process.env.PRODUCT_CACHE_MIN_ORDERS ?? 2000);
const KEEP_AT_MOST = 4;
const kept = new Map<string, { fingerprint: string; value: Computed }>();

/** Forgets every kept allocation (tests and maintenance). */
export function clearProductCache(): void {
  kept.clear();
}

async function compute(
  db: Db,
  scope: { tenantId: string; shopId: string },
  range: { from: string; to: string },
): Promise<Computed> {
  const bundles = await loadPeriodBundles(db, scope, range);
  const acc = new Map<string, Acc>();
  const accV = new Map<string, Acc>();
  const lines = new Map<string, ProductLineRecord[]>();
  const unallocated: Unallocated = {
    shippingRevenue: new D(0),
    shippingRefund: new D(0),
    paymentFees: new D(0),
    shippingCost: new D(0),
    unlinkedCost: new D(0),
  };
  const productIds = new Set<string>();

  for (const b of bundles) {
    const result = allocateOrder({
      currency: b.currency,
      lines: b.lines,
      entries: b.entries,
      refunds: b.refunds,
    });
    for (const k of Object.keys(unallocated) as Array<keyof Unallocated>) {
      unallocated[k] = unallocated[k].plus(dec(result.unallocated[k]));
    }
    // An order with no lines has nothing to attach product figures to; its entries stay with the order.
    if (b.lines.length === 0) continue;
    result.lines.forEach((l, i) => {
      const src = b.lines[i] as OrderBundle['lines'][number];
      const key = productKey(l.productId, src.title);
      if (l.productId) productIds.add(l.productId);
      const newAcc = (k: string, variant: string | null): Acc => ({
        key: k,
        productKey: key,
        variant,
        skus: new Set(),
        title: src.title,
        units: 0,
        orders: new Set(),
        gross: new D(0),
        discounts: new D(0),
        refunds: new D(0),
        cogs: new D(0),
        quality: 'none',
        missingLines: 0,
        lastDate: '',
      });
      const soldInPeriod = b.entries.some(
        (e) => e.component === 'gross_sales' || e.component === 'cogs',
      );
      // the same figures are added to the product and to its variant, so variants add up to the product
      const add = (p: Acc) => {
        if (b.orderDate >= p.lastDate) {
          p.lastDate = b.orderDate;
          p.title = src.title;
        }
        if (src.sku) p.skus.add(src.sku);
        if (soldInPeriod) p.units += l.quantity;
        p.orders.add(b.orderShopifyId);
        p.gross = p.gross.plus(dec(l.grossSales));
        p.discounts = p.discounts.plus(dec(l.discounts));
        p.refunds = p.refunds.plus(dec(l.productRefunds));
        p.cogs = p.cogs.plus(dec(l.cogs));
        p.quality = worse(p.quality, l.costStatus);
        if (l.costStatus === 'missing') p.missingLines++;
      };
      let p = acc.get(key);
      if (!p) acc.set(key, (p = newAcc(key, null)));
      add(p);
      const vkey = `${key}|${src.sku ?? ''}|${src.variantTitle ?? ''}`;
      let v = accV.get(vkey);
      if (!v) accV.set(vkey, (v = newAcc(vkey, src.variantTitle ?? 'Default')));
      add(v);
      const rec: ProductLineRecord = {
        sku: src.sku,
        orderShopifyId: b.orderShopifyId,
        orderName: b.name,
        orderDate: b.orderDate,
        variant: src.variantTitle,
        quantity: l.quantity,
        grossSales: l.grossSales,
        discounts: l.discounts,
        refunds: l.productRefunds,
        cogs: l.cogs,
        profit: l.profit,
        costStatus: l.costStatus,
      };
      (lines.get(key) ?? lines.set(key, []).get(key)!).push(rec);
    });
  }

  return { acc, accV, lines, unallocated, productIds, orders: bundles.length };
}

/**
 * Allocates every counted order with activity in the period over its products (the approved rule,
 * packages/profit-engine/src/allocate.ts) and groups the result by product. Shared by the product
 * screens and the product report so both always show the same numbers.
 */
export async function productRows(
  db: Db,
  scope: { tenantId: string; shopId: string },
  range: { from: string; to: string },
): Promise<{
  rows: ProductRowData[];
  /** the same figures per variant; the variants of a product add up to its row */
  variantRows: ProductRowData[];
  lines: Map<string, ProductLineRecord[]>;
  unallocated: Unallocated;
}> {
  const key = `${scope.shopId}|${range.from}|${range.to}`;
  const fingerprint = await getProfitFingerprint(db, scope);
  let value = kept.get(key)?.fingerprint === fingerprint ? kept.get(key)!.value : undefined;
  if (!value) {
    value = await compute(db, scope, range);
    kept.delete(key);
    if (value.orders >= keepFromOrders()) {
      kept.set(key, { fingerprint, value });
      while (kept.size > KEEP_AT_MOST) kept.delete(kept.keys().next().value as string);
    }
  }
  const { acc, accV, lines, unallocated, productIds } = value;
  const titles = await getProductTitles(db, scope, [...productIds]);
  const finish = (p: Acc): ProductRowData => {
    const net = p.gross.plus(p.discounts).plus(p.refunds);
    const profit = net.plus(p.cogs);
    const skus = [...p.skus].sort();
    return {
      key: p.key,
      productKey: p.productKey,
      variant: p.variant,
      sku:
        skus.length === 0
          ? null
          : p.variant !== null || skus.length <= 3
            ? skus.slice(0, 3).join(', ')
            : `${skus.slice(0, 3).join(', ')} +${skus.length - 3}`,
      title: titles.get(p.productKey) ?? p.title,
      units: p.units,
      orders: p.orders.size,
      grossSales: toStored(p.gross),
      discounts: toStored(p.discounts),
      refunds: toStored(p.refunds),
      netSales: toStored(net),
      cogs: toStored(p.cogs),
      profit: toStored(profit),
      margin: net.isZero() ? null : profit.div(net).toDecimalPlaces(4).toFixed(4),
      costQuality: p.quality,
      missingCostLines: p.missingLines,
    };
  };
  return {
    rows: [...acc.values()].map(finish),
    variantRows: [...accV.values()].map(finish),
    lines,
    unallocated,
  };
}
