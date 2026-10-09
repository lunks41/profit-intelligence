import { businessDate } from './dates.js';
import { D, dec, roundToCurrency, sum, toStored } from './money.js';
import type { Dec } from './money.js';
import {
  estimateFee,
  estimateShippingCost,
  pickFeeRule,
  pickShippingRule,
  resolveUnitCost,
} from './rules.js';
import type { ResolvedCost } from './rules.js';
import { MEMO_COMPONENTS } from './types.js';
import type {
  Component,
  EngineConfig,
  EngineLine,
  EngineOrder,
  ExclusionReason,
  LedgerEntry,
  OrderResult,
  Status,
} from './types.js';

const ZERO = new D(0);
const COUNTED_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
const PAYMENT_KINDS = new Set(['SALE', 'CAPTURE']);
const RESTOCK_TYPES = new Set(['RETURN', 'CANCEL', 'LEGACY_RESTOCK']);

/** Decision D2: only orders with money collected in full are counted. */
export function exclusionReason(order: EngineOrder): ExclusionReason | null {
  if (order.isTest) return 'test_order';
  if (COUNTED_STATUSES.has(order.financialStatus)) return null;
  if (order.financialStatus === 'VOIDED' || order.financialStatus === 'EXPIRED') {
    return 'voided_or_expired';
  }
  if (order.cancelledAt) return 'cancelled_unpaid';
  return 'awaiting_payment'; // PENDING, AUTHORIZED, PARTIALLY_PAID, anything unknown
}

interface Extra {
  line?: number;
  refund?: number;
  basis?: Dec;
  detail?: Record<string, unknown>;
}

/**
 * Turns one Shopify order into ledger entries following docs/finance/profit-calculation-spec.md.
 * Pure and deterministic. Entries are rounded once, half away from zero, to the currency minor unit.
 */
export function calculateOrder(order: EngineOrder, cfg: EngineConfig): OrderResult {
  const reason = exclusionReason(order);
  if (reason) return { recognized: false, exclusionReason: reason, flags: [], entries: [] };

  const cur = order.currency;
  const tz = cfg.timezone;
  const orderDate = businessDate(order.processedAt, tz);
  const entries: LedgerEntry[] = [];
  const flags: string[] = [];

  const push = (
    component: Component,
    at: Date,
    amount: Dec,
    status: Status,
    source: string,
    extra: Extra = {},
  ) => {
    const rounded = roundToCurrency(amount, cur);
    entries.push({
      component,
      occurredAt: at,
      entryDate: businessDate(at, tz),
      amount: rounded.isZero() ? '0.0000' : toStored(rounded),
      status,
      source,
      lineItemShopifyId: extra.line ?? null,
      refundShopifyId: extra.refund ?? null,
      basisAmount: extra.basis ? toStored(roundToCurrency(extra.basis, cur)) : null,
      memo: MEMO_COMPONENTS.includes(component),
      detail: extra.detail ?? {},
    });
  };
  /** Sales-type entries with a value of zero carry no information and are not stored. */
  const pushIfNonZero = (...args: Parameters<typeof push>) => {
    if (!roundToCurrency(args[2], cur).isZero()) push(...args);
  };

  // ---- sales, discounts, shipping revenue, tax (spec sections 4) ----------------------------
  const lineGross = (l: EngineLine) => dec(l.unitPriceAmount).mul(l.quantity);
  const nonGift = order.lines.filter((l) => !l.isGiftCard && l.quantity > 0);
  const grossAll = sum(order.lines.map(lineGross));
  const subtotal = dec(order.subtotalAmount);

  // Order-level discounts are not on the lines, so derive them from Shopify's own subtotal.
  let productDiscount = grossAll.minus(subtotal);
  if (productDiscount.lt(0)) {
    flags.push('discount_inconsistent');
    productDiscount = ZERO;
  }
  // With a free-shipping code Shopify's discount total also contains the shipping discount.
  let shippingDiscount = dec(order.discountsAmount).minus(productDiscount);
  if (shippingDiscount.lt(0)) {
    flags.push('discount_inconsistent');
    shippingDiscount = ZERO;
  }

  const lineTaxAll = sum(order.lines.map((l) => l.taxAmount));
  const shippingTax = D.max(dec(order.taxAmount).minus(lineTaxAll), ZERO);
  const grossNonGift = sum(nonGift.map(lineGross));
  const share = grossAll.isZero() ? new D(1) : grossNonGift.div(grossAll);
  const discountNonGift = productDiscount.mul(share);
  const taxNonGift = sum(nonGift.map((l) => l.taxAmount));

  let grossEx: Dec;
  let discountEx: Dec;
  let k = new D(1); // tax-inclusive: share of a price that is not tax
  if (order.taxesIncluded) {
    const afterDiscount = grossNonGift.minus(discountNonGift);
    const netProducts = afterDiscount.minus(taxNonGift);
    k = afterDiscount.gt(0) ? netProducts.div(afterDiscount) : new D(1);
    grossEx = roundToCurrency(grossNonGift.mul(k), cur);
    discountEx = grossEx.minus(roundToCurrency(netProducts, cur)); // derived: identity holds exactly
  } else {
    grossEx = grossNonGift;
    discountEx = discountNonGift;
  }
  pushIfNonZero('gross_sales', order.processedAt, grossEx, 'actual', 'shopify order lines');
  pushIfNonZero('discounts', order.processedAt, discountEx.neg(), 'actual', 'shopify discounts', {
    detail: {
      productDiscount: toStored(productDiscount),
      shippingDiscount: toStored(shippingDiscount),
    },
  });

  const shippingCharged = dec(order.shippingAmount);
  const shippingRevenue = D.max(
    shippingCharged.minus(shippingDiscount).minus(order.taxesIncluded ? shippingTax : ZERO),
    ZERO,
  );
  pushIfNonZero(
    'shipping_revenue',
    order.processedAt,
    shippingRevenue,
    'actual',
    'shopify shipping',
  );
  pushIfNonZero(
    'tax_collected',
    order.processedAt,
    taxNonGift.plus(shippingTax),
    'actual',
    'shopify tax (memo)',
  );

  // ---- product cost (spec section 6) --------------------------------------------------------
  const resolvedByLine = new Map<number, ResolvedCost>();
  for (const line of nonGift) {
    const basis = lineGross(line).mul(order.taxesIncluded ? k : new D(1));
    const resolved = resolveUnitCost(cfg, line, orderDate);
    if (resolved) {
      resolvedByLine.set(line.shopifyId, resolved);
      push(
        'cogs',
        order.processedAt,
        dec(resolved.unitCost).mul(line.quantity).neg(),
        resolved.status,
        resolved.source,
        {
          line: line.shopifyId,
          basis,
          detail: {
            unitCost: resolved.unitCost,
            quantity: line.quantity,
            unitPrice: line.unitPriceAmount,
          },
        },
      );
    } else {
      push(
        'cogs',
        order.processedAt,
        ZERO,
        'missing',
        line.variantShopifyId === null ? 'custom line item (no variant)' : 'no cost available',
        {
          line: line.shopifyId,
          basis,
          detail: { quantity: line.quantity, unitPrice: line.unitPriceAmount },
        },
      );
    }
  }

  // ---- payment fees (spec section 7) --------------------------------------------------------
  const payments = order.transactions.filter(
    (t) => PAYMENT_KINDS.has(t.kind) && t.status === 'SUCCESS',
  );
  if (payments.length === 0) {
    if (dec(order.totalAmount).isZero()) {
      push(
        'payment_fees',
        order.processedAt,
        ZERO,
        'not_applicable',
        'no payment due (zero total)',
      );
    } else {
      push('payment_fees', order.processedAt, ZERO, 'missing', 'no payment transaction found');
    }
  }
  for (const t of payments) {
    if (t.feeAmount !== null) {
      push(
        'payment_fees',
        order.processedAt,
        dec(t.feeAmount).neg(),
        'actual',
        'provider-reported fee',
        {
          detail: { transaction: t.shopifyId, gateway: t.gateway },
        },
      );
      continue;
    }
    const rule = pickFeeRule(cfg.feeRules, t.gateway, cur, orderDate);
    if (rule) {
      push(
        'payment_fees',
        order.processedAt,
        estimateFee(rule, t.amount, cur).neg(),
        'estimated',
        `fee rule ${rule.percent}% + ${rule.fixedAmount}`,
        {
          detail: { transaction: t.shopifyId, gateway: t.gateway, paymentAmount: t.amount },
        },
      );
    } else {
      push(
        'payment_fees',
        order.processedAt,
        ZERO,
        'missing',
        `no fee data or rule for gateway ${t.gateway ?? 'unknown'}`,
        {
          detail: { transaction: t.shopifyId, gateway: t.gateway },
        },
      );
    }
  }

  // ---- carrier shipping cost (spec section 8) -----------------------------------------------
  if (!nonGift.some((l) => l.requiresShipping)) {
    push('shipping_cost', order.processedAt, ZERO, 'not_applicable', 'nothing to ship');
  } else {
    const rule = pickShippingRule(cfg.shippingRules, orderDate);
    if (rule) {
      const cost = estimateShippingCost(rule, order.shippingAmount, cur);
      push(
        'shipping_cost',
        order.processedAt,
        cost.neg(),
        cost.isZero() ? 'actual' : 'estimated',
        rule.mode === 'flat'
          ? `shipping rule flat ${rule.amount}`
          : `shipping rule ${rule.percent}% of shipping charged`,
      );
    } else {
      push('shipping_cost', order.processedAt, ZERO, 'missing', 'no shipping cost rule');
    }
  }

  // ---- refunds, dated by the refund (cash view, decision D1; spec section 5) ----------------
  const nonGiftIds = new Set(nonGift.map((l) => l.shopifyId));
  let moneyRefunds = 0;
  for (const refund of order.refunds) {
    const total = dec(refund.totalAmount);
    if (!total.gt(0)) continue; // restock-only refund, e.g. a cancelled unpaid order: no money moved
    moneyRefunds++;
    const at = refund.processedAt;

    const rsub = sum(refund.lines.map((l) => l.subtotalAmount));
    const rtax = sum(refund.lines.map((l) => l.taxAmount));
    const residual = D.max(total.minus(rsub).minus(rtax), ZERO); // shipping (and its tax) refunded

    let productRefund = ZERO;
    let productTax = ZERO;
    for (const l of refund.lines) {
      if (!nonGiftIds.has(l.lineItemShopifyId)) continue; // gift card refunds are not sales refunds
      productRefund = productRefund.plus(
        order.taxesIncluded ? dec(l.subtotalAmount).minus(l.taxAmount) : l.subtotalAmount,
      );
      productTax = productTax.plus(l.taxAmount);
    }
    const shippingExFactor =
      order.taxesIncluded && shippingTax.gt(0) && shippingCharged.gt(0)
        ? shippingCharged.minus(shippingTax).div(shippingCharged)
        : new D(1);
    const shippingRefund = residual.mul(shippingExFactor);

    pushIfNonZero('product_refund', at, productRefund.neg(), 'actual', 'shopify refund', {
      refund: refund.shopifyId,
    });
    pushIfNonZero(
      'shipping_refund',
      at,
      shippingRefund.neg(),
      'actual',
      'shopify refund (shipping)',
      { refund: refund.shopifyId },
    );
    pushIfNonZero(
      'tax_refunded',
      at,
      productTax.plus(residual.minus(shippingRefund)).neg(),
      'actual',
      'shopify refund tax (memo)',
      { refund: refund.shopifyId },
    );

    // Goods returned to stock bring their cost back, on the refund date. Lost goods do not.
    for (const l of refund.lines) {
      if (!l.restockType || !RESTOCK_TYPES.has(l.restockType)) continue;
      const resolved = resolvedByLine.get(l.lineItemShopifyId);
      if (!resolved) continue; // no cost known: nothing to reverse
      push(
        'cogs_reversal',
        at,
        dec(resolved.unitCost).mul(l.quantity),
        resolved.status,
        `reversal of ${resolved.source}`,
        {
          line: l.lineItemShopifyId,
          refund: refund.shopifyId,
          detail: { unitCost: resolved.unitCost, quantity: l.quantity, restockType: l.restockType },
        },
      );
    }
  }

  if (order.cancelledAt && moneyRefunds === 0) flags.push('cancelled_without_refund');

  return { recognized: true, exclusionReason: null, flags, entries };
}
