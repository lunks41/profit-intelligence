import type { Alert, ProfitSummary } from '@pi/contracts';
import type { OrderAttention } from '@pi/db';

export interface AlertInput {
  summary: ProfitSummary;
  attention: OrderAttention;
  /** warn when more than this percent of sales has no product cost (merchant setting) */
  missingCostThresholdPct: string;
  currency: string;
  sync: { state: string; stale: boolean; error: string | null; lastSuccessAt: string | null };
}

const SEVERITY_ORDER: Record<Alert['severity'], number> = { critical: 0, warning: 1, info: 2 };

const money = (amount: string, currency: string) =>
  `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (share: string) => `${(Number(share) * 100).toFixed(1)}%`;

/**
 * Plain, deterministic alerts for the overview. Each one states the measured fact, why it matters
 * and what to do. A loss is only called confirmed when every cost of the order is known; otherwise
 * it is reported as "profit unknown". The full leakage rules come in a later phase.
 */
export function buildAlerts(i: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const { summary: s, attention: a, currency: cur } = i;

  if (i.sync.state === 'failed') {
    alerts.push({
      id: 'sync_failed',
      severity: 'critical',
      title: 'The last import from Shopify failed',
      evidence: i.sync.error ?? 'No details were recorded.',
      why: 'New orders and changes may be missing, so the figures below can be out of date.',
      action: { label: 'Review import status', href: '/#sync' },
    });
  } else if (i.sync.state === 'partial') {
    alerts.push({
      id: 'sync_partial',
      severity: 'warning',
      title: 'The last import finished only partly',
      evidence: i.sync.error ?? 'Some refund lines were not imported.',
      why: 'An order with more than 25 refund line items keeps the refund total, but the per-item refund is incomplete.',
      action: { label: 'See the incomplete orders', href: '/orders?filter=incomplete_refunds' },
    });
  } else if (i.sync.stale) {
    alerts.push({
      id: 'data_stale',
      severity: 'warning',
      title: 'Your data may be out of date',
      evidence: i.sync.lastSuccessAt
        ? `Last successful import: ${i.sync.lastSuccessAt.slice(0, 16).replace('T', ' ')} UTC.`
        : 'No successful import yet.',
      why: 'Recent orders, refunds or cost changes may not be reflected.',
      action: { label: 'Re-sync now', href: '/#sync' },
    });
  }

  if (a.confirmedLoss.count > 0) {
    alerts.push({
      id: 'loss_orders',
      severity: 'critical',
      title: `${a.confirmedLoss.count} order${a.confirmedLoss.count === 1 ? '' : 's'} lost money`,
      evidence: `${money(a.confirmedLoss.amount, cur)} in total, with every cost known for these orders.`,
      why: 'These sales cost more than they earned, usually from heavy discounts or low margins.',
      action: { label: 'Review orders', href: '/orders' },
    });
  }

  const missingShare = s.missingCostShare === null ? 0 : Number(s.missingCostShare);
  if (missingShare * 100 > Number(i.missingCostThresholdPct)) {
    alerts.push({
      id: 'missing_costs',
      severity: missingShare >= 0.3 ? 'critical' : 'warning',
      title: `${pct(s.missingCostShare!)} of your sales have no product cost`,
      evidence: `Your limit is ${Number(i.missingCostThresholdPct)}%. Profit counts these items at zero cost.`,
      why: 'Without a cost, profit is overstated and cannot be called a confirmed figure.',
      action: { label: 'Add product costs', href: '/products' },
    });
  }

  const fees = s.confidence.components.fees;
  if (fees && Number(fees.shares.estimated) > 0 && Number(fees.shares.missing) === 0) {
    alerts.push({
      id: 'estimated_fees',
      severity: 'info',
      title: 'Some payment fees are still estimates',
      evidence: `${pct(fees.shares.estimated)} of orders use your gateway fee rule rather than a fee Shopify reported.`,
      why: 'An estimate is labeled as one. Shopify Payments fees replace it when the store reports them.',
      action: { label: 'See orders using an estimate', href: '/orders?filter=estimated_fees' },
    });
  }
  if (fees && Number(fees.shares.missing) > 0) {
    alerts.push({
      id: 'missing_fees',
      severity: 'warning',
      title: 'Payment fees are not set',
      evidence: `${pct(fees.shares.missing)} of orders have no fee data or fee rule.`,
      why: 'Payment fees are a real cost on every order; leaving them out overstates profit.',
      action: { label: 'Set a payment fee rule', href: '/settings' },
    });
  }
  const shipping = s.confidence.components.shipping;
  if (shipping && Number(shipping.shares.missing) > 0) {
    alerts.push({
      id: 'missing_shipping_cost',
      severity: 'warning',
      title: 'Shipping costs are not set',
      evidence: `${pct(shipping.shares.missing)} of shipped orders have no shipping cost rule.`,
      why: 'Shopify does not report what you pay carriers; without a rule that cost is left out.',
      action: { label: 'Set a shipping cost rule', href: '/settings' },
    });
  }

  if (a.possibleLoss > 0) {
    alerts.push({
      id: 'possible_loss',
      severity: 'info',
      title: `${a.possibleLoss} order${a.possibleLoss === 1 ? '' : 's'} may be losing money`,
      evidence: 'Their profit is negative, but a cost is missing, so this is not confirmed.',
      why: 'Add the missing costs to find out whether these orders really lose money.',
      action: { label: 'Review orders', href: '/orders' },
    });
  }
  if (a.flagged > 0) {
    alerts.push({
      id: 'flagged_orders',
      severity: 'warning',
      title: `${a.flagged} order${a.flagged === 1 ? '' : 's'} need${a.flagged === 1 ? 's' : ''} review`,
      evidence: 'For example an order that was cancelled after payment but never refunded.',
      why: 'Their revenue is still counted; check whether it should be.',
      action: { label: 'Review orders', href: '/orders' },
    });
  }
  if (a.awaitingPayment.count > 0) {
    alerts.push({
      id: 'awaiting_payment',
      severity: 'info',
      title: `${a.awaitingPayment.count} order${a.awaitingPayment.count === 1 ? ' is' : 's are'} awaiting payment`,
      evidence: `${money(a.awaitingPayment.amount, cur)} is not counted in revenue or profit yet.`,
      why: 'Orders count only once money is collected; these will appear when they are paid.',
      action: null,
    });
  }

  return alerts.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
}
