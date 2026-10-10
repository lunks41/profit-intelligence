import {
  getAdSpend,
  getOrderAttention,
  getProfitAggregate,
  listCostChanges,
  listOrders,
} from '@pi/db';
import type { CostChange, Db, LeakageSettings } from '@pi/db';
import { D, dec, summarizeFromTotals, toStored } from '@pi/profit-engine';
import { productRows } from './products.js';
import type { ProductRowData } from './products.js';

/**
 * Profit leakage and data quality findings. Every rule is a plain, reproducible comparison of
 * figures the app already shows, against a limit the merchant can see and change. Each finding
 * states the measured fact (evidence), why it matters, where to act, and, only when it is
 * defensible, how much money is involved. Anything that could not be checked because data is
 * missing is said so in `disclosure` rather than guessed.
 */

export type Severity = 'critical' | 'warning' | 'info';

export type FindingRule =
  | 'loss_orders'
  | 'possible_loss'
  | 'negative_margin_products'
  | 'low_margin_products'
  | 'low_margin'
  | 'margin_drop'
  | 'refund_rate'
  | 'shipping_subsidy'
  | 'cost_change'
  | 'missing_costs'
  | 'missing_fees'
  | 'missing_shipping_cost';

export interface Finding {
  id: FindingRule;
  severity: Severity;
  title: string;
  /** the measured fact behind the finding */
  evidence: string;
  /** why it matters */
  why: string;
  action: { label: string; href: string } | null;
  /** money involved, negative when it is a loss; only set when the figure is defensible */
  impact: { amount: string; note: string } | null;
  items: Array<{ label: string; detail: string }>;
  /** what could not be checked because data is missing */
  disclosure: string | null;
}

export interface LeakageInputs {
  currency: string;
  summary: {
    orders: number;
    revenue: string;
    productRefunds: string;
    refundRate: string | null;
    contributionMargin: string | null;
    shippingCost: string;
    shippingRevenue: string;
    partial: boolean;
    missingCostShare: string | null;
  };
  /** the previous period of the same length, when it had enough orders to compare with */
  previous: { orders: number; contributionMargin: string | null } | null;
  /** share (0 to 1) of orders whose fee or shipping cost is missing; null when not tracked at all */
  missing: { fees: number | null; shipping: number | null };
  loss: {
    confirmedCount: number;
    /** negative */
    confirmedAmount: string;
    possibleCount: number;
    worst: Array<{ name: string; profit: string; partial: boolean }>;
  };
  products: ProductRowData[];
  costChanges: CostChange[];
}

/** Fewest orders in a period before a rate or margin is judged: a few orders prove nothing. */
export const MIN_ORDERS = 10;
/** Fewest units of a product before its margin is judged. */
export const MIN_PRODUCT_UNITS = 3;

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function money(amount: string, currency: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Object.is(n, -0) ? 0 : n);
}
const pct = (ratio: string | number, digits = 1) => `${(Number(ratio) * 100).toFixed(digits)}%`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const titleOf = (p: ProductRowData) => p.title;
const hasKnownCost = (p: ProductRowData) =>
  p.costQuality === 'actual' || p.costQuality === 'estimated';

/** A cost change matters for future sales, so it is reported even when the period had no orders. */
function costChangeFindings(input: LeakageInputs, limits: LeakageSettings): Finding[] {
  const out: Finding[] = [];
  const cur = input.currency;
  if (input.costChanges.length > 0) {
    const rows = input.costChanges.map((c) => {
      const oldCost = Number(c.oldCost);
      const newCost = Number(c.newCost);
      const price = Number(c.price);
      const change = ((newCost - oldCost) / oldCost) * 100;
      const marginBefore = price > 0 ? ((price - oldCost) / price) * 100 : null;
      const marginAfter = price > 0 ? ((price - newCost) / price) * 100 : null;
      const points =
        marginBefore !== null && marginAfter !== null ? marginAfter - marginBefore : null;
      return { c, change, points };
    });
    const big = rows.some((r) => r.points !== null && r.points <= -5);
    out.push({
      id: 'cost_change',
      severity: big ? 'warning' : 'info',
      title: `${rows.length} ${plural(rows.length, 'product cost', 'product costs')} changed by ${Number(limits.costChangePct)}% or more`,
      evidence: 'A cost you entered is quite different from the one before it.',
      why: 'A higher cost lowers the margin on every future sale unless the price changes too.',
      action: { label: 'Review product costs', href: '/settings' },
      impact: null,
      items: rows.slice(0, 5).map(({ c, change, points }) => ({
        label:
          c.variantTitle && c.variantTitle !== 'Default Title'
            ? `${c.productTitle} (${c.variantTitle})`
            : c.productTitle,
        detail: `${money(c.oldCost, cur)} to ${money(c.newCost, cur)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%) from ${c.effectiveFrom}${
          points === null
            ? ''
            : `; margin at today’s price ${points >= 0 ? '+' : ''}${points.toFixed(1)} points`
        }`,
      })),
      disclosure: null,
    });
  }

  return out;
}

export function evaluateLeakage(input: LeakageInputs, limits: LeakageSettings): Finding[] {
  const out: Finding[] = [];
  const cur = input.currency;
  const s = input.summary;
  if (s.orders === 0) return costChangeFindings(input, limits); // nothing else to judge without orders

  // 1. Orders that lost money. Only orders whose every cost is known are called losses.
  if (input.loss.confirmedCount > 0) {
    const n = input.loss.confirmedCount;
    out.push({
      id: 'loss_orders',
      severity: 'critical',
      title: `${n} ${plural(n, 'order', 'orders')} lost money`,
      evidence: `Every cost is known for ${plural(n, 'this order', 'these orders')}; together they lost ${money(
        toStored(dec(input.loss.confirmedAmount).abs()),
        cur,
      )}.`,
      why: 'Discounts, shipping or fees were larger than what the products earned.',
      action: { label: 'Review these orders', href: '/orders' },
      impact: {
        amount: input.loss.confirmedAmount,
        note: 'Counts only orders where every cost is known. Costs taken from Shopify are estimates you can confirm in Settings.',
      },
      items: input.loss.worst
        .filter((w) => !w.partial)
        .map((w) => ({ label: w.name, detail: money(w.profit, cur) })),
      disclosure: null,
    });
  }
  if (input.loss.possibleCount > 0) {
    const n = input.loss.possibleCount;
    out.push({
      id: 'possible_loss',
      severity: 'info',
      title: `${n} ${plural(n, 'order', 'orders')} may be losing money`,
      evidence: `Profit is negative, but a cost is missing for ${plural(n, 'this order', 'these orders')}, so it is not confirmed.`,
      why: 'Adding the missing costs shows whether these orders really lose money.',
      action: { label: 'Add missing costs', href: '/settings' },
      impact: null,
      items: input.loss.worst
        .filter((w) => w.partial)
        .map((w) => ({ label: w.name, detail: `${money(w.profit, cur)} before the missing cost` })),
      disclosure: 'No money figure is given because part of the cost is unknown.',
    });
  }

  // 2. Products. Margin here is before shipping and fees (those belong to the order).
  const unchecked = input.products.filter((p) => !hasKnownCost(p)).length;
  const productDisclosure =
    unchecked > 0
      ? `${unchecked} ${plural(unchecked, 'product has', 'products have')} no cost and ${plural(unchecked, 'was', 'were')} not checked.`
      : null;
  const known = input.products.filter(hasKnownCost);

  const negative = known
    .filter((p) => dec(p.profit).lt(0))
    .sort((a, b) => Number(a.profit) - Number(b.profit));
  if (negative.length > 0) {
    const total = negative.reduce((a, p) => a.plus(dec(p.profit)), new D(0));
    out.push({
      id: 'negative_margin_products',
      severity: 'critical',
      title: `${negative.length} ${plural(negative.length, 'product sells', 'products sell')} below cost`,
      evidence: `After discounts and refunds, ${plural(negative.length, 'it earned', 'they earned')} less than ${plural(negative.length, 'it', 'they')} cost.`,
      why: 'Every sale of these products loses money before shipping and fees are even counted.',
      action: { label: 'Review these products', href: '/products' },
      impact: {
        amount: toStored(total),
        note: 'Before shipping and fees, so the real loss is larger. Costs from Shopify are estimates.',
      },
      items: negative.slice(0, 5).map((p) => ({
        label: titleOf(p),
        detail: `${money(p.profit, cur)} on ${p.units} ${plural(p.units, 'unit', 'units')}`,
      })),
      disclosure: productDisclosure,
    });
  }

  const low = known
    .filter(
      (p) =>
        p.units >= MIN_PRODUCT_UNITS &&
        dec(p.profit).gte(0) &&
        p.margin !== null &&
        Number(p.margin) * 100 < Number(limits.marginPct),
    )
    .sort((a, b) => Number(a.margin) - Number(b.margin));
  if (low.length > 0) {
    out.push({
      id: 'low_margin_products',
      severity: 'warning',
      title: `${low.length} ${plural(low.length, 'product has', 'products have')} a margin below ${Number(limits.marginPct)}%`,
      evidence: `Margin before shipping and fees is under your limit of ${Number(limits.marginPct)}%.`,
      why: 'Shipping and fees come out of a thin margin, so these products may not pay for themselves.',
      action: { label: 'Review these products', href: '/products' },
      impact: null,
      items: low.slice(0, 5).map((p) => ({
        label: titleOf(p),
        detail: `${pct(p.margin!)} on ${p.units} units`,
      })),
      disclosure: productDisclosure
        ? `${productDisclosure} Products with fewer than ${MIN_PRODUCT_UNITS} units were not judged.`
        : `Products with fewer than ${MIN_PRODUCT_UNITS} units were not judged.`,
    });
  }

  // 3. Overall margin.
  if (s.orders >= MIN_ORDERS && s.contributionMargin !== null) {
    const margin = Number(s.contributionMargin) * 100;
    if (margin < Number(limits.marginPct)) {
      const prev =
        input.previous &&
        input.previous.orders >= MIN_ORDERS &&
        input.previous.contributionMargin !== null
          ? ` It was ${pct(input.previous.contributionMargin)} in the previous period.`
          : '';
      out.push({
        id: 'low_margin',
        severity: margin < 0 ? 'critical' : 'warning',
        title:
          margin < 0
            ? 'Your contribution margin is negative'
            : `Your contribution margin is below ${Number(limits.marginPct)}%`,
        evidence: `The margin for this period is ${pct(s.contributionMargin)}, under your limit of ${Number(limits.marginPct)}%.${prev}`,
        why: 'Overheads and expenses still have to be paid out of this margin.',
        action: { label: 'See profit by product', href: '/products' },
        impact: null,
        items: [],
        disclosure: s.partial
          ? 'Some costs are missing, so the real margin is lower than shown.'
          : null,
      });
    }
  }

  if (
    s.orders >= MIN_ORDERS &&
    input.previous &&
    input.previous.orders >= MIN_ORDERS &&
    s.contributionMargin !== null &&
    input.previous.contributionMargin !== null
  ) {
    const drop = Number(input.previous.contributionMargin) - Number(s.contributionMargin);
    if (drop >= 0.1) {
      out.push({
        id: 'margin_drop',
        severity: drop >= 0.2 ? 'critical' : 'warning',
        title: 'Contribution margin dropped sharply',
        evidence: `It is ${pct(s.contributionMargin)} now and was ${pct(input.previous.contributionMargin)} in the previous period, ${(drop * 100).toFixed(1)} points lower.`,
        why: 'A sudden drop usually means discounts, refunds, costs or ad spend changed.',
        action: { label: 'Compare profit', href: '/profit' },
        impact: null,
        items: [],
        disclosure: s.partial
          ? 'Some costs are missing, so the size of the drop is not fully known.'
          : null,
      });
    }
  }

  // 4. Refund rate.
  if (
    s.orders >= MIN_ORDERS &&
    s.refundRate !== null &&
    Number(s.refundRate) * 100 > Number(limits.refundRatePct)
  ) {
    const rate = Number(s.refundRate) * 100;
    const top = [...input.products]
      .filter((p) => dec(p.refunds).lt(0))
      .sort((a, b) => Number(a.refunds) - Number(b.refunds))
      .slice(0, 3);
    out.push({
      id: 'refund_rate',
      severity: rate >= Number(limits.refundRatePct) * 2 ? 'critical' : 'warning',
      title: `Refunds are ${pct(s.refundRate)} of sales`,
      evidence: `Customers were refunded ${money(s.productRefunds, cur)}, above your limit of ${Number(limits.refundRatePct)}%.`,
      why: 'A refund returns the revenue, but the product cost and shipping are usually not recovered.',
      action: { label: 'See the most refunded products', href: '/products' },
      impact: {
        amount: toStored(dec(s.productRefunds).neg()),
        note: 'Money already paid back to customers in this period.',
      },
      items: top.map((p) => ({
        label: titleOf(p),
        detail: `${money(toStored(dec(p.refunds).abs()), cur)} refunded`,
      })),
      disclosure: null,
    });
  }

  // 5. Shipping paid for the customer. Only judged when a shipping cost rule exists.
  const shipCost = dec(s.shippingCost);
  const shipCharged = dec(s.shippingRevenue);
  if (s.orders >= MIN_ORDERS && shipCost.gt(0) && shipCost.gt(shipCharged)) {
    const gap = shipCost.minus(shipCharged);
    out.push({
      id: 'shipping_subsidy',
      severity: 'warning',
      title: 'Shipping costs more than you charge for it',
      evidence: `You charged ${money(toStored(shipCharged), cur)} for shipping and your shipping rule puts the cost at ${money(
        toStored(shipCost),
        cur,
      )}.`,
      why: 'The difference comes straight out of profit on every order.',
      action: { label: 'Review shipping rates and your shipping cost rule', href: '/settings' },
      impact: {
        amount: toStored(gap.neg()),
        note: 'Shipping cost is an estimate from your rule, not a carrier bill.',
      },
      items: [],
      disclosure: null,
    });
  }

  out.push(...costChangeFindings(input, limits));

  // 7. Data quality: gaps that stop the figures above from being trusted.
  if (
    s.missingCostShare !== null &&
    Number(s.missingCostShare) * 100 > Number(limits.missingCostPct)
  ) {
    const share = Number(s.missingCostShare) * 100;
    out.push({
      id: 'missing_costs',
      severity: share >= 30 ? 'critical' : 'warning',
      title: `${share.toFixed(1)}% of your sales have no product cost`,
      evidence: `Your limit is ${Number(limits.missingCostPct)}%. Profit counts these items as unknown, not as free.`,
      why: 'Without a cost, profit is overstated and cannot be called confirmed.',
      action: { label: 'Add product costs', href: '/settings' },
      impact: null,
      items: [],
      disclosure: null,
    });
  }
  if (input.missing.fees !== null && input.missing.fees > 0.1) {
    out.push({
      id: 'missing_fees',
      severity: 'warning',
      title: 'Payment fees are not set',
      evidence: `${pct(input.missing.fees, 0)} of orders have no fee data or fee rule.`,
      why: 'Payment fees are a real cost on every order; leaving them out overstates profit.',
      action: { label: 'Set a payment fee rule', href: '/settings' },
      impact: null,
      items: [],
      disclosure: null,
    });
  }
  if (input.missing.shipping !== null && input.missing.shipping > 0.1) {
    out.push({
      id: 'missing_shipping_cost',
      severity: 'warning',
      title: 'Shipping costs are not set',
      evidence: `${pct(input.missing.shipping, 0)} of shipped orders have no shipping cost rule.`,
      why: 'Shopify does not report what you pay carriers; without a rule that cost is left out.',
      action: { label: 'Set a shipping cost rule', href: '/settings' },
      impact: null,
      items: [],
      disclosure: null,
    });
  }

  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => ORDER[a.f.severity] - ORDER[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}

type Scope = { tenantId: string; shopId: string };
type Range = { from: string; to: string };

/** Reads the figures the rules need, for a period and the one before it. */
export async function gatherLeakageInputs(
  db: Db,
  scope: Scope,
  range: Range,
  previous: Range,
  currency: string,
  limits: LeakageSettings,
): Promise<LeakageInputs> {
  const [agg, aggPrev, ads, attention, worst, products, changes] = await Promise.all([
    getProfitAggregate(db, scope, range),
    getProfitAggregate(db, scope, previous),
    getAdSpend(db, scope, range),
    getOrderAttention(db, scope, range),
    listOrders(db, scope, range, {
      filter: 'loss',
      sort: 'profit',
      dir: 'asc',
      page: 1,
      pageSize: 8,
    }),
    productRows(db, scope, range),
    listCostChanges(db, scope, range.from, range.to, limits.costChangePct),
  ]);
  const adsNow = ads.byAccount.reduce((a, x) => a.plus(dec(x.spend)), new D(0));
  const mk = (a: typeof agg, spend: InstanceType<typeof D> | null) =>
    summarizeFromTotals(a.totals, {
      orderCount: a.orderCount,
      coverage: a.coverage,
      anyMissing: a.anyMissing,
      adSpend: spend && !spend.isZero() ? { amount: toStored(spend), status: 'actual' } : null,
    });
  const now = mk(agg, adsNow);
  const prev = mk(aggPrev, null);

  const share = (c: Record<'actual' | 'estimated' | 'missing', number> | null) => {
    if (!c) return null;
    const total = c.actual + c.estimated + c.missing;
    return total === 0 ? null : c.missing / total;
  };
  return {
    currency,
    summary: {
      orders: agg.orderCount,
      revenue: now.revenue,
      productRefunds: now.productRefunds,
      refundRate: now.refundRate,
      contributionMargin: now.contributionMargin,
      shippingCost: now.shippingCost,
      shippingRevenue: now.shippingRevenue,
      partial: now.partial,
      missingCostShare: now.missingCostShare,
    },
    previous: { orders: aggPrev.orderCount, contributionMargin: prev.contributionMargin },
    missing: { fees: share(agg.coverage.fees), shipping: share(agg.coverage.shipping) },
    loss: {
      confirmedCount: attention.confirmedLoss.count,
      confirmedAmount: attention.confirmedLoss.amount,
      possibleCount: attention.possibleLoss,
      worst: worst.rows
        .filter((r) => r.profit !== null)
        .map((r) => ({ name: r.name, profit: r.profit!, partial: r.partial })),
    },
    products: products.rows,
    costChanges: changes,
  };
}

/** The findings for a period, from the database. Used by the screen and by the daily scan. */
export async function leakageFindings(
  db: Db,
  scope: Scope,
  range: Range,
  previous: Range,
  currency: string,
  limits: LeakageSettings,
): Promise<Finding[]> {
  return evaluateLeakage(
    await gatherLeakageInputs(db, scope, range, previous, currency, limits),
    limits,
  );
}
