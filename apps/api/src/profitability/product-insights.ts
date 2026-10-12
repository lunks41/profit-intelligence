import type { ProductInsight } from '@pi/contracts';
import type { ProductRowData } from '@pi/reports';
import { D, dec, toStored } from '@pi/profit-engine';

type Dec = ReturnType<typeof dec>;

const MIN_REFUND_RATE = '0.15';
const MIN_ORDERS_FOR_RATE = 3;
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** A product with enough orders to judge, of whose sales a big share was refunded. */
export function isHighRefund(r: ProductRowData): boolean {
  const gross = dec(r.grossSales);
  return (
    r.orders >= MIN_ORDERS_FOR_RATE &&
    gross.gt(0) &&
    dec(r.refunds).neg().div(gross).gte(MIN_REFUND_RATE)
  );
}

/** A product whose cost is only Shopify's estimate (and none of whose sales lack a cost). */
export function usesEstimatedCost(r: ProductRowData): boolean {
  return r.costQuality === 'estimated' && r.missingCostLines === 0;
}

const ratio = (part: Dec, whole: Dec): string | null =>
  whole.lte(0) ? null : part.div(whole).toDecimalPlaces(4).toFixed(4);
const percent = (r: string | null) => (r === null ? null : `${(Number(r) * 100).toFixed(1)}%`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const examples = (rows: ProductRowData[], by: (r: ProductRowData) => Dec, n = 3) =>
  [...rows]
    .sort((a, b) => by(b).cmp(by(a)) || a.title.localeCompare(b.title))
    .slice(0, n)
    .map((r) => ({ key: r.productKey, title: r.variant ? `${r.title} (${r.variant})` : r.title }));

/**
 * What a merchant can do to make the products table more complete and more useful, worked out from the rows
 * of the period (not just the page on screen). Each finding says what is wrong, how much of the sales it
 * touches, how to fix it, and gives a few examples. Nothing is invented: a finding appears only when rows
 * back it, and an empty list means there is nothing to fix.
 */
export function productInsights(
  products: ProductRowData[],
  variants: ProductRowData[],
): ProductInsight[] {
  const out: ProductInsight[] = [];
  const totalNet = products.reduce((a, r) => a.plus(dec(r.netSales)), new D(0));
  const net = (r: ProductRowData) => dec(r.netSales);

  const noCost = products.filter((r) => r.missingCostLines > 0);
  if (noCost.length > 0) {
    const amount = noCost.reduce((a, r) => a.plus(net(r)), new D(0));
    const share = ratio(amount, totalNet);
    out.push({
      id: 'missing_cost',
      severity: share !== null && Number(share) >= 0.1 ? 'critical' : 'warning',
      title: `${plural(noCost.length, 'product has', 'products have')} no cost`,
      detail: `${share ? `They are ${percent(share)} of net sales in this period, so ` : ''}their profit is overstated by their full cost, and the totals above are too.`,
      fix: 'Enter a cost for each product, import costs from a CSV file, or set one cost for a whole collection or vendor.',
      count: noCost.length,
      share,
      amount: toStored(amount),
      examples: examples(noCost, net),
      action: { label: 'Add the missing costs', href: '/products?tab=costs&filter=missing' },
    });
  }

  const estimated = products.filter(usesEstimatedCost);
  if (estimated.length > 0) {
    const amount = estimated.reduce((a, r) => a.plus(net(r)), new D(0));
    const share = ratio(amount, totalNet);
    out.push({
      id: 'estimated_cost',
      severity: 'info',
      title: `${plural(estimated.length, 'product uses', 'products use')} Shopify's cost`,
      detail: `${share ? `They are ${percent(share)} of net sales. ` : ''}Shopify's unit cost is used as an estimate, so their profit stays marked as estimated.`,
      fix: 'Confirm each cost, or enter the real landed cost: the purchase price plus freight, duties and packaging.',
      count: estimated.length,
      share,
      amount: toStored(amount),
      examples: examples(estimated, net),
      action: { label: 'Confirm the costs', href: '/products?tab=costs' },
    });
  }

  const losing = products.filter((r) => dec(r.profit).lt(0) && r.missingCostLines === 0);
  if (losing.length > 0) {
    const amount = losing.reduce((a, r) => a.plus(dec(r.profit)), new D(0));
    out.push({
      id: 'loss_making',
      severity: 'critical',
      title: `${plural(losing.length, 'product lost', 'products lost')} money`,
      detail:
        'They cost more to sell than they earned after discounts, refunds, product cost, fees and shipping.',
      fix: 'Check the price and the discounts, recheck the product cost, or stop promoting them until the numbers work.',
      count: losing.length,
      share: ratio(amount.abs(), totalNet),
      amount: toStored(amount),
      examples: examples(losing, (r) => dec(r.profit).neg()),
      action: { label: 'Show the losing products', href: '/products?filter=loss' },
    });
  }

  const refunded = products.filter(isHighRefund);
  if (refunded.length > 0) {
    out.push({
      id: 'high_refunds',
      severity: 'warning',
      title: `${plural(refunded.length, 'product has', 'products have')} a high refund rate`,
      detail: `At least ${Number(MIN_REFUND_RATE) * 100}% of their sales were refunded (products with ${MIN_ORDERS_FOR_RATE} or more orders).`,
      fix: 'Find the reason: size or quality problems, a description that promises too much, or damage in shipping.',
      count: refunded.length,
      share: null,
      amount: toStored(refunded.reduce((a, r) => a.plus(dec(r.refunds)), new D(0))),
      examples: examples(refunded, (r) => dec(r.refunds).neg()),
      action: null,
    });
  }

  const noSku = variants.filter((r) => !r.sku || r.sku.trim() === '');
  if (noSku.length > 0) {
    out.push({
      id: 'no_sku',
      severity: 'info',
      title: `${plural(noSku.length, 'variant has', 'variants have')} no SKU`,
      detail:
        'Without a SKU, variants are hard to tell apart in reports, and cost imports cannot match them by SKU.',
      fix: 'Add a SKU to each variant in the Shopify admin (Products, then the variant). It appears here after the next sync.',
      count: noSku.length,
      share: null,
      amount: null,
      examples: examples(noSku, net),
      action: null,
    });
  }

  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count,
  );
}

/**
 * The shape of a product over the period for the small chart in its row: profit per bucket of days, with at
 * most 30 points. Numbers here are for drawing only; every figure shown is an exact decimal string.
 */
export function profitTrend(
  lines: Array<{ orderDate: string; profit: string }>,
  range: { from: string; to: string },
): number[] {
  const day = 86_400_000;
  const start = Date.parse(`${range.from}T00:00:00Z`);
  const days = Math.max(1, Math.round((Date.parse(`${range.to}T00:00:00Z`) - start) / day) + 1);
  const size = Math.ceil(days / 30);
  const points = new Array<number>(Math.ceil(days / size)).fill(0);
  for (const l of lines) {
    const i = Math.floor((Date.parse(`${l.orderDate}T00:00:00Z`) - start) / day / size);
    if (i >= 0 && i < points.length) points[i]! += Number(l.profit);
  }
  return points.map((p) => Math.round(p * 100) / 100);
}
