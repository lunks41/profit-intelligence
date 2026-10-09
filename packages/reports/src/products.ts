import { getProductTitles, loadPeriodBundles } from '@pi/db';
import type { Db, OrderBundle } from '@pi/db';
import { D, allocateOrder, dec, toStored } from '@pi/profit-engine';
import type { CostStatus, Dec } from '@pi/profit-engine';

export interface ProductRowData {
  /** product id, or "line:<title>" for custom items without a product */
  key: string;
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
  lines: Map<string, ProductLineRecord[]>;
  unallocated: Unallocated;
}> {
  const bundles = await loadPeriodBundles(db, scope, range);
  const acc = new Map<string, Acc>();
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
      let p = acc.get(key);
      if (!p) {
        p = {
          key,
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
        };
        acc.set(key, p);
      }
      if (b.orderDate >= p.lastDate) {
        p.lastDate = b.orderDate;
        p.title = src.title;
      }
      const soldInPeriod = b.entries.some(
        (e) => e.component === 'gross_sales' || e.component === 'cogs',
      );
      if (soldInPeriod) p.units += l.quantity;
      p.orders.add(b.orderShopifyId);
      p.gross = p.gross.plus(dec(l.grossSales));
      p.discounts = p.discounts.plus(dec(l.discounts));
      p.refunds = p.refunds.plus(dec(l.productRefunds));
      p.cogs = p.cogs.plus(dec(l.cogs));
      p.quality = worse(p.quality, l.costStatus);
      if (l.costStatus === 'missing') p.missingLines++;
      const rec: ProductLineRecord = {
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

  const titles = await getProductTitles(db, scope, [...productIds]);
  const rows: ProductRowData[] = [...acc.values()].map((p) => {
    const net = p.gross.plus(p.discounts).plus(p.refunds);
    const profit = net.plus(p.cogs);
    return {
      key: p.key,
      title: titles.get(p.key) ?? p.title,
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
  });
  return { rows, lines, unallocated };
}
