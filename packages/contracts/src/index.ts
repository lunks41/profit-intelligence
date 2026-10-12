import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(['web', 'api', 'worker']),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const shopStatusSchema = z.enum(['active', 'uninstalled', 'reauth_required']);

export const sessionResponseSchema = z.object({
  shop: z.object({
    domain: z.string(),
    name: z.string(),
    currency: z.string(),
    timezone: z.string(),
    status: shopStatusSchema,
    installedAt: z.string(),
  }),
  onboarding: z.object({
    steps: z.array(
      z.object({
        id: z.enum([
          'connected',
          'import_orders',
          'product_costs',
          'payment_fees',
          'shipping_costs',
          'ad_platforms',
          'expenses',
        ]),
        label: z.string(),
        status: z.enum(['done', 'pending']),
        /** where to do it; null when there is nothing to do */
        href: z.string().nullable(),
        /** true for steps that improve profit accuracy but are not required */
        optional: z.boolean(),
        /** one sentence on why it matters */
        why: z.string(),
      }),
    ),
  }),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const syncStateSchema = z.enum([
  'never',
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
]);

export const syncStatusResponseSchema = z.object({
  state: syncStateSchema,
  stage: z.string().nullable(),
  progress: z.object({ products: z.number(), orders: z.number() }),
  /** What is stored right now. The dashboard can show these while an import is still running. */
  counts: z.object({ products: z.number(), orders: z.number(), refunds: z.number() }),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  error: z.string().nullable(),
  /** True when no successful sync happened recently (or ever). */
  stale: z.boolean(),
  /** Live updates (webhooks): when the last one arrived and how many failed in the last 24 hours. */
  liveUpdates: z.object({ lastReceivedAt: z.string().nullable(), failedLast24h: z.number() }),
});
export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;

// ---- dashboard overview -----------------------------------------------------------------------

const money = z.string(); // exact decimal string, 4 decimals
const ratio = z.string().nullable(); // exact decimal string (0.3705 = 37.05%), null when undefined

export const periodPresetSchema = z.enum([
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  '60d',
  '90d',
  '365d',
  'this_month',
  'previous_month',
  'custom',
]);
export type PeriodPreset = z.infer<typeof periodPresetSchema>;

export const periodSchema = z.object({
  /** inclusive, YYYY-MM-DD in the shop time zone */
  from: z.string(),
  to: z.string(),
  days: z.number(),
  preset: periodPresetSchema,
  timezone: z.string(),
});

export const shareSchema = z.object({
  actual: z.string(),
  estimated: z.string(),
  missing: z.string(),
});
const coverageSchema = z.object({ shares: shareSchema, quality: z.string() });

export const figureStatusSchema = z.enum([
  'confirmed',
  'estimated',
  'missing',
  'not_configured',
  'not_applicable',
]);
export type FigureStatusValue = z.infer<typeof figureStatusSchema>;

export const profitSummarySchema = z.object({
  grossSales: money,
  discounts: money,
  productRefunds: money,
  netSales: money,
  shippingRevenue: money,
  revenue: money,
  cogs: money,
  paymentFees: money,
  shippingCost: money,
  adSpend: money.nullable(),
  /** revenue - product cost - payment fees - shipping cost; advertising is not taken off */
  contributionProfit: money,
  /** the variable costs of selling: product cost, fees and shipping cost (revenue - contribution profit) */
  totalCosts: money,
  /** rent, salaries, software and other operating expenses; advertising is separate (adSpend) */
  operatingExpenses: money.nullable(),
  /** contribution profit - advertising - operating expenses; null until expenses are set up */
  estimatedOperatingProfit: money.nullable(),
  operatingProfitBasis: z.enum(['full', 'contribution_only']),
  contributionMargin: ratio,
  /** estimated operating profit / revenue; null when operating profit is not available */
  operatingMargin: ratio,
  averageOrderValue: money.nullable(),
  refundRate: ratio,
  taxCollected: money,
  taxRefunded: money,
  partial: z.boolean(),
  statuses: z.object({
    cogs: figureStatusSchema,
    paymentFees: figureStatusSchema,
    shippingCost: figureStatusSchema,
    advertising: figureStatusSchema,
    operatingExpenses: figureStatusSchema,
    estimatedOperatingProfit: figureStatusSchema,
  }),
  missingShares: z.object({
    cogs: z.string().nullable(),
    paymentFees: z.string().nullable(),
    shippingCost: z.string().nullable(),
  }),
  /** plain-language reasons the profit is incomplete or excludes something */
  qualifiers: z.array(z.string()),
  missingCostShare: ratio,
  orders: z.number(),
  confidence: z.object({
    band: z.enum(['high', 'medium', 'low']).nullable(),
    score: z.string().nullable(),
    components: z.object({
      cost: coverageSchema.optional(),
      fees: coverageSchema.optional(),
      shipping: coverageSchema.optional(),
    }),
    weights: z.object({ cost: z.string(), fees: z.string(), shipping: z.string() }),
  }),
});
export type ProfitSummary = z.infer<typeof profitSummarySchema>;

export const alertSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  /** the measured fact behind the alert */
  evidence: z.string(),
  /** why it matters */
  why: z.string(),
  action: z.object({ label: z.string(), href: z.string() }).nullable(),
});
export type Alert = z.infer<typeof alertSchema>;

/** Share of sales value, or count of orders, whose cost is confirmed, estimated or missing. */
const orderCounts = z.object({ confirmed: z.number(), estimated: z.number(), missing: z.number() });

export const dataQualitySchema = z.object({
  /** product cost, as shares (0 to 1, 4 places) of sales value */
  cost: z.object({ confirmed: z.string(), estimated: z.string(), missing: z.string() }).nullable(),
  /** payment fees, as counts of orders */
  fees: orderCounts.nullable(),
  /** shipping cost, as counts of orders */
  shipping: orderCounts.nullable(),
  advertising: figureStatusSchema,
  operatingExpenses: figureStatusSchema,
});
export type DataQuality = z.infer<typeof dataQualitySchema>;

export const issueSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  /** what is wrong and what it does to the figures */
  detail: z.string(),
  action: z.object({ label: z.string(), href: z.string() }),
});
export type Issue = z.infer<typeof issueSchema>;

export const overviewQuerySchema = z.object({
  preset: periodPresetSchema.default('30d'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** how the chart groups days; "auto" is daily up to 90 days and weekly beyond */
  interval: z.enum(['auto', 'day', 'week', 'month']).default('auto'),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const overviewResponseSchema = z.object({
  period: periodSchema,
  previousPeriod: z.object({ from: z.string(), to: z.string() }),
  currency: z.object({
    /** currency of the amounts in this response: always USD */
    code: z.string(),
    /** the currency Shopify says the store sells in */
    shopCode: z.string(),
    /** only USD: there is no currency switching */
    available: z.array(z.string()),
    /** true when the store currency is not USD, so its amounts were converted */
    converted: z.boolean(),
    /** when the store sells in another currency: how its amounts were converted to USD */
    note: z.string().nullable(),
  }),
  summary: profitSummarySchema,
  previous: profitSummarySchema,
  /** relative change vs the previous period (0.1 = +10%); null when the previous value is zero */
  deltas: z.object({
    revenue: z.number().nullable(),
    contributionProfit: z.number().nullable(),
    /** change in total (variable) costs */
    costs: z.number().nullable(),
    orders: z.number().nullable(),
    averageOrderValue: z.number().nullable(),
    /** margin change in percentage points (2.5 = +2.5 pp); null when either margin is undefined */
    marginPoints: z.number().nullable(),
  }),
  /** one point per day, per 7 days or per calendar month; the points add up to the period */
  trendInterval: z.enum(['day', 'week', 'month']),
  trend: z.array(
    z.object({
      /** first day the point covers */
      date: z.string(),
      /** last day the point covers (same as date for a single day) */
      to: z.string(),
      revenue: money,
      /** revenue - contribution profit for the point */
      costs: money,
      contributionProfit: money,
      /** the part of `costs` that is estimated payment fees (a fee rule, not a reported fee) */
      estimatedFees: money,
      orders: z.number(),
    }),
  ),
  /**
   * Payment fees in this period: `actual` is what Shopify reported, `estimated` comes from the fee
   * rule. They add up to summary.paymentFees.
   */
  fees: z.object({
    actual: money,
    estimated: money,
    estimatedShare: z.string().nullable(),
  }),
  /** revenue by sales channel; adds up to summary.revenue exactly */
  channels: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      revenue: money,
      /** counted orders from the channel */
      orders: z.number(),
      share: z.string().nullable(),
    }),
  ),
  awaitingPayment: z.object({ count: z.number(), amount: money }),
  /** completeness of the inputs behind the figures, with explicit denominators */
  dataQuality: dataQualitySchema,
  /** every unresolved data problem once, most important first */
  issues: z.array(issueSchema),
  alerts: z.array(alertSchema),
  freshness: z.object({
    syncState: syncStateSchema,
    lastSuccessAt: z.string().nullable(),
    stale: z.boolean(),
    error: z.string().nullable(),
  }),
});
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 8: product and order profitability
// ---------------------------------------------------------------------------

const listPaging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const periodQuery = {
  preset: periodPresetSchema.default('30d'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};

export const productSortSchema = z.enum([
  'profit',
  'revenue',
  'margin',
  'units',
  'cogs',
  'refunds',
  'title',
]);
export const productListQuerySchema = z.object({
  ...periodQuery,
  ...listPaging,
  sort: productSortSchema.default('profit'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(100).optional(),
  /** only products with a cost problem, that lose money, or that are refunded a lot */
  filter: z.enum(['all', 'loss', 'missing_cost', 'estimated_cost', 'high_refunds']).default('all'),
  /** one row per product, or one per variant (the variants of a product add up to it) */
  view: z.enum(['products', 'variants']).default('products'),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const costQualitySchema = z.enum(['actual', 'estimated', 'missing', 'none']);

export const productRowSchema = z.object({
  /** product id, or "line:<title>" for custom items without a product */
  key: z.string(),
  /** the product's key: the same as `key` on a product row, the owning product on a variant row */
  productKey: z.string(),
  /** variant rows only: the variant title */
  variant: z.string().nullable(),
  /** a variant's SKU, or up to three SKUs of a product row */
  sku: z.string().nullable(),
  title: z.string(),
  units: z.number(),
  orders: z.number(),
  grossSales: money,
  discounts: money,
  refunds: money,
  netSales: money,
  cogs: money,
  profit: money,
  margin: ratio,
  /** weakest cost quality among this product's lines in the period */
  costQuality: costQualitySchema,
  missingCostLines: z.number(),
});
export type ProductRow = z.infer<typeof productRowSchema>;

const pagingOut = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

/** A row of the products table: the figures, and the profit per bucket of days for the small chart. */
export const productListRowSchema = productRowSchema.extend({
  /** profit per bucket of days (at most 30 points); numbers for drawing only */
  trend: z.array(z.number()),
});

/** Something the merchant can do to make the products table more complete or more useful. */
export const productInsightSchema = z.object({
  id: z.enum(['missing_cost', 'estimated_cost', 'loss_making', 'high_refunds', 'no_sku']),
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  /** what is wrong and how much it touches */
  detail: z.string(),
  /** how to fix it */
  fix: z.string(),
  count: z.number(),
  /** share of the period's net sales that this touches; null when it does not apply */
  share: z.string().nullable(),
  amount: money.nullable(),
  /** the biggest few products affected */
  examples: z.array(z.object({ key: z.string(), title: z.string() })),
  action: z.object({ label: z.string(), href: z.string() }).nullable(),
});
export type ProductInsight = z.infer<typeof productInsightSchema>;

export const productListResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  rows: z.array(productListRowSchema),
  /** what to fix, from all products of the period (not only this page) */
  insights: z.array(productInsightSchema),
  /** the headline figures of all products of the period (not only this page or the filter) */
  summary: z.object({
    products: z.number(),
    netSales: money,
    /** the products' own contribution profit; the Overview figure also holds shipping, fees and other unallocated items */
    contributionProfit: money,
    productsMissingCost: z.number(),
    productsLosingMoney: z.number(),
  }),
  paging: pagingOut,
  /** how the products add up to the dashboard figure */
  reconciliation: z.object({
    productProfit: money,
    unallocated: z.object({
      shippingRevenue: money,
      shippingRefund: money,
      paymentFees: money,
      shippingCost: money,
      unlinkedCost: money,
    }),
    total: money,
    dashboardContributionProfit: money,
    /** what the profit leaves out or only estimates (missing costs, no advertising set up) */
    qualifiers: z.array(z.string()),
    matches: z.boolean(),
  }),
  rule: z.string(),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const productDetailQuerySchema = z.object({ ...periodQuery, ...listPaging });
export const productLineSchema = z.object({
  sku: z.string().nullable(),
  orderShopifyId: z.string(),
  orderName: z.string(),
  orderDate: z.string(),
  variant: z.string().nullable(),
  quantity: z.number(),
  grossSales: money,
  discounts: money,
  refunds: money,
  cogs: money,
  profit: money,
  costStatus: costQualitySchema,
});
export const productDetailResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  product: productRowSchema,
  /** the same figures per variant; they add up to `product` */
  variants: z.array(productRowSchema),
  /** net sales and profit by order date over the period */
  trend: z.array(z.object({ date: z.string(), netSales: money, profit: money, units: z.number() })),
  /** every order line of this product that had a refund in the period, newest first (not paged) */
  refundHistory: z.array(
    z.object({
      orderShopifyId: z.string(),
      orderName: z.string(),
      orderDate: z.string(),
      variant: z.string().nullable(),
      sku: z.string().nullable(),
      quantity: z.number(),
      refunds: money,
    }),
  ),
  /** every cost the merchant entered for this product's variants, newest first; removed ones are marked */
  costHistory: z.array(
    z.object({
      variantTitle: z.string().nullable(),
      sku: z.string().nullable(),
      amount: money,
      currency: z.string(),
      effectiveFrom: z.string(),
      source: z.string(),
      reason: z.string().nullable(),
      createdAt: z.string(),
      revoked: z.boolean(),
    }),
  ),
  lines: z.array(productLineSchema),
  paging: pagingOut,
  rule: z.string(),
});
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;

export const orderListQuerySchema = z.object({
  ...periodQuery,
  ...listPaging,
  sort: z.enum(['date', 'name', 'revenue', 'cogs', 'profit', 'margin']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  filter: z
    .enum([
      'all',
      'loss',
      'missing_cost',
      'refunded',
      'excluded',
      'estimated_fees',
      'missing_fees',
      'incomplete_refunds',
      'missing_country',
      'missing_weight',
    ])
    .default('all'),
  search: z.string().trim().max(100).optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderRowSchema = z.object({
  orderShopifyId: z.string(),
  /** gross sales, discounts and product refunds of the order, all positive, and gross less both */
  grossSales: money,
  discounts: money,
  refunds: money,
  netSales: money,
  fulfillmentStatus: z.string().nullable(),
  name: z.string(),
  orderDate: z.string(),
  financialStatus: z.string(),
  recognized: z.boolean(),
  exclusionReason: z.string().nullable(),
  revenue: money,
  cogs: money,
  paymentFees: money,
  shippingCost: money,
  profit: money.nullable(),
  margin: ratio,
  partial: z.boolean(),
  /** weakest data status of each cost on the order; a missing cost is not a zero cost */
  statuses: z.object({
    cogs: z.enum(['confirmed', 'estimated', 'missing', 'not_applicable']),
    paymentFees: z.enum(['confirmed', 'estimated', 'missing', 'not_applicable']),
    shippingCost: z.enum(['confirmed', 'estimated', 'missing', 'not_applicable']),
  }),
  flags: z.array(z.string()),
});
export type OrderRow = z.infer<typeof orderRowSchema>;

export const orderListResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  rows: z.array(orderRowSchema),
  paging: pagingOut,
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const orderEntrySchema = z.object({
  component: z.string(),
  /** plain-language name of the component */
  label: z.string(),
  amount: money,
  status: z.string(),
  source: z.string(),
  occurredAt: z.string(),
  line: z.string().nullable(),
  refundId: z.string().nullable(),
  /** how the figure was worked out */
  explanation: z.string(),
  memo: z.boolean(),
});

export const orderDetailResponseSchema = z.object({
  order: z.object({
    orderShopifyId: z.string(),
    name: z.string(),
    financialStatus: z.string(),
    processedAt: z.string(),
    orderDate: z.string(),
    recognized: z.boolean(),
    exclusionReason: z.string().nullable(),
    partial: z.boolean(),
    flags: z.array(z.string()),
    engineVersion: z.string(),
    fulfillmentStatus: z.string().nullable(),
  }),
  currency: z.string(),
  /** what was charged for shipping, what shipping cost, and how well that cost is known */
  shipping: z.object({
    country: z.string().nullable(),
    charged: money,
    cost: money,
    costStatus: z.enum(['confirmed', 'estimated', 'missing', 'not_applicable']),
  }),
  /** the payments on the order and the fee the payment provider reported for each (null: none reported) */
  transactions: z.array(
    z.object({
      kind: z.string(),
      status: z.string(),
      gateway: z.string().nullable(),
      amount: money,
      currency: z.string(),
      fee: money.nullable(),
      processedAt: z.string(),
    }),
  ),
  summary: z.object({
    revenue: money,
    cogs: money,
    paymentFees: money,
    shippingCost: money,
    profit: money.nullable(),
    margin: ratio,
  }),
  entries: z.array(orderEntrySchema),
  /** per-product view of this order under the allocation rule */
  products: z.array(
    productLineSchema
      .omit({ orderShopifyId: true, orderName: true, orderDate: true })
      .extend({ title: z.string() }),
  ),
  unallocated: z.object({
    shippingRevenue: money,
    shippingRefund: money,
    paymentFees: money,
    shippingCost: money,
    unlinkedCost: money,
  }),
  rule: z.string(),
});
export type OrderDetailResponse = z.infer<typeof orderDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Settings: product costs, payment fee rules, shipping cost rules, alert limit
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`).getTime();
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, 'Not a real date');
const amountString = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, 'Enter a number such as 12.50');
const percentString = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Enter a number such as 2.9')
  .refine((v) => Number(v) <= 100, 'Must be 100 or less');

export const costListQuerySchema = z.object({
  ...listPaging,
  filter: z.enum(['all', 'missing', 'estimated', 'entered']).default('all'),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['attention', 'name']).default('attention'),
});
export type CostListQuery = z.infer<typeof costListQuerySchema>;

export const costRowSchema = z.object({
  variantShopifyId: z.string(),
  productTitle: z.string(),
  variantTitle: z.string().nullable(),
  sku: z.string().nullable(),
  price: money,
  shopifyCost: money.nullable(),
  merchantCost: z.object({ id: z.string(), amount: money, effectiveFrom: z.string() }).nullable(),
  unitsSold90d: z.number(),
  quality: z.enum(['actual', 'estimated', 'missing']),
});
export type CostRow = z.infer<typeof costRowSchema>;

export const costListResponseSchema = z.object({
  currency: z.string(),
  today: z.string(),
  rows: z.array(costRowSchema),
  paging: pagingOut,
  /** how many variants fall in each state (whole catalogue) */
  totals: z.object({ missing: z.number(), estimated: z.number(), entered: z.number() }),
});
export type CostListResponse = z.infer<typeof costListResponseSchema>;

export const productCostImportBodySchema = z.object({
  csv: z.string().trim().min(1).max(2_000_000),
  /** when true, count matched, skipped and invalid rows and do not save */
  preview: z.boolean().optional(),
});
export type ProductCostImportBody = z.infer<typeof productCostImportBodySchema>;

export const bulkCostBodySchema = z.object({
  amount: amountString,
  effectiveFrom: isoDate,
  /** vendor name, product id, collection title, or SKUs and variant ids separated by commas or new lines */
  by: z.enum(['vendor', 'product', 'collection', 'variants']),
  value: z.string().trim().min(1).max(8000),
});
export type BulkCostBody = z.infer<typeof bulkCostBodySchema>;

export const setCostBodySchema = z.object({
  amount: amountString,
  effectiveFrom: isoDate,
  reason: z.string().trim().max(200).optional(),
});
export type SetCostBody = z.infer<typeof setCostBodySchema>;

export const costHistoryResponseSchema = z.object({
  currency: z.string(),
  rows: z.array(
    z.object({
      id: z.string(),
      amount: money,
      effectiveFrom: z.string(),
      createdBy: z.string().nullable(),
      createdAt: z.string(),
      revokedAt: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});

export const feeRuleBodySchema = z.object({
  gateway: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9 _.-]+$/)
    .nullable(),
  percent: percentString,
  fixedAmount: amountString,
  effectiveFrom: isoDate,
});
export type FeeRuleBody = z.infer<typeof feeRuleBodySchema>;

const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code such as US');
const shippingMatchFields = {
  zone: z.string().trim().min(1).max(80).nullable().optional(),
  countries: z.array(countryCode).max(50).optional(),
  weightMinGrams: z.number().int().nonnegative().nullable().optional(),
  weightMaxGrams: z.number().int().positive().nullable().optional(),
};
const shippingPercent = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,4})?$/, 'Enter a number such as 80')
  .refine((v) => Number(v) <= 1000, 'Must be 1000 or less');

export const shippingRuleBodySchema = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('flat'),
      amount: amountString,
      effectiveFrom: isoDate,
      ...shippingMatchFields,
    }),
    z.object({
      mode: z.literal('per_kilogram'),
      amount: amountString,
      effectiveFrom: isoDate,
      ...shippingMatchFields,
    }),
    z.object({
      mode: z.literal('percent_of_shipping_charged'),
      percent: shippingPercent,
      effectiveFrom: isoDate,
      ...shippingMatchFields,
    }),
  ])
  .superRefine((body, ctx) => {
    const min = body.weightMinGrams ?? null;
    const max = body.weightMaxGrams ?? null;
    if (min != null && max != null && min >= max) {
      ctx.addIssue({
        code: 'custom',
        message: 'Minimum weight must be lower than the upper weight',
        path: ['weightMinGrams'],
      });
    }
  });
export type ShippingRuleBody = z.infer<typeof shippingRuleBodySchema>;

export const shippingRulesImportBodySchema = z.object({
  csv: z.string().trim().min(1).max(200_000),
  /** when true, count matched, skipped and invalid rows and do not replace the rules */
  preview: z.boolean().optional(),
});
export type ShippingRulesImportBody = z.infer<typeof shippingRulesImportBodySchema>;

export const thresholdBodySchema = z.object({
  missingCostWarningPct: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a number such as 10')
    .refine((v) => Number(v) <= 100, 'Must be 100 or less'),
});

export const recalcBodySchema = z.object({
  /** fill_gaps: price orders whose cost was missing and apply fee and shipping rules; everything: also redo costs used before */
  mode: z.enum(['fill_gaps', 'everything']),
});

const gatewayCoverageSchema = z.object({
  gateway: z.string().nullable(),
  payments: z.number(),
  reported: z.number(),
  covered: z.number(),
  uncovered: z.number(),
});

/** How the fee and shipping rules cover recent orders, optionally with a rule not yet saved. */
export const ruleCoverageResponseSchema = z.object({
  /** days of orders looked at */
  windowDays: z.number(),
  /** true when there were more recent orders than were looked at */
  sampled: z.boolean(),
  orders: z.number(),
  fees: z.object({
    payments: z.number(),
    reported: z.number(),
    covered: z.number(),
    uncovered: z.number(),
    byGateway: z.array(gatewayCoverageSchema),
    /** payments the previewed rule would be chosen for; null when no rule was previewed */
    candidateApplies: z.number().nullable(),
  }),
  shipping: z.object({
    orders: z.number(),
    covered: z.number(),
    uncovered: z.number(),
    missingCountry: z.number(),
    missingWeight: z.number(),
    candidateApplies: z.number().nullable(),
  }),
});
export type RuleCoverageResponse = z.infer<typeof ruleCoverageResponseSchema>;

export const recalcResultResponseSchema = z.object({
  result: z
    .object({
      finishedAt: z.string(),
      mode: z.enum(['fill_gaps', 'everything']),
      /** currency of the profit amounts: the shop currency */
      currency: z.string(),
      orders: z.number(),
      recognized: z.number(),
      /** orders whose counted status, profit or completeness differs from before */
      changed: z.number(),
      /** orders that had something missing and are now complete */
      nowComplete: z.number(),
      /** counted orders that still have something missing */
      stillIncomplete: z.number(),
      profitBefore: z.string(),
      profitAfter: z.string(),
    })
    .nullable(),
});
export type RecalcResultResponse = z.infer<typeof recalcResultResponseSchema>;

export const rulesResponseSchema = z.object({
  currency: z.string(),
  today: z.string(),
  feeRules: z.array(
    z.object({
      id: z.string(),
      gateway: z.string().nullable(),
      percent: z.string(),
      fixedAmount: money,
      effectiveFrom: z.string(),
    }),
  ),
  shippingRules: z.array(
    z.object({
      id: z.string(),
      mode: z.enum(['flat', 'percent_of_shipping_charged', 'per_kilogram']),
      amount: money.nullable(),
      percent: z.string().nullable(),
      effectiveFrom: z.string(),
      zone: z.string().nullable(),
      countries: z.array(z.string()),
      weightMinGrams: z.number().nullable(),
      weightMaxGrams: z.number().nullable(),
    }),
  ),
  gateways: z.array(z.string()),
  missingCostWarningPct: z.string(),
  /** every alert limit, for the Alerts tab */
  limits: z.object({
    missingCostPct: z.string(),
    marginPct: z.string(),
    refundRatePct: z.string(),
    costChangePct: z.string(),
  }),
  /** where alert emails go; empty means alert emails are off */
  alertEmails: z.array(z.string()),
});
export type RulesResponse = z.infer<typeof rulesResponseSchema>;

export const auditResponseSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      actor: z.string(),
      action: z.string(),
      /** plain-language description of the change */
      summary: z.string(),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AuditResponse = z.infer<typeof auditResponseSchema>;

/** Read-only currency and time facts for Settings. Shopify owns the currency and time zone. */
export const currencySettingsResponseSchema = z.object({
  /** the one reporting currency: always USD */
  currency: z.string(),
  /** the currency Shopify says the store sells in */
  storeCurrency: z.string(),
  /** true when the store currency is not USD, so its amounts are converted to USD */
  converted: z.boolean(),
  timezone: z.string(),
  /** minor-unit decimal places of `currency` (ISO 4217: 0, 2, or 3) */
  decimals: z.number().int().min(0).max(3),
  rounding: z.literal('half-up'),
  rateSource: z.literal('ECB'),
  /** newest stored ECB rate date, or null when none are stored */
  latestRateDate: z.string().nullable(),
  /** missing: no rates; estimated: latest rate is more than 7 days old; current: within 7 days */
  rateStatus: z.enum(['missing', 'estimated', 'current']),
  /** plain sentences of the conversion rule the profit engine already uses */
  explanation: z.array(z.string()),
});
export type CurrencySettingsResponse = z.infer<typeof currencySettingsResponseSchema>;

export type CostHistoryResponse = z.infer<typeof costHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 9: expenses and advertising
// ---------------------------------------------------------------------------

const uuidString = z.string().regex(/^[0-9a-f-]{36}$/i);
const monthStartString = isoDate.refine((d) => d.endsWith('-01'), 'Use the first day of a month');
const nameString = z.string().trim().min(1).max(120);

/**
 * What a category's costs are: product (purchases, already in profit through product costs),
 * logistics (shipping and handling, partly in order-level shipping costs), advertising, or operating.
 */
export const expenseClassSchema = z.enum(['product', 'logistics', 'advertising', 'operating']);
export type ExpenseClassName = z.infer<typeof expenseClassSchema>;

export const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  class: expenseClassSchema,
  expenseCount: z.number(),
});
export const categoryListResponseSchema = z.object({ categories: z.array(categoryRowSchema) });
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;
export const categoryBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** defaults from the name (marketing is advertising, shipping is logistics, and so on) */
  class: expenseClassSchema.optional(),
});
export const categoryClassBodySchema = z.object({ class: expenseClassSchema });

export const expenseListQuerySchema = z.object({
  filter: z.enum(['all', 'recurring', 'one_time']).default('all'),
  /** matches the name, category, reference or description */
  search: z.string().trim().max(100).optional(),
  categoryId: uuidString.optional(),
  status: z.enum(['all', 'active', 'scheduled', 'ended']).default('all'),
  /** only expenses that apply at some point between these two days (either may be left out) */
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const expenseImportBodySchema = z.object({
  csv: z.string().trim().min(1).max(2_000_000),
  /** when true, count matched, skipped and invalid rows and do not save */
  preview: z.boolean().optional(),
});
export type ExpenseImportBody = z.infer<typeof expenseImportBodySchema>;

export const createExpenseBodySchema = z
  .object({
    name: nameString,
    categoryId: uuidString,
    amount: amountString,
    kind: z.enum(['one_time', 'recurring']),
    frequency: z.enum(['monthly', 'yearly']).optional(),
    startDate: isoDate,
    endDate: isoDate.optional(),
    /** a fresh value per form, so a retried request does not add the expense twice */
    requestKey: z.string().min(8).max(80).optional(),
    /** an invoice or receipt number of the merchant's own */
    reference: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    /** the currency `amount` is in; the shop currency when left out. It is converted once, at the rate of the expense date. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code such as EUR')
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'recurring' && !v.frequency) {
      ctx.addIssue({ code: 'custom', path: ['frequency'], message: 'Choose how often it repeats' });
    }
    if (v.kind === 'one_time' && (v.frequency || v.endDate)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'A one-time expense does not repeat',
      });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'The end date is before the start',
      });
    }
  });
export type CreateExpenseBody = z.infer<typeof createExpenseBodySchema>;

export const changeExpenseBodySchema = z
  .object({
    name: nameString.optional(),
    categoryId: uuidString.optional(),
    amount: amountString.optional(),
    /** an empty text clears it */
    reference: z.string().trim().max(60).optional(),
    description: z.string().trim().max(500).optional(),
    /** recurring only: the new last day; null lets it run until it is stopped */
    endDate: isoDate.nullable().optional(),
    /** one-time: the new date; recurring: first day of the first month the change applies to */
    effectiveFrom: isoDate,
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.categoryId !== undefined ||
      v.amount !== undefined ||
      v.reference !== undefined ||
      v.description !== undefined ||
      v.endDate !== undefined,
    { message: 'Change at least one thing' },
  );

export const stopExpenseBodySchema = z.object({ lastDay: isoDate });

export const monthOverrideBodySchema = z.union([
  z.object({ amount: amountString }),
  z.object({ skip: z.literal(true) }),
]);
export const monthParamSchema = monthStartString;

export const expenseRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  category: z.string(),
  kind: z.enum(['one_time', 'recurring']),
  frequency: z.enum(['monthly', 'yearly']).nullable(),
  amount: money,
  startDate: z.string(),
  endDate: z.string().nullable(),
  nextCharge: z.string().nullable(),
  /** what this expense adds to the current calendar month */
  thisMonth: money,
  status: z.enum(['active', 'scheduled', 'ended']),
  /** the currency of `amount`: always the shop currency */
  currency: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  categoryClass: expenseClassSchema,
  /** when it was typed in another currency: that amount and currency, and whether the rate was only an estimate */
  originalAmount: money.nullable(),
  originalCurrency: z.string().nullable(),
  fxRate: z.string().nullable(),
  fxRateDate: z.string().nullable(),
  fxEstimated: z.boolean(),
  overrides: z.array(
    z.object({ month: z.string(), amount: money.nullable(), skipped: z.boolean() }),
  ),
});
export type ExpenseRow = z.infer<typeof expenseRowSchema>;

export const expenseListResponseSchema = z.object({
  currency: z.string(),
  today: z.string(),
  rows: z.array(expenseRowSchema),
});
export type ExpenseListResponse = z.infer<typeof expenseListResponseSchema>;

export const expenseSummaryResponseSchema = z.object({
  currency: z.string(),
  today: z.string(),
  thisMonth: money,
  recurringPerMonth: money,
  recurringCount: z.number(),
  oneTimeThisMonth: money,
  /** this month's expenses by what kind of cost they are; the amounts add up to `thisMonth` */
  thisMonthByClass: z.array(z.object({ class: expenseClassSchema, amount: money })),
  /** expenses over revenue for the last 30 days, null when there is no revenue */
  shareOfRevenue: ratio,
  months: z.array(
    z.object({
      month: z.string(),
      total: money,
      /** the part of the total from recurring expenses */
      recurring: money,
      /** the part of the total from one-time expenses */
      oneTime: money,
      /** the total over that month's revenue, null when the month had no revenue */
      shareOfRevenue: ratio,
      byCategory: z.array(z.object({ category: z.string(), amount: money })),
      /** the month's profit and loss, from the same calculation as the Overview */
      revenue: money,
      /** revenue less product cost, fees and shipping; advertising is not taken off */
      contributionProfit: money,
      /** advertising spend in the month, null when no advertising account exists */
      advertising: money.nullable(),
      /** contribution profit less advertising and this month's expenses; null when no expenses are set up */
      operatingProfit: money.nullable(),
      /** true when the month has a missing product cost, fee or shipping cost */
      incomplete: z.boolean(),
    }),
  ),
  /**
   * Whether operating profit can be trusted: "not_configured" when no expenses exist (operating
   * profit is not calculated anywhere), "incomplete" when a month in the list has missing costs
   * (operating profit is an estimate), otherwise "complete".
   */
  operatingProfitStatus: z.enum(['not_configured', 'incomplete', 'complete']),
});
export type ExpenseSummaryResponse = z.infer<typeof expenseSummaryResponseSchema>;

export const expenseHistoryResponseSchema = auditResponseSchema;

// ---- advertising ----

export const adProviderSchema = z.enum(['manual', 'meta', 'google', 'tiktok']);
export const adProvidersResponseSchema = z.object({
  providers: z.array(
    z.object({
      id: adProviderSchema,
      name: z.string(),
      available: z.boolean(),
      note: z.string(),
      /** how the merchant connects it: by signing in to the platform, or typing spend by hand */
      connectVia: z.enum(['oauth', 'manual']),
      /** false when the server owner has not added this platform's app credentials yet */
      configured: z.boolean(),
    }),
  ),
});
export type AdProvidersResponse = z.infer<typeof adProvidersResponseSchema>;

export const adSpendRangeQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  /** the campaign; empty for spend entered without one */
  campaign: z.string().max(200).default(''),
});

export const renameAdAccountBodySchema = z.object({ name: z.string().trim().min(1).max(80) });

export const createAdAccountBodySchema = z.object({
  provider: adProviderSchema.default('manual'),
  name: z.string().trim().min(1).max(80),
  /** Meta ad account id or Google Ads customer id */
  externalId: z.string().trim().min(1).max(40).optional(),
  /** platform access token; stored encrypted and never returned */
  accessToken: z.string().trim().min(8).max(2000).optional(),
});

/** The address to send the merchant to so they can sign in to the platform. */
export const adConnectStartResponseSchema = z.object({ url: z.string().url() });
export type AdConnectStartResponse = z.infer<typeof adConnectStartResponseSchema>;

/** Platforms the merchant signed in to and has not yet finished: the ad accounts they can choose from. */
export const pendingAdConnectionsResponseSchema = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      provider: z.enum(['meta', 'google', 'tiktok']),
      expiresAt: z.string(),
      accounts: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string() })),
    }),
  ),
});
export type PendingAdConnectionsResponse = z.infer<typeof pendingAdConnectionsResponseSchema>;

export const connectAdAccountsBodySchema = z.object({
  accountIds: z
    .array(z.string().trim().min(1).max(40))
    .min(1, 'Choose at least one account')
    .max(20, 'Choose at most 20 accounts')
    .transform((l) => [...new Set(l)]),
});

export const adSpendRowSchema = z.object({
  date: isoDate,
  campaign: z.string().trim().max(120).default(''),
  spend: amountString,
  reportedSales: amountString.optional(),
  clicks: z.number().int().min(0).max(1_000_000_000).optional(),
  impressions: z.number().int().min(0).max(2_000_000_000).optional(),
});
export const adSpendBodySchema = z.object({ rows: z.array(adSpendRowSchema).min(1).max(400) });
export type AdSpendBody = z.infer<typeof adSpendBodySchema>;

export const marketingQuerySchema = z.object({ ...periodQuery });

export const marketingResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  accounts: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      name: z.string(),
      currency: z.string(),
      status: z.string(),
      connectedVia: z.enum(['manual', 'token', 'oauth']),
      lastSyncAt: z.string().nullable(),
      lastError: z.string().nullable(),
    }),
  ),
  totals: z.object({
    spend: money,
    /** what the platforms say they drove; not Shopify sales */
    platformReportedSales: money,
    /** Shopify revenue in the period, all sources */
    shopifyRevenue: money,
    /** revenue divided by ad spend, null when there is no spend */
    blendedReturn: ratio,
    /** contribution profit, divided by ad spend */
    poas: ratio,
    contributionProfit: money,
    profitAfterAds: money,
    hasData: z.boolean(),
    /** an advertising account exists (so "no spend" means no data, not "not set up") */
    hasAccounts: z.boolean(),
    qualifiers: z.array(z.string()),
  }),
  channels: z.array(
    z.object({
      accountId: z.string(),
      provider: z.string(),
      name: z.string(),
      spend: money,
      platformReportedSales: money,
      platformReturn: ratio,
      clicks: z.number(),
      impressions: z.number(),
    }),
  ),
  campaigns: z.array(
    z.object({
      accountId: z.string(),
      account: z.string(),
      campaign: z.string(),
      spend: money,
      platformReportedSales: money,
      platformReturn: ratio,
    }),
  ),
  daily: z.array(z.object({ date: z.string(), spend: money })),
  note: z.string(),
});
export type MarketingResponse = z.infer<typeof marketingResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 10: reports, exports, notifications
// ---------------------------------------------------------------------------

export const reportKindSchema = z.enum([
  'profit_loss',
  'products',
  'orders',
  'marketing',
  'expenses',
  'refunds',
  'missing_costs',
]);
export type ReportKindName = z.infer<typeof reportKindSchema>;
export const reportFormatSchema = z.enum(['csv', 'pdf']);

export const reportPreviewQuerySchema = z.object({
  kind: reportKindSchema,
  ...periodQuery,
  /** refunds and missing costs only: matches order, product, SKU or variant */
  search: z.string().trim().max(100).optional(),
  /** missing costs only: show products with no cost, or only those on Shopify's estimate */
  filter: z.enum(['all', 'missing', 'estimated']).default('all'),
  /** refunds and missing costs only; the default is newest refund first, largest sales first */
  sort: z.enum(['default', 'name', 'amount']).default('default'),
});

export const reportTableSchema = z.object({
  kind: reportKindSchema,
  title: z.string(),
  subtitle: z.string(),
  currency: z.string(),
  from: z.string(),
  to: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['text', 'money', 'percent', 'integer']),
    }),
  ),
  rows: z.array(z.array(z.string())),
  totalRows: z.array(z.array(z.string())),
  notes: z.array(z.string()),
  audit: z
    .object({ generatedAt: z.string(), timezone: z.string(), dataNotes: z.array(z.string()) })
    .optional(),
  /** true when the rows were cut for the screen; the download has them all */
  truncated: z.boolean(),
});
export type ReportTableResponse = z.infer<typeof reportTableSchema>;

export const createExportBodySchema = z.object({
  kind: reportKindSchema,
  format: reportFormatSchema,
  ...periodQuery,
});

export const exportRowSchema = z.object({
  id: z.string(),
  kind: reportKindSchema,
  format: reportFormatSchema,
  periodFrom: z.string(),
  periodTo: z.string(),
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  error: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  attempts: z.number(),
  scheduled: z.boolean(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type ExportRowResponse = z.infer<typeof exportRowSchema>;
export const exportListResponseSchema = z.object({ rows: z.array(exportRowSchema) });

const recipientSchema = z.string().trim().toLowerCase().email().max(200);

export const createScheduleBodySchema = z
  .object({
    kind: reportKindSchema,
    format: reportFormatSchema,
    frequency: z.enum(['weekly', 'monthly']),
    weekday: z.number().int().min(0).max(6).optional(),
    hour: z.number().int().min(0).max(23),
    recipients: z.array(recipientSchema).min(1).max(5),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === 'weekly' && v.weekday === undefined) {
      ctx.addIssue({ code: 'custom', path: ['weekday'], message: 'Choose a day of the week' });
    }
    if (v.frequency === 'monthly' && v.weekday !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekday'],
        message: 'A monthly schedule has no weekday',
      });
    }
    if (new Set(v.recipients).size !== v.recipients.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'A recipient is listed twice',
      });
    }
  });
export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;

export const updateScheduleBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    recipients: z.array(recipientSchema).min(1).max(5).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.recipients !== undefined, 'Change at least one thing')
  .refine(
    (v) => !v.recipients || new Set(v.recipients).size === v.recipients.length,
    'A recipient is listed twice',
  );

export const scheduleRowSchema = z.object({
  id: z.string(),
  kind: reportKindSchema,
  format: reportFormatSchema,
  frequency: z.enum(['weekly', 'monthly']),
  weekday: z.number().nullable(),
  hour: z.number(),
  recipients: z.array(z.string()),
  enabled: z.boolean(),
  lastPeriodEnd: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  /** plain-language description, for example "Every Monday at 08:00" */
  description: z.string(),
  timezone: z.string(),
});
export type ScheduleRowResponse = z.infer<typeof scheduleRowSchema>;
export const scheduleListResponseSchema = z.object({
  rows: z.array(scheduleRowSchema),
  /** whether this server can send email; when false deliveries fail visibly and can be retried */
  emailConfigured: z.boolean(),
});

export const deliveryRowSchema = z.object({
  id: z.string(),
  exportId: z.string(),
  recipient: z.string(),
  kind: reportKindSchema,
  periodFrom: z.string(),
  periodTo: z.string(),
  status: z.enum(['queued', 'sent', 'failed']),
  error: z.string().nullable(),
  attempts: z.number(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export const deliveryListResponseSchema = z.object({ rows: z.array(deliveryRowSchema) });

export const notificationRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.enum(['info', 'success', 'warning', 'critical']),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  createdAt: z.string(),
  read: z.boolean(),
});
export const notificationListResponseSchema = z.object({
  unread: z.number(),
  rows: z.array(notificationRowSchema),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 11: profit leakage and data quality
// ---------------------------------------------------------------------------

export const findingRuleSchema = z.enum([
  'loss_orders',
  'possible_loss',
  'negative_margin_products',
  'low_margin_products',
  'low_margin',
  'margin_drop',
  'refund_rate',
  'shipping_subsidy',
  'cost_change',
  'missing_costs',
  'missing_fees',
  'missing_shipping_cost',
]);

export const findingSchema = z.object({
  id: findingRuleSchema,
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  evidence: z.string(),
  why: z.string(),
  action: z.object({ label: z.string(), href: z.string() }).nullable(),
  /** money involved, negative for a loss; present only when the figure is defensible */
  impact: z.object({ amount: money, note: z.string() }).nullable(),
  items: z.array(z.object({ label: z.string(), detail: z.string() })),
  disclosure: z.string().nullable(),
});
export type FindingResponse = z.infer<typeof findingSchema>;

export const limitsSchema = z.object({
  missingCostPct: z.string(),
  marginPct: z.string(),
  refundRatePct: z.string(),
  costChangePct: z.string(),
});

export const leakageQuerySchema = z.object({ ...periodQuery });

export const leakageResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  findings: z.array(findingSchema),
  limits: limitsSchema,
  /** how much there was to judge, so "no findings" is not mistaken for "no data" */
  checked: z.object({ orders: z.number(), products: z.number() }),
});
export type LeakageResponse = z.infer<typeof leakageResponseSchema>;

const limitPercent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a number such as 20')
  .refine((v) => Number(v) <= 100, 'Must be 100 or less');
/** Up to 5 distinct addresses; an empty list turns alert emails off. */
export const alertEmailsBodySchema = z.object({
  recipients: z
    .array(recipientSchema)
    .max(5, 'At most 5 addresses')
    .transform((list) => [...new Set(list)]),
});
export type AlertEmailsBody = z.infer<typeof alertEmailsBodySchema>;

/** What a new expense starts as. Existing expenses are never changed by it. */
export const expenseDefaultsSchema = z.object({
  kind: z.enum(['recurring', 'one_time']),
  frequency: z.enum(['monthly', 'yearly']),
});
export type ExpenseDefaults = z.infer<typeof expenseDefaultsSchema>;

export const limitsBodySchema = z.object({
  marginPct: limitPercent,
  refundRatePct: limitPercent,
  costChangePct: z
    .string()
    .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Enter a number such as 10')
    .refine((v) => Number(v) <= 1000, 'Must be 1000 or less'),
});
export * from './plans.js';

// ---------------------------------------------------------------------------
// Phase 12: billing, onboarding and support
// ---------------------------------------------------------------------------

export const entitlementsSchema = z.object({
  historyDays: z.number(),
  exportsPerMonth: z.number(),
  pdfExports: z.boolean(),
  scheduledReports: z.number(),
  adAccounts: z.number(),
  leakageFindings: z.boolean(),
  ordersPerMonth: z.number(),
});

export const billingStatusSchema = z.object({
  mode: z.enum(['off', 'managed', 'api']),
  plan: z.enum(['free', 'growth', 'pro']),
  entitlements: entitlementsSchema,
  usage: z.object({
    exportsThisMonth: z.number(),
    activeSchedules: z.number(),
    adAccounts: z.number(),
    /** orders placed this month */
    ordersThisMonth: z.number(),
    /** orders beyond the plan's included orders this month */
    extraOrders: z.number(),
    /** extraOrders x the price per extra order, as dollars with two decimals; an estimate until paid plans open */
    extraChargeUsd: z.string(),
  }),
  /** the price of each order beyond the plan's included orders, in USD */
  extraOrderUsd: z.string(),
  subscription: z
    .object({
      status: z.enum(['none', 'pending', 'active', 'frozen', 'cancelled', 'declined', 'expired']),
      planName: z.string().nullable(),
      isTest: z.boolean(),
      currentPeriodEnd: z.string().nullable(),
    })
    .nullable(),
  maxHistoryDays: z.number(),
  plans: z.array(
    z.object({
      id: z.enum(['free', 'growth', 'pro']),
      name: z.string(),
      priceUsd: z.number(),
      /** false while the price and limits are a proposal */
      approved: z.boolean(),
      summary: z.string(),
      entitlements: entitlementsSchema,
      current: z.boolean(),
      /** whether the merchant can pick this plan right now */
      available: z.boolean(),
    }),
  ),
  note: z.string().nullable(),
});
export type BillingStatusResponse = z.infer<typeof billingStatusSchema>;

export const subscribeBodySchema = z.object({ plan: z.enum(['free', 'growth', 'pro']) });

export const supportBodySchema = z.object({
  kind: z.enum(['feedback', 'question', 'problem']),
  message: z.string().trim().min(3).max(2000),
  contactEmail: z.string().trim().toLowerCase().email().max(200).optional(),
});
export type SupportBody = z.infer<typeof supportBodySchema>;

export const supportListResponseSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['feedback', 'question', 'problem']),
      message: z.string(),
      contactEmail: z.string().nullable(),
      status: z.enum(['new', 'seen', 'answered', 'closed']),
      createdAt: z.string(),
    }),
  ),
});
export type SupportListResponse = z.infer<typeof supportListResponseSchema>;

// ---- carrier invoices ----

export const carrierIdSchema = z.enum(['dhl', 'ups', 'fedex', 'amazon', 'other']);
export type CarrierId = z.infer<typeof carrierIdSchema>;

export const carrierInvoiceImportBodySchema = z.object({
  carrier: carrierIdSchema,
  csv: z.string().trim().min(1).max(5_000_000),
  fileName: z.string().trim().max(200).optional(),
  /** when true, count what would be matched and do not save */
  preview: z.boolean().optional(),
  /** the column of the file to use for each field; left out, the columns are found from their names */
  mapping: z
    .object({
      order: z.string().max(200).optional(),
      amount: z.string().max(200).optional(),
      date: z.string().max(200).optional(),
    })
    .optional(),
});
export type CarrierInvoiceImportBody = z.infer<typeof carrierInvoiceImportBodySchema>;

export const carrierInvoiceResultSchema = z.object({
  preview: z.boolean(),
  /** the invoice that was saved; none for a preview */
  invoiceId: z.string().nullable(),
  /** the same file is already imported and still stands */
  alreadyImported: z.boolean(),
  /** orders that get the carrier's cost */
  matchedOrders: z.number(),
  /** rows whose order number is not an order of this shop, or that have none */
  unmatchedRows: z.number(),
  /** rows with a problem (an amount that is not a number, another currency) */
  invalid: z.number(),
  rows: z.number(),
  /** what the matched rows add up to, in US dollars */
  totalAmount: money,
  /** problems, then a few unmatched order numbers, for the merchant to read */
  messages: z.array(z.string()),
  columns: z.object({
    headers: z.array(z.string()),
    order: z.string().nullable(),
    amount: z.string().nullable(),
    date: z.string().nullable(),
  }),
});
export type CarrierInvoiceResult = z.infer<typeof carrierInvoiceResultSchema>;

export const carrierInvoiceListResponseSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      carrier: carrierIdSchema,
      fileName: z.string().nullable(),
      rowCount: z.number(),
      matchedOrders: z.number(),
      unmatchedRows: z.number(),
      totalAmount: money,
      createdAt: z.string(),
      revoked: z.boolean(),
    }),
  ),
  /** orders whose shipping cost now comes from a carrier invoice */
  coveredOrders: z.number(),
});
export type CarrierInvoiceListResponse = z.infer<typeof carrierInvoiceListResponseSchema>;

// ---- shipping overview ----

export const shippingQuerySchema = z.object({ ...periodQuery });

export const shippingOverviewResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  totals: z.object({
    /** what shipping cost in the period: from invoices and from rules */
    cost: money,
    costActual: money,
    costEstimated: money,
    /** shipping charged to customers, less shipping refunded */
    charged: money,
    /** charged less cost */
    margin: money,
    /** counted orders with a shipping cost (actual or estimated) */
    orders: z.number(),
    ordersActual: z.number(),
    ordersEstimated: z.number(),
    /** counted orders that ship but have no shipping cost yet */
    ordersMissing: z.number(),
    costPerOrder: money.nullable(),
    /** the share of the orders with a cost whose cost is from a carrier invoice */
    invoiceShare: ratio,
  }),
  daily: z.array(z.object({ date: z.string(), cost: money })),
  /** a carrier (from invoices) or "rules" (the estimate), with what it cost */
  carriers: z.array(z.object({ key: z.string(), cost: money, orders: z.number() })),
  shipments: z.array(
    z.object({
      orderName: z.string(),
      orderDate: z.string(),
      kind: z.enum(['invoice', 'rules', 'missing']),
      carrier: z.string().nullable(),
      cost: money,
      charged: money,
    }),
  ),
});
export type ShippingOverviewResponse = z.infer<typeof shippingOverviewResponseSchema>;

// ---- Customers: lifetime value ----

export const ltvQuerySchema = z.object({
  ...periodQuery,
  /** the country of the customer's first order (two-letter code) */
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .optional(),
  /** where the customer's first order came from (Shopify's source name, e.g. web) */
  source: z.string().trim().min(1).max(100).optional(),
});

export const ltvCohortSchema = z.object({
  /** YYYY-MM of the customers' first order */
  month: z.string(),
  customers: z.number().int(),
  repurchaseRate: z.string().nullable(),
  revenue: money,
  /** revenue per customer to date */
  ltv: money.nullable(),
  /** contribution profit per customer to date */
  profitLtv: money.nullable(),
  adSpend: money.nullable(),
  /** ad spend of that month per new customer */
  cac: money.nullable(),
  /** ltv divided by cac, 2 decimals */
  ratio: z.string().nullable(),
  /** cumulative per customer, month 1 first; stops at the current month */
  cumulative: z.array(z.object({ ltv: money, profitLtv: money })),
});

export const ltvResponseSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  currency: z.string(),
  kpis: z.object({
    customers: z.number().int(),
    repurchaseRate: z.string().nullable(),
    revenue: money,
    ltv: money.nullable(),
    profitLtv: money.nullable(),
    cac: money.nullable(),
    ratio: z.string().nullable(),
  }),
  cohorts: z.array(ltvCohortSchema),
  countries: z.array(z.string()),
  sources: z.array(z.string()),
  orders: z.object({ withCustomer: z.number().int(), withoutCustomer: z.number().int() }),
  /** no order has a customer key yet: orders must be imported again with the customer permission */
  customerDataMissing: z.boolean(),
  /** ad spend in a month with no exchange rate was left out of CAC */
  adFxGap: z.boolean(),
  historyDays: z.number().int(),
});
export type LtvResponse = z.infer<typeof ltvResponseSchema>;
export type LtvCohort = z.infer<typeof ltvCohortSchema>;
