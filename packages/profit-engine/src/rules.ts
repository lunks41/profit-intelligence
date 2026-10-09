import { dec, roundToCurrency } from './money.js';
import type { Dec } from './money.js';
import type { CostPoint, EngineConfig, FeeRule, ShippingRule } from './types.js';

// ---- product cost (COGS) --------------------------------------------------------------------

export interface ResolvedCost {
  unitCost: string;
  status: 'actual' | 'estimated';
  source: string;
}

/**
 * Cost per unit for a line, in order of trust (decision D3):
 *  0. a cost already used for this line in an earlier calculation (history is never rewritten),
 *  1. the latest merchant-entered cost whose effective date is on or before the order date (Actual),
 *  2. Shopify's current unit cost (Estimated: it is today's cost applied to a past order),
 *  3. nothing: the caller records "missing".
 */
export function resolveUnitCost(
  cfg: EngineConfig,
  line: { shopifyId: number; variantShopifyId: number | null },
  businessDate: string,
): ResolvedCost | null {
  const frozen = cfg.frozenCosts?.get(line.shopifyId);
  if (frozen) return { ...frozen };

  const variant = line.variantShopifyId;
  if (variant === null) return null; // custom line: no variant, no cost

  const points = cfg.merchantCosts.get(variant);
  if (points?.length) {
    const applicable = latestOnOrBefore(points, businessDate);
    if (applicable) {
      return {
        unitCost: applicable.amount,
        status: 'actual',
        source: `${applicable.source === 'import' ? 'imported' : 'merchant'} cost effective ${applicable.effectiveFrom}`,
      };
    }
  }
  const shopify = cfg.shopifyCosts.get(variant);
  if (shopify !== undefined) {
    return { unitCost: shopify, status: 'estimated', source: 'shopify unit cost (current)' };
  }
  return null;
}

function latestOnOrBefore(points: readonly CostPoint[], date: string): CostPoint | null {
  let best: CostPoint | null = null;
  for (const p of points) {
    if (p.effectiveFrom <= date && (!best || p.effectiveFrom > best.effectiveFrom)) best = p;
  }
  return best;
}

// ---- payment fees ---------------------------------------------------------------------------

/**
 * The fee rule that applies to a payment: only rules in force on the date, a rule for the exact
 * gateway beats a catch-all rule, and the most recently effective rule wins.
 */
export function pickFeeRule(
  rules: readonly FeeRule[],
  gateway: string | null,
  currency: string,
  businessDate: string,
): FeeRule | null {
  let best: FeeRule | null = null;
  for (const r of rules) {
    if (r.effectiveFrom > businessDate || r.currency !== currency) continue;
    if (r.gateway !== null && r.gateway !== gateway) continue;
    if (
      !best ||
      (r.gateway !== null && best.gateway === null) ||
      ((r.gateway === null) === (best.gateway === null) && r.effectiveFrom > best.effectiveFrom)
    ) {
      best = r;
    }
  }
  return best;
}

/** fee = amount x percent / 100 + fixed, rounded once to the currency minor unit. */
export function estimateFee(rule: FeeRule, amount: string, currency: string): Dec {
  return roundToCurrency(dec(amount).mul(rule.percent).div(100).plus(rule.fixedAmount), currency);
}

// ---- carrier shipping cost ------------------------------------------------------------------

export function pickShippingRule(
  rules: readonly ShippingRule[],
  businessDate: string,
): ShippingRule | null {
  let best: ShippingRule | null = null;
  for (const r of rules) {
    if (r.effectiveFrom <= businessDate && (!best || r.effectiveFrom > best.effectiveFrom))
      best = r;
  }
  return best;
}

/** Cost of shipping an order under a rule. `percent` applies to the shipping charged to the customer. */
export function estimateShippingCost(
  rule: ShippingRule,
  shippingCharged: string,
  currency: string,
): Dec {
  if (rule.mode === 'flat') return roundToCurrency(rule.amount ?? '0', currency);
  return roundToCurrency(
    dec(shippingCharged)
      .mul(rule.percent ?? '0')
      .div(100),
    currency,
  );
}
