// Pure mappers: Shopify GraphQL nodes -> normalized rows. No I/O. Money stays a decimal STRING
// end to end (never a JavaScript float); sums use scaled BigInt arithmetic.

import { createHash } from 'node:crypto';

// Any is intentional: input is untrusted JSON, validated field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MappingError';
  }
}

/** Numeric part of a Shopify GID. Guards against ids beyond JavaScript's safe integer range. */
export function parseGid(gid: unknown): number {
  const m = typeof gid === 'string' ? /\/(\d+)(?:\?.*)?$/.exec(gid) : null;
  if (!m) throw new MappingError('Unexpected Shopify id format');
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n)) throw new MappingError('Shopify id exceeds the safe integer range');
  return n;
}

const optGid = (gid: unknown): number | null => (gid ? parseGid(gid) : null);

function countryCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

const MONEY_RE = /^-?\d+(\.\d+)?$/;

/** Reads `{ shopMoney: { amount } }` as a decimal string normalised to 4 decimal places. */
export function money(set: Json, fallback?: string): string {
  const raw: unknown = set?.shopMoney?.amount ?? fallback;
  if (typeof raw !== 'string' || !MONEY_RE.test(raw)) {
    throw new MappingError('Missing or malformed money amount');
  }
  return normalizeMoney(raw);
}

function toScaled(amount: string): bigint {
  const neg = amount.startsWith('-');
  const [intPart, frac = ''] = amount.replace('-', '').split('.');
  const scaled = BigInt(intPart!) * 10_000n + BigInt((frac + '0000').slice(0, 4));
  return neg ? -scaled : scaled;
}

function fromScaled(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = `${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, '0')}`;
  return neg ? `-${s}` : s;
}

export const normalizeMoney = (amount: string): string => fromScaled(toScaled(amount));
export const sumMoney = (amounts: string[]): string =>
  fromScaled(amounts.reduce((acc, a) => acc + toScaled(a), 0n));

const date = (v: unknown): Date => {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new MappingError('Malformed date');
  return d;
};
const optDate = (v: unknown): Date | null => (v ? date(v) : null);

// --- products -------------------------------------------------------------------------------

export interface MappedVariant {
  shopifyId: number;
  productShopifyId: number;
  title: string;
  sku: string | null;
  priceAmount: string;
  inventoryItemShopifyId: number | null;
  unitCostAmount: string | null;
  weightGrams: number | null;
  shopifyUpdatedAt: Date;
}

const GRAMS: Record<string, number> = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  OUNCES: 28.349523125,
  POUNDS: 453.59237,
};

/** Shopify weight to whole grams. Unknown units and bad numbers become null, never zero. */
export function weightToGrams(value: unknown, unit: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  const factor = typeof unit === 'string' ? GRAMS[unit] : undefined;
  if (!Number.isFinite(n) || n < 0 || factor === undefined) return null;
  return Math.round(n * factor);
}

export interface MappedProduct {
  shopifyId: number;
  title: string;
  handle: string | null;
  status: string;
  productType: string;
  vendor: string;
  isGiftCard: boolean;
  collectionTitles: string[];
  shopifyUpdatedAt: Date;
}

export function mapVariant(productShopifyId: number, v: Json): MappedVariant {
  return {
    shopifyId: parseGid(v.id),
    productShopifyId,
    title: String(v.title ?? ''),
    sku: v.sku ? String(v.sku) : null,
    priceAmount: normalizeMoney(String(v.price ?? '0')),
    inventoryItemShopifyId: optGid(v.inventoryItem?.id),
    unitCostAmount: v.inventoryItem?.unitCost?.amount
      ? normalizeMoney(String(v.inventoryItem.unitCost.amount))
      : null,
    weightGrams: weightToGrams(
      v.inventoryItem?.measurement?.weight?.value,
      v.inventoryItem?.measurement?.weight?.unit,
    ),
    shopifyUpdatedAt: date(v.updatedAt),
  };
}

export function mapProduct(node: Json): {
  product: MappedProduct;
  variants: MappedVariant[];
  moreVariants: { hasNext: boolean; after: string | null };
} {
  const shopifyId = parseGid(node.id);
  return {
    product: {
      shopifyId,
      title: String(node.title ?? ''),
      handle: node.handle ? String(node.handle) : null,
      status: String(node.status),
      productType: String(node.productType ?? ''),
      vendor: String(node.vendor ?? ''),
      isGiftCard: Boolean(node.isGiftCard),
      collectionTitles: (node.collections?.nodes ?? [])
        .map((c: Json) => String(c?.title ?? '').trim())
        .filter(Boolean)
        .slice(0, 20),
      shopifyUpdatedAt: date(node.updatedAt),
    },
    variants: (node.variants?.nodes ?? []).map((v: Json) => mapVariant(shopifyId, v)),
    moreVariants: {
      hasNext: Boolean(node.variants?.pageInfo?.hasNextPage),
      after: node.variants?.pageInfo?.endCursor ?? null,
    },
  };
}

// --- orders ---------------------------------------------------------------------------------

export interface MappedLineItem {
  shopifyId: number;
  productShopifyId: number | null;
  variantShopifyId: number | null;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPriceAmount: string;
  discountAmount: string;
  taxAmount: string;
  requiresShipping: boolean;
}

export interface MappedRefund {
  shopifyId: number;
  processedAt: Date;
  shopifyCreatedAt: Date;
  totalAmount: string;
  note: string | null;
  lines: {
    shopifyId: number;
    lineItemShopifyId: number;
    quantity: number;
    subtotalAmount: string;
    taxAmount: string;
    restockType: string | null;
  }[];
}

export interface MappedTransaction {
  shopifyId: number;
  parentShopifyId: number | null;
  kind: string;
  status: string;
  gateway: string | null;
  amount: string;
  currency: string;
  processedAt: Date;
  feeAmount: string | null;
}

export interface MappedOrder {
  shopifyId: number;
  name: string;
  processedAt: Date;
  shopifyCreatedAt: Date;
  shopifyUpdatedAt: Date;
  cancelledAt: Date | null;
  closedAt: Date | null;
  financialStatus: string;
  fulfillmentStatus: string | null;
  taxesIncluded: boolean;
  isTest: boolean;
  currency: string;
  presentmentCurrency: string | null;
  subtotalAmount: string;
  discountsAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  refundedAmount: string;
  presentmentTotalAmount: string | null;
  tags: string[];
  sourceName: string | null;
  shipCountry: string | null;
  /** One-way key of the customer (see customerKey); null for a guest checkout or when not readable. */
  customerKey: string | null;
  /** Shopify returned more refund line items than one page; the rest were not imported. */
  refundLinesIncomplete: boolean;
}

export interface MappedOrderBundle {
  order: MappedOrder;
  lineItems: MappedLineItem[];
  refunds: MappedRefund[];
  transactions: MappedTransaction[];
  /** Nested lists Shopify said it truncated; the sync reports these instead of hiding them. */
  truncated: { lineItems: boolean; refundLineItems: boolean };
  lineItemsAfter: string | null;
  /** Refunds with more line items than the first page: where to continue reading each one. */
  refundLinesAfter: Array<{ refundGid: string; refundShopifyId: number; after: string | null }>;
}

export function mapLineItem(l: Json): MappedLineItem {
  return {
    shopifyId: parseGid(l.id),
    productShopifyId: optGid(l.product?.id),
    variantShopifyId: optGid(l.variant?.id),
    title: String(l.title ?? ''),
    variantTitle: l.variantTitle ? String(l.variantTitle) : null,
    sku: l.sku ? String(l.sku) : null,
    quantity: Number(l.quantity),
    unitPriceAmount: money(l.originalUnitPriceSet),
    discountAmount: money(l.totalDiscountSet, '0'),
    taxAmount: sumMoney((l.taxLines ?? []).map((t: Json) => money(t.priceSet))),
    requiresShipping: Boolean(l.requiresShipping),
  };
}

/** One refund line item as the database stores it. */
export function mapRefundLine(rl: Json) {
  return {
    shopifyId: parseGid(rl.id),
    lineItemShopifyId: parseGid(rl.lineItem?.id),
    quantity: Number(rl.quantity),
    subtotalAmount: money(rl.subtotalSet, '0'),
    taxAmount: money(rl.totalTaxSet, '0'),
    restockType: rl.restockType ? String(rl.restockType) : null,
  };
}

/**
 * A pseudonymous key for the customer who placed an order, used only to group a shop's orders by customer for
 * lifetime value. It is a one-way hash of Shopify's customer id: no name, email, phone or address is read or
 * stored, and the key means nothing outside this app. A guest checkout has no customer, so no key.
 */
export function customerKey(gid: unknown): string | null {
  if (typeof gid !== 'string' || !gid) return null;
  return createHash('sha256')
    .update(`profit-intelligence:customer:${gid}`)
    .digest('hex')
    .slice(0, 32);
}

export function mapOrder(node: Json): MappedOrderBundle {
  const createdAt = date(node.createdAt);
  const processedAt = optDate(node.processedAt) ?? createdAt;
  const presentmentMoney = node.totalPriceSet?.presentmentMoney;
  const currency = String(node.currencyCode);

  const order: MappedOrder = {
    shopifyId: parseGid(node.id),
    name: String(node.name),
    processedAt,
    shopifyCreatedAt: createdAt,
    shopifyUpdatedAt: date(node.updatedAt),
    cancelledAt: optDate(node.cancelledAt),
    closedAt: optDate(node.closedAt),
    financialStatus: String(node.displayFinancialStatus ?? 'UNKNOWN'),
    fulfillmentStatus: node.displayFulfillmentStatus ? String(node.displayFulfillmentStatus) : null,
    taxesIncluded: Boolean(node.taxesIncluded),
    isTest: Boolean(node.test),
    currency,
    presentmentCurrency: node.presentmentCurrencyCode ? String(node.presentmentCurrencyCode) : null,
    subtotalAmount: money(node.subtotalPriceSet, '0'),
    discountsAmount: money(node.totalDiscountsSet, '0'),
    shippingAmount: money(node.totalShippingPriceSet, '0'),
    taxAmount: money(node.totalTaxSet, '0'),
    totalAmount: money(node.totalPriceSet),
    refundedAmount: money(node.totalRefundedSet, '0'),
    presentmentTotalAmount:
      presentmentMoney?.currencyCode && presentmentMoney.currencyCode !== currency
        ? normalizeMoney(String(presentmentMoney.amount))
        : null,
    tags: (node.tags ?? []).map(String),
    sourceName: node.sourceName ? String(node.sourceName) : null,
    shipCountry: countryCode(node.shippingAddress?.countryCodeV2),
    customerKey: customerKey(node.customer?.id),
    refundLinesIncomplete: (node.refunds ?? []).some(
      (r: Json) => r.refundLineItems?.pageInfo?.hasNextPage,
    ),
  };

  const refunds: MappedRefund[] = (node.refunds ?? []).map((r: Json) => ({
    shopifyId: parseGid(r.id),
    shopifyCreatedAt: date(r.createdAt),
    // refund.processedAt is the effective date; the REFUND transaction carries the creation time.
    processedAt: optDate(r.processedAt) ?? date(r.createdAt),
    totalAmount: money(r.totalRefundedSet, '0'),
    note: r.note ? String(r.note) : null,
    lines: (r.refundLineItems?.nodes ?? []).map(mapRefundLine),
  }));

  const transactions: MappedTransaction[] = (node.transactions ?? []).map((t: Json) => {
    const fees: Json[] = t.fees ?? [];
    return {
      shopifyId: parseGid(t.id),
      parentShopifyId: optGid(t.parentTransaction?.id),
      kind: String(t.kind),
      status: String(t.status),
      gateway: t.gateway ? String(t.gateway) : null,
      amount: money(t.amountSet),
      currency: String(t.amountSet?.shopMoney?.currencyCode ?? currency),
      processedAt: optDate(t.processedAt) ?? processedAt,
      // Empty list means Shopify reports no fee data for this gateway (unknown, not zero).
      feeAmount: fees.length
        ? sumMoney(fees.map((f) => normalizeMoney(String(f.amount.amount))))
        : null,
    };
  });

  return {
    order,
    lineItems: (node.lineItems?.nodes ?? []).map(mapLineItem),
    refunds,
    transactions,
    truncated: {
      lineItems: Boolean(node.lineItems?.pageInfo?.hasNextPage),
      refundLineItems: (node.refunds ?? []).some(
        (r: Json) => r.refundLineItems?.pageInfo?.hasNextPage,
      ),
    },
    lineItemsAfter: node.lineItems?.pageInfo?.endCursor ?? null,
    refundLinesAfter: (node.refunds ?? [])
      .filter((r: Json) => r.refundLineItems?.pageInfo?.hasNextPage)
      .map((r: Json) => ({
        refundGid: String(r.id),
        refundShopifyId: parseGid(r.id),
        after: r.refundLineItems.pageInfo.endCursor ?? null,
      })),
  };
}
