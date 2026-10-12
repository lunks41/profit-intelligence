// Types of the profit engine. Pure data in, pure data out: no I/O, no clock, no database.
// Money fields are decimal STRINGS in the shop currency (the form Postgres and Shopify use).

export const ENGINE_VERSION = '1.0.0';

export type Status = 'actual' | 'estimated' | 'missing' | 'not_applicable';

export type Component =
  | 'gross_sales'
  | 'discounts'
  | 'shipping_revenue'
  | 'tax_collected'
  | 'product_refund'
  | 'shipping_refund'
  | 'tax_refunded'
  | 'cogs'
  | 'cogs_reversal'
  | 'payment_fees'
  | 'shipping_cost';

/** Components that are tracked but are not part of revenue or profit. */
export const MEMO_COMPONENTS: readonly Component[] = ['tax_collected', 'tax_refunded'];

// ---- input ----------------------------------------------------------------------------------

export interface EngineLine {
  shopifyId: number;
  variantShopifyId: number | null;
  productShopifyId: number | null;
  quantity: number;
  unitPriceAmount: string;
  taxAmount: string;
  requiresShipping: boolean;
  /** Gift card sales are a liability, not revenue (decision D6). */
  isGiftCard: boolean;
}

export interface EngineRefundLine {
  shopifyId: number;
  lineItemShopifyId: number;
  quantity: number;
  subtotalAmount: string;
  taxAmount: string;
  restockType: string | null;
}

export interface EngineRefund {
  shopifyId: number;
  /** The effective date of the refund (refund.processedAt), never the transaction time. */
  processedAt: Date;
  totalAmount: string;
  lines: EngineRefundLine[];
}

export interface EngineTransaction {
  shopifyId: number;
  kind: string;
  status: string;
  gateway: string | null;
  amount: string;
  /** Fee reported by the provider; null means "no fee data" (unknown, not zero). */
  feeAmount: string | null;
}

export interface EngineOrder {
  shopifyId: number;
  processedAt: Date;
  isTest: boolean;
  financialStatus: string;
  cancelledAt: Date | null;
  taxesIncluded: boolean;
  currency: string;
  /** ISO country of the shipping destination, when Shopify provides it. Not a street address. */
  shipCountry?: string | null;
  /** Refund line items were only partly imported: product refunds may be understated. */
  refundLinesIncomplete?: boolean;
  subtotalAmount: string;
  discountsAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  lines: EngineLine[];
  refunds: EngineRefund[];
  transactions: EngineTransaction[];
}

// ---- configuration (merchant data) ----------------------------------------------------------

export interface CostPoint {
  /** First day (YYYY-MM-DD, shop time zone) the cost applies. It applies until the next point. */
  effectiveFrom: string;
  amount: string;
  /** how the merchant gave the cost: typed in, or imported from a file (default: typed in) */
  source?: 'manual' | 'import';
}

export interface FrozenCost {
  unitCost: string;
  status: 'actual' | 'estimated';
  source: string;
}

export interface FeeRule {
  /** null = any gateway */
  gateway: string | null;
  /** percent of the payment, e.g. "2.9" for 2.9% */
  percent: string;
  fixedAmount: string;
  currency: string;
  effectiveFrom: string;
}

export interface ShippingRule {
  mode: 'flat' | 'percent_of_shipping_charged' | 'per_kilogram';
  amount: string | null;
  percent: string | null;
  effectiveFrom: string;
  /** Merchant's name for this group of countries. Not used when choosing a rule. */
  zone?: string | null;
  /** ISO country codes. Empty or omitted means any country. */
  countries?: readonly string[];
  /** Inclusive lower bound, grams. Omitted means no lower bound. */
  weightMinGrams?: number | null;
  /** Exclusive upper bound, grams. Omitted means no upper bound. */
  weightMaxGrams?: number | null;
}

/** What an order looks like for choosing a shipping rule. */
export interface Shipment {
  country: string | null;
  /** Total grams of shippable lines, or null when any of those lines has no weight. */
  weightGrams: number | null;
}

export interface EngineConfig {
  /** IANA time zone of the shop: decides the business date of every event. */
  timezone: string;
  /** Merchant-entered, effective-dated unit costs by variant (Actual). */
  merchantCosts: ReadonlyMap<number, readonly CostPoint[]>;
  /** Shopify's current unit cost by variant (Estimated when applied to a past order). */
  shopifyCosts: ReadonlyMap<number, string>;
  /**
   * Costs already used for a line in an earlier calculation. Reused so that recalculating an order
   * (a webhook, a refund) never silently rewrites its historical COGS.
   */
  frozenCosts?: ReadonlyMap<number, FrozenCost>;
  feeRules: readonly FeeRule[];
  shippingRules: readonly ShippingRule[];
  /** Current variant weight in grams. Used only to pick a shipping rule. */
  variantWeights?: ReadonlyMap<number, number>;
}

// ---- output ---------------------------------------------------------------------------------

export interface LedgerEntry {
  component: Component;
  /** When the event happened: the order date, or the refund date for refund effects. */
  occurredAt: Date;
  /** Business date in the shop time zone (YYYY-MM-DD). Summaries group by this. */
  entryDate: string;
  /** Signed amount in the shop currency, rounded to the currency's minor unit. */
  amount: string;
  status: Status;
  /** Human-readable origin, e.g. "merchant cost effective 2026-04-01". */
  source: string;
  lineItemShopifyId: number | null;
  refundShopifyId: number | null;
  /** The sales amount this entry's data quality applies to (weights the confidence). */
  basisAmount: string | null;
  memo: boolean;
  detail: Record<string, unknown>;
}

export type ExclusionReason =
  'test_order' | 'awaiting_payment' | 'cancelled_unpaid' | 'voided_or_expired' | 'no_exchange_rate';

export interface OrderResult {
  recognized: boolean;
  exclusionReason: ExclusionReason | null;
  flags: string[];
  entries: LedgerEntry[];
}
