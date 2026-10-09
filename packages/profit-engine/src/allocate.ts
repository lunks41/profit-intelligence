import { D, dec, minorUnitDigits, toStored } from './money.js';
import type { Dec } from './money.js';

/**
 * Splits an order's ledger over its products (approved rule, Phase 8):
 *
 * - Sales and discounts are split in proportion to each line's pre-discount value (quantity x unit price).
 * - A refund is split over the lines that were refunded, in proportion to the refunded amount of each.
 *   A refund without line detail falls back to the order-level split.
 * - Product cost is already recorded per line and is never split.
 * - Shipping revenue, shipping refunds, payment fees and shipping cost belong to the order, not to a
 *   product, and are reported as unallocated.
 *
 * Splitting is done in whole minor units with the largest-remainder method, so the parts always add
 * up to the order's figure exactly.
 */

export interface AllocLine {
  lineItemId: string;
  productId: string | null;
  quantity: number;
  unitPrice: string;
}

export interface AllocEntry {
  component: string;
  amount: string;
  status: string;
  lineItemId: string | null;
  refundId: string | null;
}

export interface AllocRefund {
  refundId: string;
  lines: Array<{ lineItemId: string; subtotal: string }>;
}

export interface AllocInput {
  currency: string;
  lines: AllocLine[];
  entries: AllocEntry[];
  refunds: AllocRefund[];
}

export type CostStatus = 'actual' | 'estimated' | 'missing' | 'none';

export interface LineAllocation {
  lineItemId: string;
  productId: string | null;
  quantity: number;
  grossSales: string;
  discounts: string;
  productRefunds: string;
  cogs: string;
  /** gross + discounts + refunds + cost */
  profit: string;
  costStatus: CostStatus;
}

export interface OrderAllocation {
  lines: LineAllocation[];
  unallocated: {
    shippingRevenue: string;
    shippingRefund: string;
    paymentFees: string;
    shippingCost: string;
    /** product cost that could not be tied to a line (should be zero) */
    unlinkedCost: string;
  };
}

/** Splits `total` over `weights` in minor units; the parts sum to `total` exactly. */
export function splitByWeights(total: Dec, weights: Dec[], currency: string): Dec[] {
  if (weights.length === 0) return [];
  const digits = minorUnitDigits(currency);
  const scale = new D(10).pow(digits);
  const units = total.mul(scale).toDecimalPlaces(0, D.ROUND_HALF_UP);
  const sign = units.isNegative() ? -1 : 1;
  const abs = units.abs();
  const sumW = weights.reduce<Dec>((a, w) => a.plus(w), new D(0));
  const w = sumW.isZero() ? weights.map(() => new D(1)) : weights;
  const denom = sumW.isZero() ? new D(weights.length) : sumW;

  const exact = w.map((x) => abs.mul(x).div(denom));
  const floors = exact.map((e) => e.floor());
  let left = abs.minus(floors.reduce<Dec>((a, f) => a.plus(f), new D(0))).toNumber();
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(floors[i] as Dec) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const parts = floors.slice();
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] as Dec).plus(1);
    left--;
  }
  return parts.map((p) => p.mul(sign).div(scale));
}

const WEAKEST: Record<string, number> = { actual: 0, estimated: 1, missing: 2 };

export function allocateOrder(input: AllocInput): OrderAllocation {
  const { currency, lines, entries, refunds } = input;
  const sumOf = (component: string) =>
    entries
      .filter((e) => e.component === component)
      .reduce<Dec>((a, e) => a.plus(dec(e.amount)), new D(0));

  const lineWeights = lines.map((l) => dec(l.unitPrice).mul(l.quantity));
  const gross = lines.length ? splitByWeights(sumOf('gross_sales'), lineWeights, currency) : [];
  const discounts = lines.length ? splitByWeights(sumOf('discounts'), lineWeights, currency) : [];

  const refundParts = lines.map(() => new D(0));
  const indexOf = new Map(lines.map((l, i) => [l.lineItemId, i]));
  for (const e of entries.filter((x) => x.component === 'product_refund')) {
    if (!lines.length) break;
    const detail = refunds.find((r) => r.refundId === e.refundId)?.lines ?? [];
    const known = detail.filter((d) => indexOf.has(d.lineItemId) && dec(d.subtotal).gt(0));
    const weights = known.length ? known.map((d) => dec(d.subtotal)) : lineWeights;
    const targets = known.length
      ? known.map((d) => indexOf.get(d.lineItemId) as number)
      : lines.map((_, i) => i);
    const split = splitByWeights(dec(e.amount), weights, currency);
    split.forEach((p, k) => {
      const t = targets[k] as number;
      refundParts[t] = (refundParts[t] as Dec).plus(p);
    });
  }

  const cogs = lines.map(() => new D(0));
  const cost: CostStatus[] = lines.map(() => 'none');
  let strayCogs = new D(0);
  for (const e of entries) {
    if (e.component !== 'cogs' && e.component !== 'cogs_reversal') continue;
    const i = e.lineItemId === null ? undefined : indexOf.get(e.lineItemId);
    if (i === undefined) {
      strayCogs = strayCogs.plus(dec(e.amount));
      continue;
    }
    cogs[i] = (cogs[i] as Dec).plus(dec(e.amount));
    const cur = cost[i] as CostStatus;
    if (e.component === 'cogs' && e.status in WEAKEST) {
      if (cur === 'none' || (WEAKEST[e.status] as number) > (WEAKEST[cur] as number)) {
        cost[i] = e.status as CostStatus;
      }
    }
  }

  return {
    lines: lines.map((l, i) => {
      const g = gross[i] ?? new D(0);
      const d = discounts[i] ?? new D(0);
      const r = refundParts[i] as Dec;
      const c = cogs[i] as Dec;
      return {
        lineItemId: l.lineItemId,
        productId: l.productId,
        quantity: l.quantity,
        grossSales: toStored(g),
        discounts: toStored(d),
        productRefunds: toStored(r),
        cogs: toStored(c),
        profit: toStored(g.plus(d).plus(r).plus(c)),
        costStatus: cost[i] as CostStatus,
      };
    }),
    unallocated: {
      shippingRevenue: toStored(sumOf('shipping_revenue')),
      shippingRefund: toStored(sumOf('shipping_refund')),
      paymentFees: toStored(sumOf('payment_fees')),
      shippingCost: toStored(sumOf('shipping_cost')),
      unlinkedCost: toStored(strayCogs),
    },
  };
}
