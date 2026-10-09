import type { LeakageResponse, OverviewResponse, ProductListResponse } from '@pi/contracts';
import { formatMoney, formatPercent, shortDate } from './format';

export interface Opportunity {
  id: string;
  tone: 'critical' | 'warning' | 'info';
  title: string;
  /** the measured fact */
  detail: string;
  /** why it matters */
  why: string;
  action: { label: string; href: string };
}

/** Fewer orders than this in either period and a change in profit is noise, not a signal. */
const MIN_ORDERS = 10;
/** A change in contribution profit smaller than this is not called unusual. */
const UNUSUAL_CHANGE = 0.25;
/** If this much of sales has no product cost, a profit comparison is not meaningful. */
const MAX_MISSING_COST_SHARE = 0.3;
export const MAX_OPPORTUNITIES = 3;

export interface OpportunityInput {
  overview: OverviewResponse;
  /** the profit-leakage findings, when the plan includes them and they loaded */
  leakage: LeakageResponse | null;
  /** the best-selling products with no cost, when they loaded */
  missingCostProducts: ProductListResponse | null;
}

function unusualChange(o: OverviewResponse): Opportunity | null {
  const { summary: s, previous: p, deltas: d, currency } = o;
  const change = d.contributionProfit;
  if (change === null || !Number.isFinite(change)) return null;
  if (s.orders < MIN_ORDERS || p.orders < MIN_ORDERS) return null;
  if (Math.abs(change) < UNUSUAL_CHANGE) return null;
  // Not a meaningful comparison when too much of either period's product cost is unknown.
  const missing = (x: typeof s) => Number(x.missingShares.cogs ?? 0);
  if (missing(s) >= MAX_MISSING_COST_SHARE || missing(p) >= MAX_MISSING_COST_SHARE) return null;

  const beforeAds = d.basis === 'before_advertising';
  const now = beforeAds ? s.contributionBeforeAds : s.contributionProfit;
  const was = beforeAds ? p.contributionBeforeAds : p.contributionProfit;
  const fell = change < 0;
  const range = `${shortDate(o.previousPeriod.from)} – ${shortDate(o.previousPeriod.to)}`;
  return {
    id: 'profit_change',
    tone: fell ? 'warning' : 'info',
    title: `Contribution profit ${fell ? 'fell' : 'rose'} ${formatPercent(Math.abs(change))}${beforeAds ? ' (before advertising)' : ''}`,
    detail: `${formatMoney(was, currency.code)} in ${range}, ${formatMoney(now, currency.code)} now.`,
    why: 'A change this size is worth a look. Check discounts, refunds, product mix and costs for these dates.',
    action: { label: 'See the monthly trend', href: '/profit?tab=trend' },
  };
}

/**
 * Up to three things worth acting on, most important first, each with the measured fact, why it
 * matters and where to look. Nothing is claimed beyond the data: an order with a missing cost is
 * "may be losing money", never "is losing money", and a change in profit is only called unusual
 * with enough orders and cost data in both periods.
 */
export function buildOpportunities(i: OpportunityInput): Opportunity[] {
  const { overview: o, leakage, missingCostProducts } = i;
  if (o.summary.orders === 0) return [];
  const alert = (id: string) => o.alerts.find((a) => a.id === id);
  const finding = (id: string) => leakage?.findings.find((f) => f.id === id);
  const out: Opportunity[] = [];

  const loss = alert('loss_orders');
  if (loss) {
    out.push({
      id: 'loss_orders',
      tone: 'critical',
      title: loss.title,
      detail: loss.evidence,
      why: loss.why,
      action: { label: 'Review these orders', href: '/orders?filter=loss' },
    });
  }

  const unusual = unusualChange(o);
  if (unusual && unusual.tone === 'warning') out.push(unusual);

  const negative = finding('negative_margin_products');
  if (negative) {
    out.push({
      id: 'negative_margin_products',
      tone: negative.severity,
      title: negative.title,
      detail: negative.evidence,
      why: negative.why,
      action: { label: 'Review these products', href: '/products?filter=loss' },
    });
  }

  const refunds = finding('refund_rate');
  if (refunds) {
    out.push({
      id: 'refund_rate',
      tone: refunds.severity,
      title: refunds.title,
      detail: refunds.evidence,
      why: refunds.why,
      action: { label: 'See the most refunded products', href: '/products' },
    });
  }

  const possible = alert('possible_loss');
  if (possible) {
    out.push({
      id: 'possible_loss',
      tone: 'info',
      title: possible.title,
      detail: possible.evidence,
      why: possible.why,
      action: { label: 'Review these orders', href: '/orders?filter=loss' },
    });
  }

  if (missingCostProducts && missingCostProducts.paging.total > 0) {
    const n = missingCostProducts.paging.total;
    const names = missingCostProducts.rows.map((r) => r.title).join(', ');
    out.push({
      id: 'missing_cost_products',
      tone: 'info',
      title: `${n} product${n === 1 ? '' : 's'} sold in this period ${n === 1 ? 'has' : 'have'} no cost`,
      detail: `Largest by sales: ${names}.`,
      why: 'Their sales are counted without a cost, so profit on them looks higher than it is.',
      action: { label: 'Add these costs', href: '/products?filter=missing_cost' },
    });
  }

  const flagged = alert('flagged_orders');
  if (flagged) {
    out.push({
      id: 'flagged_orders',
      tone: 'warning',
      title: flagged.title,
      detail: flagged.evidence,
      why: flagged.why,
      action: { label: 'Review these orders', href: '/orders' },
    });
  }

  const low = finding('low_margin_products');
  if (low) {
    out.push({
      id: 'low_margin_products',
      tone: low.severity,
      title: low.title,
      detail: low.evidence,
      why: low.why,
      action: { label: 'Review these products', href: '/products' },
    });
  }

  if (unusual && unusual.tone === 'info') out.push(unusual);

  return out.slice(0, MAX_OPPORTUNITIES);
}
