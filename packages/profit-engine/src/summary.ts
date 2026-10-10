import { D, dec, ratio, toStored } from './money.js';
import type { Dec } from './money.js';
import type { Component, Status } from './types.js';

/** The part of a ledger entry the summary needs. `orderKey` groups entries of the same order. */
export interface SummaryEntry {
  orderKey: string | number;
  component: Component;
  amount: string;
  status: Status;
  basisAmount: string | null;
  memo: boolean;
}

export interface InputTotal {
  amount: string;
  status: Status;
}

export interface SummaryOptions {
  /** Number of counted orders in the period (for average order value). */
  orderCount: number;
  /** Platform-reported ad spend, when an ad account is connected (otherwise omit). */
  adSpend?: InputTotal | null;
  /** Operating expenses entered for the period. */
  operatingExpenses?: InputTotal | null;
  /** True when at least one advertising account exists, even if it has no spend in the period. */
  adsConfigured?: boolean;
}

export interface FigureStatuses {
  cogs: FigureStatus;
  paymentFees: FigureStatus;
  shippingCost: FigureStatus;
  advertising: FigureStatus;
  operatingExpenses: FigureStatus;
  /** not_configured without operating expenses; estimated while anything above is not confirmed */
  estimatedOperatingProfit: FigureStatus;
}

/**
 * How far a figure can be trusted. A missing or unconfigured figure is never a zero:
 * - confirmed: a real amount, including a confirmed zero
 * - estimated: an amount worked out from a rule or an estimate
 * - missing: data that should exist is absent (the shown amount is only the part that is known)
 * - not_configured: the merchant has not set the source up (advertising, operating expenses)
 * - not_applicable: nothing of this kind exists for the period (for example nothing to ship)
 */
export type FigureStatus =
  'confirmed' | 'estimated' | 'missing' | 'not_configured' | 'not_applicable';

export type Band = 'high' | 'medium' | 'low';

export interface Shares {
  actual: string;
  estimated: string;
  missing: string;
}

export interface ComponentCoverage {
  /** Share of the weighting basis (revenue for cost, orders for fees and shipping). */
  shares: Shares;
  /** actual + 0.5 x estimated; 0 to 1 */
  quality: string;
}

export interface Confidence {
  /** null when nothing in the period needs cost data */
  band: Band | null;
  /** 0 to 1, shown only as a band in the UI */
  score: string | null;
  components: { cost?: ComponentCoverage; fees?: ComponentCoverage; shipping?: ComponentCoverage };
  weights: { cost: string; fees: string; shipping: string };
}

export interface Summary {
  grossSales: string;
  discounts: string;
  productRefunds: string;
  netSales: string;
  shippingRevenue: string;
  revenue: string;
  /** product cost net of stock returned */
  cogs: string;
  paymentFees: string;
  shippingCost: string;
  adSpend: string | null;
  /**
   * revenue - product cost - payment fees - shipping cost. Advertising and operating expenses are
   * NOT taken off: they are operating costs and come after contribution profit.
   */
  contributionProfit: string;
  /**
   * The variable costs of selling: product cost, payment fees and shipping cost. Equal to
   * revenue - contributionProfit, to the cent. Advertising and operating expenses are separate.
   */
  totalCosts: string;
  /** operating expenses entered by the merchant (rent, salaries, software...); advertising is apart */
  operatingExpenses: string | null;
  /**
   * contribution profit - advertising (when data exists) - operating expenses. Not available until
   * operating expenses are set up. An estimate unless every input is confirmed; never "net profit".
   */
  estimatedOperatingProfit: string | null;
  /** "full": operating expenses entered; "contribution_only": they were not */
  operatingProfitBasis: 'full' | 'contribution_only';
  contributionMargin: string | null;
  /** estimated operating profit / revenue; null when operating profit is not available */
  operatingMargin: string | null;
  averageOrderValue: string | null;
  refundRate: string | null;
  taxCollected: string;
  taxRefunded: string;
  /** True when a cost, fee or shipping cost is missing: profit is partial, not a confirmed figure. */
  partial: boolean;
  statuses: FigureStatuses;
  /** Share of each cost that is missing (0 to 1, 4 places); null when the cost does not apply. */
  missingShares: { cogs: string | null; paymentFees: string | null; shippingCost: string | null };
  /** Plain-language reasons the profit shown is incomplete or excludes something. */
  qualifiers: string[];
  missingCostShare: string | null;
  confidence: Confidence;
}

/** Sum of signed ledger amounts per component (the form SQL aggregation produces). */
export type ComponentTotals = Partial<Record<Component, string>>;

type Quality = 'actual' | 'estimated' | 'missing';

/**
 * What the confidence needs, independent of how it was collected:
 * product cost weighted by sales value, fees and shipping counted per order (weakest part wins).
 * A component is null when it does not apply to the period.
 */
export interface CoverageInput {
  cost: Record<Quality, string> | null;
  fees: Record<Quality, number> | null;
  shipping: Record<Quality, number> | null;
}

const WEIGHTS = { cost: new D('0.6'), fees: new D('0.2'), shipping: new D('0.2') };
const TRUST: Record<Quality, number> = { missing: 0, estimated: 1, actual: 2 };

function coverageFrom(sums: Record<Quality, Dec>): ComponentCoverage | null {
  const all = sums.actual.plus(sums.estimated).plus(sums.missing);
  if (all.isZero()) return null;
  const a = sums.actual.div(all);
  const e = sums.estimated.div(all);
  const m = sums.missing.div(all);
  return {
    shares: { actual: a.toFixed(4), estimated: e.toFixed(4), missing: m.toFixed(4) },
    quality: a.plus(e.mul('0.5')).toFixed(4),
  };
}

const asDecimals = (r: Record<Quality, string | number>): Record<Quality, Dec> => ({
  actual: dec(String(r.actual)),
  estimated: dec(String(r.estimated)),
  missing: dec(String(r.missing)),
});

/** Profit confidence (spec section 12): a data-completeness band, not a probability. */
export function confidenceFromCoverage(input: CoverageInput): Confidence {
  const cost = input.cost ? coverageFrom(asDecimals(input.cost)) : null;
  const fees = input.fees ? coverageFrom(asDecimals(input.fees)) : null;
  const shipping = input.shipping ? coverageFrom(asDecimals(input.shipping)) : null;

  let weighted = new D(0);
  let weightSum = new D(0);
  for (const [cov, w] of [
    [cost, WEIGHTS.cost],
    [fees, WEIGHTS.fees],
    [shipping, WEIGHTS.shipping],
  ] as const) {
    if (!cov) continue;
    weighted = weighted.plus(dec(cov.quality).mul(w));
    weightSum = weightSum.plus(w);
  }
  const score = weightSum.isZero() ? null : weighted.div(weightSum);
  const band: Band | null =
    score === null ? null : score.gte('0.9') ? 'high' : score.gte('0.6') ? 'medium' : 'low';
  return {
    band,
    score: score ? score.toFixed(4) : null,
    components: {
      ...(cost ? { cost } : {}),
      ...(fees ? { fees } : {}),
      ...(shipping ? { shipping } : {}),
    },
    weights: { cost: '0.6', fees: '0.2', shipping: '0.2' },
  };
}

interface Standing {
  status: FigureStatus;
  /** missing / total, 4 places; null when not applicable */
  missingShare: string | null;
  /** how many of the total are missing, for wording */
  missing: Dec;
  total: Dec;
}

const NOT_APPLICABLE: Standing = {
  status: 'not_applicable',
  missingShare: null,
  missing: new D(0),
  total: new D(0),
};

function standing(r: Record<Quality, string | number> | null): Standing {
  if (!r) return NOT_APPLICABLE;
  const a = dec(String(r.actual));
  const e = dec(String(r.estimated));
  const m = dec(String(r.missing));
  const total = a.plus(e).plus(m);
  if (total.isZero()) return NOT_APPLICABLE;
  const status: FigureStatus = m.gt(0) ? 'missing' : e.gt(0) ? 'estimated' : 'confirmed';
  return { status, missingShare: m.div(total).toFixed(4), missing: m, total };
}

const pct = (share: string) => `${dec(share).mul(100).toDecimalPlaces(0).toFixed(0)}%`;

function qualifiersFor(
  cost: Standing,
  fees: Standing,
  ship: Standing,
  ads: FigureStatus,
  expenses: FigureStatus,
): string[] {
  const out: string[] = [];
  if (cost.status === 'missing')
    out.push(`Product cost is missing for ${pct(cost.missingShare!)} of sales value.`);
  if (fees.status === 'missing')
    out.push(
      `Payment fees are missing for ${fees.missing.toFixed(0)} of ${fees.total.toFixed(0)} orders.`,
    );
  if (ship.status === 'missing')
    out.push(
      `Shipping cost is missing for ${ship.missing.toFixed(0)} of ${ship.total.toFixed(0)} orders.`,
    );
  if ([cost, fees, ship].some((x) => x.status === 'estimated'))
    out.push('Some product costs, payment fees or shipping costs are estimates.');
  if (ads === 'not_configured')
    out.push('Advertising is not set up, so operating profit excludes advertising.');
  if (ads === 'missing')
    out.push(
      'No advertising spend was imported for this period, so operating profit excludes advertising.',
    );
  if (expenses === 'not_configured')
    out.push('No operating expenses are set up, so estimated operating profit is not available.');
  return out;
}

/** Per order, the weakest status among its entries decides (one missing fee makes the order missing). */
function perOrderCounts(
  entries: SummaryEntry[],
  component: Component,
): Record<Quality, number> | null {
  const byOrder = new Map<string | number, Quality>();
  for (const e of entries) {
    if (e.component !== component || e.status === 'not_applicable') continue;
    const prev = byOrder.get(e.orderKey);
    if (!prev || TRUST[e.status] < TRUST[prev]) byOrder.set(e.orderKey, e.status);
  }
  if (byOrder.size === 0) return null;
  const counts: Record<Quality, number> = { actual: 0, estimated: 0, missing: 0 };
  for (const s of byOrder.values()) counts[s]++;
  return counts;
}

/** Collects the confidence inputs from individual ledger entries. */
export function coverageFromEntries(entries: SummaryEntry[]): CoverageInput {
  const cost: Record<Quality, Dec> = { actual: new D(0), estimated: new D(0), missing: new D(0) };
  let anyCost = false;
  for (const e of entries) {
    if (e.component !== 'cogs' || e.status === 'not_applicable' || e.basisAmount === null) continue;
    cost[e.status] = cost[e.status].plus(dec(e.basisAmount));
    anyCost = true;
  }
  return {
    cost: anyCost
      ? {
          actual: cost.actual.toFixed(4),
          estimated: cost.estimated.toFixed(4),
          missing: cost.missing.toFixed(4),
        }
      : null,
    fees: perOrderCounts(entries, 'payment_fees'),
    shipping: perOrderCounts(entries, 'shipping_cost'),
  };
}

/** Confidence from individual entries (see confidenceFromCoverage). */
export function confidence(entries: SummaryEntry[]): Confidence {
  return confidenceFromCoverage(coverageFromEntries(entries));
}

export function totalsFromEntries(entries: SummaryEntry[]): ComponentTotals {
  const totals: Partial<Record<Component, Dec>> = {};
  for (const e of entries)
    totals[e.component] = (totals[e.component] ?? new D(0)).plus(dec(e.amount));
  return Object.fromEntries(
    Object.entries(totals).map(([k, v]) => [k, toStored(v as Dec)]),
  ) as ComponentTotals;
}

export interface TotalsSummaryOptions extends SummaryOptions {
  coverage: CoverageInput;
  /** True when any cost, fee or shipping cost is missing in the period. */
  anyMissing: boolean;
}

/**
 * Totals for a period from per-component sums. This is the single place the headline formulas
 * live: `summarize` (entries) and the SQL-aggregated dashboard both end up here.
 * Costs are returned as positive numbers; contribution and operating profit are signed.
 */
export function summarizeFromTotals(totals: ComponentTotals, opts: TotalsSummaryOptions): Summary {
  const t = (c: Component): Dec => dec(totals[c] ?? '0');
  const grossSales = t('gross_sales');
  const discounts = t('discounts').neg();
  const productRefunds = t('product_refund').neg();
  const netSales = grossSales.minus(discounts).minus(productRefunds);
  const shippingRevenue = t('shipping_revenue').plus(t('shipping_refund'));
  const revenue = netSales.plus(shippingRevenue);
  const cogs = t('cogs').plus(t('cogs_reversal')).neg();
  const paymentFees = t('payment_fees').neg();
  const shippingCost = t('shipping_cost').neg();
  const adSpend = opts.adSpend ? dec(opts.adSpend.amount) : null;
  const contribution = revenue.minus(cogs).minus(paymentFees).minus(shippingCost);

  const expenses = opts.operatingExpenses ? dec(opts.operatingExpenses.amount) : null;
  // advertising is an operating cost: it comes off contribution profit together with the expenses
  const operatingProfit = expenses ? contribution.minus(adSpend ?? new D(0)).minus(expenses) : null;
  const conf = confidenceFromCoverage(opts.coverage);
  const q = (d: Dec | null) => (d ? toStored(d) : null);

  const cost = standing(opts.coverage.cost);
  const fees = standing(opts.coverage.fees);
  const ship = standing(opts.coverage.shipping);
  const adsStatus: FigureStatus = adSpend
    ? 'confirmed'
    : opts.adsConfigured
      ? 'missing'
      : 'not_configured';
  const expensesStatus: FigureStatus = expenses ? 'confirmed' : 'not_configured';
  const operatingStatus: FigureStatus = !expenses
    ? 'not_configured'
    : [cost, fees, ship].some((x) => x.status === 'missing' || x.status === 'estimated') ||
        adsStatus !== 'confirmed'
      ? 'estimated'
      : 'confirmed';

  return {
    grossSales: toStored(grossSales),
    discounts: toStored(discounts),
    productRefunds: toStored(productRefunds),
    netSales: toStored(netSales),
    shippingRevenue: toStored(shippingRevenue),
    revenue: toStored(revenue),
    cogs: toStored(cogs),
    paymentFees: toStored(paymentFees),
    shippingCost: toStored(shippingCost),
    adSpend: q(adSpend),
    contributionProfit: toStored(contribution),
    totalCosts: toStored(revenue.minus(contribution)),
    operatingExpenses: q(expenses),
    estimatedOperatingProfit: operatingProfit ? toStored(operatingProfit) : null,
    operatingProfitBasis: expenses ? 'full' : 'contribution_only',
    contributionMargin: q(ratio(contribution, revenue)?.toDecimalPlaces(4) ?? null),
    operatingMargin: q(
      operatingProfit ? (ratio(operatingProfit, revenue)?.toDecimalPlaces(4) ?? null) : null,
    ),
    averageOrderValue:
      opts.orderCount > 0 ? toStored(revenue.div(opts.orderCount).toDecimalPlaces(4)) : null,
    refundRate: q(ratio(productRefunds, grossSales)?.toDecimalPlaces(4) ?? null),
    taxCollected: toStored(t('tax_collected')),
    taxRefunded: toStored(t('tax_refunded').neg()),
    partial: opts.anyMissing,
    statuses: {
      cogs: cost.status,
      paymentFees: fees.status,
      shippingCost: ship.status,
      advertising: adsStatus,
      operatingExpenses: expensesStatus,
      estimatedOperatingProfit: operatingStatus,
    },
    missingShares: {
      cogs: cost.missingShare,
      paymentFees: fees.missingShare,
      shippingCost: ship.missingShare,
    },
    qualifiers: qualifiersFor(cost, fees, ship, adsStatus, expensesStatus),
    missingCostShare: conf.components.cost?.shares.missing ?? null,
    confidence: conf,
  };
}

/** Totals for a set of ledger entries (typically one period). */
export function summarize(entries: SummaryEntry[], opts: SummaryOptions): Summary {
  const anyMissing = entries.some(
    (e) =>
      ['cogs', 'payment_fees', 'shipping_cost'].includes(e.component) && e.status === 'missing',
  );
  return summarizeFromTotals(totalsFromEntries(entries), {
    ...opts,
    coverage: coverageFromEntries(entries),
    anyMissing,
  });
}
