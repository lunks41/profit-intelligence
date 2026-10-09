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
  contributionBeforeAds: money,
  contributionProfit: money,
  /** revenue - contribution profit: product cost, fees, shipping and advertising (when set up) */
  totalCosts: money,
  operatingExpenses: money.nullable(),
  estimatedNetProfit: money.nullable(),
  netProfitBasis: z.enum(['full', 'contribution_only']),
  contributionMargin: ratio,
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
    estimatedNetProfit: figureStatusSchema,
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
  /** display currency; defaults to the shop currency */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  /** how the chart groups days; "auto" is daily up to 90 days and weekly beyond */
  interval: z.enum(['auto', 'day', 'week', 'month']).default('auto'),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const overviewResponseSchema = z.object({
  period: periodSchema,
  previousPeriod: z.object({ from: z.string(), to: z.string() }),
  currency: z.object({
    /** currency of the amounts in this response */
    code: z.string(),
    shopCode: z.string(),
    available: z.array(z.string()),
    converted: z.boolean(),
    /** why the display currency fell back to the shop currency, or how it was converted */
    note: z.string().nullable(),
  }),
  summary: profitSummarySchema,
  previous: profitSummarySchema,
  /** relative change vs the previous period (0.1 = +10%); null when the previous value is zero */
  deltas: z.object({
    revenue: z.number().nullable(),
    contributionProfit: z.number().nullable(),
    /** change in total costs; on the same basis as contributionProfit */
    costs: z.number().nullable(),
    orders: z.number().nullable(),
    averageOrderValue: z.number().nullable(),
    /** margin change in percentage points (2.5 = +2.5 pp); null when either margin is undefined */
    marginPoints: z.number().nullable(),
    /**
     * What the profit and margin changes compare. "before_advertising" when advertising data
     * exists in only one of the two periods, so the change is not distorted by it.
     */
    basis: z.enum(['contribution', 'before_advertising']),
    basisNote: z.string().nullable(),
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
      orders: z.number(),
    }),
  ),
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

export const productSortSchema = z.enum(['profit', 'revenue', 'margin', 'units', 'cogs', 'title']);
export const productListQuerySchema = z.object({
  ...periodQuery,
  ...listPaging,
  sort: productSortSchema.default('profit'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(100).optional(),
  /** only products whose cost is missing / estimated, or that lose money */
  filter: z.enum(['all', 'loss', 'missing_cost']).default('all'),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const costQualitySchema = z.enum(['actual', 'estimated', 'missing', 'none']);

export const productRowSchema = z.object({
  /** product id, or "line:<title>" for custom items without a product */
  key: z.string(),
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

export const productListResponseSchema = z.object({
  period: periodSchema,
  currency: z.string(),
  rows: z.array(productRowSchema),
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
      /** advertising spend of the period, which the Overview subtracts from contribution profit */
      advertising: money,
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
  filter: z.enum(['all', 'loss', 'missing_cost', 'refunded', 'excluded']).default('all'),
  search: z.string().trim().max(100).optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderRowSchema = z.object({
  orderShopifyId: z.string(),
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
  }),
  currency: z.string(),
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
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, 'Not a real date');
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

export const shippingRuleBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('flat'), amount: amountString, effectiveFrom: isoDate }),
  z.object({
    mode: z.literal('percent_of_shipping_charged'),
    percent: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,4})?$/, 'Enter a number such as 80')
      .refine((v) => Number(v) <= 1000, 'Must be 1000 or less'),
    effectiveFrom: isoDate,
  }),
]);
export type ShippingRuleBody = z.infer<typeof shippingRuleBodySchema>;

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
      mode: z.enum(['flat', 'percent_of_shipping_charged']),
      amount: money.nullable(),
      percent: z.string().nullable(),
      effectiveFrom: z.string(),
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

export type CostHistoryResponse = z.infer<typeof costHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 9: expenses and advertising
// ---------------------------------------------------------------------------

const uuidString = z.string().regex(/^[0-9a-f-]{36}$/i);
const monthStartString = isoDate.refine((d) => d.endsWith('-01'), 'Use the first day of a month');
const nameString = z.string().trim().min(1).max(120);

export const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  expenseCount: z.number(),
});
export const categoryListResponseSchema = z.object({ categories: z.array(categoryRowSchema) });
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;
export const categoryBodySchema = z.object({ name: z.string().trim().min(1).max(60) });

export const expenseListQuerySchema = z.object({
  filter: z.enum(['all', 'recurring', 'one_time']).default('all'),
  search: z.string().trim().max(100).optional(),
});

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
    /** one-time: the new date; recurring: first day of the first month the change applies to */
    effectiveFrom: isoDate,
  })
  .refine((v) => v.name !== undefined || v.categoryId !== undefined || v.amount !== undefined, {
    message: 'Change at least one thing',
  });

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
    }),
  ),
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
    }),
  ),
});
export type AdProvidersResponse = z.infer<typeof adProvidersResponseSchema>;

export const createAdAccountBodySchema = z.object({
  provider: adProviderSchema.default('manual'),
  name: z.string().trim().min(1).max(80),
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
]);
export type ReportKindName = z.infer<typeof reportKindSchema>;
export const reportFormatSchema = z.enum(['csv', 'pdf']);

export const reportPreviewQuerySchema = z.object({
  kind: reportKindSchema,
  ...periodQuery,
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
});

export const billingStatusSchema = z.object({
  mode: z.enum(['off', 'managed', 'api']),
  plan: z.enum(['free', 'growth', 'pro']),
  entitlements: entitlementsSchema,
  usage: z.object({
    exportsThisMonth: z.number(),
    activeSchedules: z.number(),
    adAccounts: z.number(),
  }),
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
