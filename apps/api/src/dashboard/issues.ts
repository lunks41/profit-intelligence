import type { DataQuality, Issue, ProfitSummary } from '@pi/contracts';
import type { ProfitAggregate } from '@pi/db';

type Coverage = ProfitAggregate['coverage'];

/**
 * The completeness of the inputs behind the figures, with explicit denominators:
 * product cost as shares of sales value, payment fees and shipping cost as counts of orders.
 * Nothing here is a score; it is the same counts the figures' statuses are decided from.
 */
export function dataQualityOf(coverage: Coverage, summary: ProfitSummary): DataQuality {
  const orders = (c: Coverage['fees']) =>
    c ? { confirmed: c.actual, estimated: c.estimated, missing: c.missing } : null;
  const cost = summary.confidence.components.cost?.shares;
  return {
    cost: cost
      ? { confirmed: cost.actual, estimated: cost.estimated, missing: cost.missing }
      : null,
    fees: orders(coverage.fees),
    shipping: orders(coverage.shipping),
    advertising: summary.statuses.advertising,
    operatingExpenses: summary.statuses.operatingExpenses,
  };
}

const pct = (share: string) => `${(Number(share) * 100).toFixed(1)}%`;
const total = (c: { confirmed: number; estimated: number; missing: number }) =>
  c.confirmed + c.estimated + c.missing;
const orders = (n: number) => `${n} order${n === 1 ? '' : 's'}`;

export interface IssueInput {
  quality: DataQuality;
  /** warn (not just inform) when more than this percent of sales has no product cost */
  missingCostThresholdPct: string;
  sync: { state: string; stale: boolean; error: string | null; lastSuccessAt: string | null };
  /** orders in the period the merchant can still fix; omitted counts are treated as zero */
  gaps?: { missingCountry: number; missingWeight: number; incompleteRefunds: number };
}

const RANK: Record<Issue['severity'], number> = { critical: 0, warning: 1, info: 2 };

/**
 * Every unresolved data problem, once, most important first. Reliability problems (a failed or
 * stale import) come first because they affect every figure; then costs that change profit; then
 * inputs that are simply not set up. Each has an action that leads to the place that fixes it.
 */
export function buildIssues(i: IssueInput): Issue[] {
  const out: Issue[] = [];
  const q = i.quality;

  if (i.sync.state === 'failed') {
    out.push({
      id: 'sync_failed',
      severity: 'critical',
      title: 'The last import from Shopify failed',
      detail:
        (i.sync.error ?? 'No details were recorded.') +
        ' New orders and changes may be missing, so the figures can be out of date.',
      action: { label: 'Check sync status', href: '#sync' },
    });
  } else if (i.sync.state === 'partial') {
    out.push({
      id: 'sync_partial',
      severity: 'warning',
      title: 'The last import finished only partly',
      detail:
        (i.sync.error ?? 'Some records were not imported.') +
        ' More than 25 refund line items on one order are not fully imported, so those refunds can be understated.',
      action: { label: 'See the incomplete orders', href: '/orders?filter=incomplete_refunds' },
    });
  } else if (i.sync.stale && i.sync.state !== 'never') {
    out.push({
      id: 'data_stale',
      severity: 'warning',
      title: 'Your data may be out of date',
      detail: i.sync.lastSuccessAt
        ? `Last successful import: ${i.sync.lastSuccessAt.slice(0, 16).replace('T', ' ')} UTC. Recent orders, refunds or cost changes may not be included.`
        : 'There has been no successful import yet.',
      action: { label: 'Check sync status', href: '#sync' },
    });
  }

  if (q.cost && Number(q.cost.missing) > 0) {
    const share = Number(q.cost.missing) * 100;
    out.push({
      id: 'missing_costs',
      severity:
        share >= 30 ? 'critical' : share > Number(i.missingCostThresholdPct) ? 'warning' : 'info',
      title: `Product cost is missing for ${pct(q.cost.missing)} of sales value`,
      detail:
        'Profit leaves these costs out, so it is higher than it would be with them and cannot be called confirmed.',
      action: { label: 'Add product costs', href: '/products?tab=costs&filter=missing' },
    });
  } else if (q.cost && Number(q.cost.estimated) > 0) {
    out.push({
      id: 'estimated_costs',
      severity: 'info',
      title: `${pct(q.cost.estimated)} of sales value uses Shopify's cost estimate`,
      detail:
        "Shopify's current cost is applied to past orders. Enter your own costs to make these figures confirmed.",
      action: { label: 'Review costs', href: '/products?tab=costs&filter=estimated' },
    });
  }

  if (q.shipping && q.shipping.missing > 0) {
    out.push({
      id: 'missing_shipping_cost',
      severity: 'warning',
      title: `Shipping cost is missing on ${q.shipping.missing} of ${orders(total(q.shipping))}`,
      detail:
        'Shopify does not report what you pay carriers. Without a rule that cost is left out of profit.',
      action: { label: 'Set a shipping cost rule', href: '/settings?tab=shipping' },
    });
  }
  if (q.fees && q.fees.missing > 0) {
    out.push({
      id: 'missing_fees',
      severity: 'warning',
      title: `Payment fees are missing on ${q.fees.missing} of ${orders(total(q.fees))}`,
      detail: 'Payment fees are a real cost on every order; leaving them out overstates profit.',
      action: { label: 'Set a payment fee rule', href: '/settings?tab=fees' },
    });
  }
  if (q.fees && q.fees.estimated > 0) {
    out.push({
      id: 'estimated_fees',
      severity: 'info',
      title: `Payment fees are estimated on ${q.fees.estimated} of ${orders(total(q.fees))}`,
      detail:
        'These orders use your gateway fee rule. Shopify Payments fees replace the estimate when Shopify reports them.',
      action: { label: 'See orders using an estimate', href: '/orders?filter=estimated_fees' },
    });
  }

  const gaps = i.gaps ?? { missingCountry: 0, missingWeight: 0, incompleteRefunds: 0 };
  if (gaps.incompleteRefunds > 0 && i.sync.state !== 'partial') {
    out.push({
      id: 'incomplete_refunds',
      severity: 'warning',
      title: `${gaps.incompleteRefunds} ${gaps.incompleteRefunds === 1 ? 'order has' : 'orders have'} refund lines that were only partly imported`,
      detail:
        'Shopify returned more than 25 refund line items. The refund total is still counted; the per-item refund is not complete.',
      action: { label: 'See these orders', href: '/orders?filter=incomplete_refunds' },
    });
  }
  if (gaps.missingCountry > 0) {
    out.push({
      id: 'missing_ship_country',
      severity: 'info',
      title: `${gaps.missingCountry} ${gaps.missingCountry === 1 ? 'order has' : 'orders have'} no destination country`,
      detail:
        'A country shipping rule cannot match them. A catch-all rule still can. Re-sync if Shopify should have sent the country.',
      action: { label: 'See these orders', href: '/orders?filter=missing_country' },
    });
  }
  if (gaps.missingWeight > 0) {
    out.push({
      id: 'missing_weight',
      severity: 'info',
      title: `${gaps.missingWeight} ${gaps.missingWeight === 1 ? 'order is' : 'orders are'} missing a product weight`,
      detail:
        'A per-kilogram or weight-band shipping rule cannot match a line whose weight Shopify did not send.',
      action: { label: 'See these orders', href: '/orders?filter=missing_weight' },
    });
  }

  if (q.advertising === 'not_configured') {
    out.push({
      id: 'advertising_not_set_up',
      severity: 'info',
      title: 'Advertising is not set up',
      detail:
        'Operating profit excludes advertising until you add an account and enter or import spend.',
      action: { label: 'Set up advertising', href: '/marketing?tab=accounts' },
    });
  } else if (q.advertising === 'missing') {
    out.push({
      id: 'advertising_no_data',
      severity: 'info',
      title: 'No advertising spend for this period',
      detail:
        'An account exists but has no spend for these dates, so operating profit excludes advertising.',
      action: { label: 'Enter or import spend', href: '/marketing?tab=accounts' },
    });
  }
  if (q.operatingExpenses === 'not_configured') {
    out.push({
      id: 'expenses_not_set_up',
      severity: 'info',
      title: 'Operating expenses are not set up',
      detail:
        'Estimated operating profit is not available until you add rent, salaries or similar costs.',
      action: { label: 'Add expenses', href: '/expenses' },
    });
  }

  // stable: severity first, then the order above
  return out
    .map((x, n) => ({ x, n }))
    .sort((a, b) => RANK[a.x.severity] - RANK[b.x.severity] || a.n - b.n)
    .map((e) => e.x);
}
