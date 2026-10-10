import { businessDate } from './dates.js';
import { pickFeeRule, pickShippingRule } from './rules.js';
import type { EngineConfig, EngineOrder, FeeRule, ShippingRule } from './types.js';
import { exclusionReason, shipmentOf } from './order.js';

const PAYMENT_KINDS = new Set(['SALE', 'CAPTURE']);

export interface GatewayCoverage {
  gateway: string | null;
  payments: number;
  /** payments where Shopify reported the fee, so no rule is needed */
  reported: number;
  /** payments that need a rule and one applies */
  covered: number;
  /** payments that need a rule and none applies: the fee is unknown */
  uncovered: number;
}

export interface RuleCoverage {
  /** counted orders looked at */
  orders: number;
  fees: {
    payments: number;
    reported: number;
    covered: number;
    uncovered: number;
    byGateway: GatewayCoverage[];
    /** payments the candidate rule would price (it is the rule chosen for them); null without a candidate */
    candidateApplies: number | null;
  };
  shipping: {
    /** counted orders with something to ship */
    orders: number;
    covered: number;
    uncovered: number;
    /** orders with no destination country (a country rule cannot match them) */
    missingCountry: number;
    /** orders where a shipped item has no recorded weight (a weight rule cannot match them) */
    missingWeight: number;
    candidateApplies: number | null;
  };
}

export interface CoverageCandidate {
  fee?: FeeRule;
  shipping?: ShippingRule;
}

/**
 * How well the fee and shipping rules cover a set of recent orders, without changing anything: for
 * every counted order's payments, whether Shopify reported the fee, a rule applies, or the fee is
 * unknown (per gateway); for orders that ship, whether a shipping rule applies and which data a rule
 * would need but the order lacks (destination country, item weight). With a candidate rule it also
 * says how many payments or orders that rule would be chosen for, so a rule that matches nothing is
 * visible before it is saved. Uses the same rule selection as the profit calculation.
 */
export function ruleCoverage(
  orders: readonly EngineOrder[],
  cfg: Pick<EngineConfig, 'timezone' | 'feeRules' | 'shippingRules' | 'variantWeights'>,
  candidate: CoverageCandidate = {},
): RuleCoverage {
  const feeRules = candidate.fee ? [...cfg.feeRules, candidate.fee] : cfg.feeRules;
  const shipRules = candidate.shipping
    ? [...cfg.shippingRules, candidate.shipping]
    : cfg.shippingRules;
  const gateways = new Map<string, GatewayCoverage>();
  const out: RuleCoverage = {
    orders: 0,
    fees: {
      payments: 0,
      reported: 0,
      covered: 0,
      uncovered: 0,
      byGateway: [],
      candidateApplies: candidate.fee ? 0 : null,
    },
    shipping: {
      orders: 0,
      covered: 0,
      uncovered: 0,
      missingCountry: 0,
      missingWeight: 0,
      candidateApplies: candidate.shipping ? 0 : null,
    },
  };

  for (const order of orders) {
    if (exclusionReason(order)) continue;
    out.orders++;
    const date = businessDate(order.processedAt, cfg.timezone);

    for (const t of order.transactions) {
      if (!PAYMENT_KINDS.has(t.kind) || t.status !== 'SUCCESS') continue;
      const key = t.gateway ?? '';
      const g = gateways.get(key) ?? {
        gateway: t.gateway,
        payments: 0,
        reported: 0,
        covered: 0,
        uncovered: 0,
      };
      gateways.set(key, g);
      g.payments++;
      out.fees.payments++;
      if (t.feeAmount !== null) {
        g.reported++;
        out.fees.reported++;
        continue;
      }
      const rule = pickFeeRule(feeRules, t.gateway, order.currency, date);
      if (rule) {
        g.covered++;
        out.fees.covered++;
        if (candidate.fee && rule === candidate.fee) out.fees.candidateApplies!++;
      } else {
        g.uncovered++;
        out.fees.uncovered++;
      }
    }

    const nonGift = order.lines.filter((l) => !l.isGiftCard && l.quantity > 0);
    if (!nonGift.some((l) => l.requiresShipping)) continue;
    out.shipping.orders++;
    const shipment = shipmentOf(order, cfg as EngineConfig, nonGift);
    if (!shipment.country) out.shipping.missingCountry++;
    if (shipment.weightGrams === null) out.shipping.missingWeight++;
    const rule = pickShippingRule(shipRules, date, shipment);
    if (rule) {
      out.shipping.covered++;
      if (candidate.shipping && rule === candidate.shipping) out.shipping.candidateApplies!++;
    } else {
      out.shipping.uncovered++;
    }
  }
  out.fees.byGateway = [...gateways.values()].sort((a, b) => b.payments - a.payments);
  return out;
}
