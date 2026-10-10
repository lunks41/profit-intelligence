import { dec, roundToCurrency } from './money.js';
import type { Dec } from './money.js';
import type { CostPoint, EngineConfig, FeeRule, Shipment, ShippingRule } from './types.js';

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

const ANY_WIDTH = 1_000_000_000;

function countriesOf(rule: ShippingRule): string[] {
  return (rule.countries ?? []).map((c) => c.toUpperCase());
}

function weightBounded(rule: ShippingRule): boolean {
  return rule.weightMinGrams != null || rule.weightMaxGrams != null;
}

/** True when grams sits in [min, max). A missing bound is open on that side. */
function weightMatches(rule: ShippingRule, grams: number): boolean {
  if (grams < (rule.weightMinGrams ?? 0)) return false;
  return rule.weightMaxGrams == null || grams < rule.weightMaxGrams;
}

function matches(rule: ShippingRule, businessDate: string, shipment: Shipment): boolean {
  if (rule.effectiveFrom > businessDate) return false;
  const countries = countriesOf(rule);
  if (countries.length) {
    const country = shipment.country?.trim().toUpperCase() ?? '';
    if (!countries.includes(country)) return false;
  }
  const needsWeight = weightBounded(rule) || rule.mode === 'per_kilogram';
  if (!needsWeight) return true;
  if (shipment.weightGrams == null) return false;
  return !weightBounded(rule) || weightMatches(rule, shipment.weightGrams);
}

/** Higher wins: country, then a weight band, then a narrower band, then a later start date. */
function rank(rule: ShippingRule): [number, number, number, string] {
  const width = weightBounded(rule)
    ? (rule.weightMaxGrams ?? ANY_WIDTH) - (rule.weightMinGrams ?? 0)
    : ANY_WIDTH;
  return [
    countriesOf(rule).length ? 1 : 0,
    weightBounded(rule) || rule.mode === 'per_kilogram' ? 1 : 0,
    -width,
    rule.effectiveFrom,
  ];
}

function outranks(candidate: ShippingRule, current: ShippingRule): boolean {
  const a = rank(candidate);
  const b = rank(current);
  for (let i = 0; i < a.length; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

/**
 * The shipping rule for one order. A country rule beats a catch-all, a weight band beats a rule
 * with no weight, and a narrower band beats a wider one. A later start date breaks a tie.
 * Weight and per-kilogram rules are skipped when the shipment weight is unknown.
 */
export function pickShippingRule(
  rules: readonly ShippingRule[],
  businessDate: string,
  shipment: Shipment = { country: null, weightGrams: null },
): ShippingRule | null {
  let best: ShippingRule | null = null;
  for (const rule of rules) {
    if (!matches(rule, businessDate, shipment)) continue;
    if (!best || outranks(rule, best)) best = rule;
  }
  return best;
}

/** Cost of shipping an order under a rule. `percent` applies to the shipping charged to the customer. */
export function estimateShippingCost(
  rule: ShippingRule,
  shippingCharged: string,
  currency: string,
  weightGrams: number | null = null,
): Dec {
  if (rule.mode === 'per_kilogram') {
    return roundToCurrency(
      dec(rule.amount ?? '0')
        .mul(weightGrams ?? 0)
        .div(1000),
      currency,
    );
  }
  if (rule.mode === 'flat') return roundToCurrency(rule.amount ?? '0', currency);
  return roundToCurrency(
    dec(shippingCharged)
      .mul(rule.percent ?? '0')
      .div(100),
    currency,
  );
}
