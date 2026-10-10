import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Naming: lowercase snake_case, category prefix (m_ master, s_ settings). See prompt section 32.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Merchant account. The tenant is the isolation boundary. */
export const mTenant = pgTable(
  'm_tenant',
  {
    id: uuid('id').notNull().defaultRandom(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_m_tenant', columns: [t.id] }),
    check('ck_m_tenant_status', sql`${t.status} in ('active', 'suspended', 'deleted')`),
  ],
);

/** One Shopify store installation. A tenant may own several shops in the future. */
export const mShop = pgTable(
  'm_shop',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopifyDomain: text('shopify_domain').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    ianaTimezone: text('iana_timezone').notNull(),
    status: text('status').notNull().default('active'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_m_shop', columns: [t.id] }),
    foreignKey({
      name: 'fk_m_shop_tenant',
      columns: [t.tenantId],
      foreignColumns: [mTenant.id],
    }),
    unique('uq_m_shop_shopify_domain').on(t.shopifyDomain),
    // Target for composite foreign keys from tenant-owned child tables.
    unique('uq_m_shop_tenant_id_id').on(t.tenantId, t.id),
    index('ix_m_shop_tenant_id').on(t.tenantId),
    check('ck_m_shop_status', sql`${t.status} in ('active', 'uninstalled', 'reauth_required')`),
    check('ck_m_shop_domain', sql`${t.shopifyDomain} ~ '^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$'`),
    check('ck_m_shop_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/** Encrypted Shopify offline access token. Kept apart from m_shop for tighter privileges. */
export const sShopCredential = pgTable(
  's_shop_credential',
  {
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    keyId: text('key_id').notNull(),
    scopes: text('scopes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_s_shop_credential', columns: [t.shopId] }),
    // Composite FK: a credential can only reference a shop of the same tenant.
    foreignKey({
      name: 'fk_s_shop_credential_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }).onDelete('cascade'),
    index('ix_s_shop_credential_tenant_id').on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Phase 4: normalized copies of Shopify data (t_) and sync tracking (o_).
// Every table: tenant_id + shop_id, composite FK to m_shop, Shopify ids unique per shop,
// money as NUMERIC(19,4) in the shop currency. Customer personal data is deliberately not stored.
// ---------------------------------------------------------------------------------------------

const money = (name: string) => numeric(name, { precision: 19, scale: 4 });
const shopifyId = (name = 'shopify_id') => bigint(name, { mode: 'number' }).notNull();
const syncedAt = () => timestamp('synced_at', { withTimezone: true }).notNull().defaultNow();
const tsz = (name: string) => timestamp(name, { withTimezone: true });

export const tProduct = pgTable(
  't_product',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    shopifyId: shopifyId(),
    title: text('title').notNull(),
    handle: text('handle'),
    status: text('status').notNull(),
    productType: text('product_type').notNull().default(''),
    vendor: text('vendor').notNull().default(''),
    /** Collection titles from Shopify, used to set a cost on a whole collection. */
    collectionTitles: text('collection_titles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isGiftCard: boolean('is_gift_card').notNull().default(false),
    shopifyUpdatedAt: tsz('shopify_updated_at').notNull(),
    syncedAt: syncedAt(),
    deletedAt: tsz('deleted_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_t_product', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_product_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    unique('uq_t_product_shop_shopify_id').on(t.shopId, t.shopifyId),
    unique('uq_t_product_tenant_id_id').on(t.tenantId, t.id),
    index('ix_t_product_tenant_shop').on(t.tenantId, t.shopId),
  ],
);

export const tProductVariant = pgTable(
  't_product_variant',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    productId: uuid('product_id').notNull(),
    shopifyId: shopifyId(),
    productShopifyId: shopifyId('product_shopify_id'),
    title: text('title').notNull(),
    sku: text('sku'),
    priceAmount: money('price_amount').notNull(),
    inventoryItemShopifyId: bigint('inventory_item_shopify_id', { mode: 'number' }),
    /** Shopify's current unit cost, if the merchant set one. Effective-dated COGS lives in f_product_cost. */
    unitCostAmount: money('unit_cost_amount'),
    /** Current variant weight in grams. Null means Shopify did not report one. */
    weightGrams: integer('weight_grams'),
    shopifyUpdatedAt: tsz('shopify_updated_at').notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_t_product_variant', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_product_variant_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    foreignKey({
      name: 'fk_t_product_variant_product',
      columns: [t.tenantId, t.productId],
      foreignColumns: [tProduct.tenantId, tProduct.id],
    }).onDelete('cascade'),
    check('ck_t_product_variant_weight', sql`${t.weightGrams} is null or ${t.weightGrams} >= 0`),
    unique('uq_t_product_variant_shop_shopify_id').on(t.shopId, t.shopifyId),
    unique('uq_t_product_variant_tenant_id_id').on(t.tenantId, t.id),
    index('ix_t_product_variant_product').on(t.productId),
  ],
);

export const tOrder = pgTable(
  't_order',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    shopifyId: shopifyId(),
    name: text('name').notNull(),
    /** Business date of the order (UTC). Convert to the shop time zone for display and grouping. */
    processedAt: tsz('processed_at').notNull(),
    shopifyCreatedAt: tsz('shopify_created_at').notNull(),
    shopifyUpdatedAt: tsz('shopify_updated_at').notNull(),
    cancelledAt: tsz('cancelled_at'),
    closedAt: tsz('closed_at'),
    financialStatus: text('financial_status').notNull(),
    fulfillmentStatus: text('fulfillment_status'),
    taxesIncluded: boolean('taxes_included').notNull(),
    isTest: boolean('is_test').notNull().default(false),
    currency: char('currency', { length: 3 }).notNull(),
    presentmentCurrency: char('presentment_currency', { length: 3 }),
    /** Raw Shopify figures in shop currency. The profit engine decides how to combine them. */
    subtotalAmount: money('subtotal_amount').notNull(),
    discountsAmount: money('discounts_amount').notNull(),
    shippingAmount: money('shipping_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    totalAmount: money('total_amount').notNull(),
    refundedAmount: money('refunded_amount').notNull(),
    presentmentTotalAmount: money('presentment_total_amount'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sourceName: text('source_name'),
    /** Destination country (ISO code) used only to choose a shipping cost rule. */
    shipCountry: char('ship_country', { length: 2 }),
    /** Refund line items were only partly imported, so product refunds may be understated. */
    refundLinesIncomplete: boolean('refund_lines_incomplete').notNull().default(false),
    syncedAt: syncedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_t_order', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_order_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check(
      'ck_t_order_ship_country',
      sql`${t.shipCountry} is null or ${t.shipCountry} ~ '^[A-Z]{2}$'`,
    ),
    unique('uq_t_order_shop_shopify_id').on(t.shopId, t.shopifyId),
    unique('uq_t_order_tenant_id_id').on(t.tenantId, t.id),
    index('ix_t_order_shop_processed_at').on(t.tenantId, t.shopId, t.processedAt),
    index('ix_t_order_shop_updated_at').on(t.shopId, t.shopifyUpdatedAt),
  ],
);

export const tOrderLineItem = pgTable(
  't_order_line_item',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    orderId: uuid('order_id').notNull(),
    shopifyId: shopifyId(),
    productShopifyId: bigint('product_shopify_id', { mode: 'number' }),
    variantShopifyId: bigint('variant_shopify_id', { mode: 'number' }),
    title: text('title').notNull(),
    variantTitle: text('variant_title'),
    sku: text('sku'),
    quantity: integer('quantity').notNull(),
    unitPriceAmount: money('unit_price_amount').notNull(),
    discountAmount: money('discount_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    requiresShipping: boolean('requires_shipping').notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_t_order_line_item', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_order_line_item_order',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [tOrder.tenantId, tOrder.id],
    }).onDelete('cascade'),
    unique('uq_t_order_line_item_shop_shopify_id').on(t.shopId, t.shopifyId),
    unique('uq_t_order_line_item_tenant_id_id').on(t.tenantId, t.id),
    index('ix_t_order_line_item_order').on(t.orderId),
    index('ix_t_order_line_item_variant').on(t.shopId, t.variantShopifyId),
  ],
);

export const tRefund = pgTable(
  't_refund',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    orderId: uuid('order_id').notNull(),
    shopifyId: shopifyId(),
    /** When the refund took effect. Use this, not the REFUND transaction time, for reporting. */
    processedAt: tsz('processed_at').notNull(),
    shopifyCreatedAt: tsz('shopify_created_at').notNull(),
    totalAmount: money('total_amount').notNull(),
    note: text('note'),
    syncedAt: syncedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_t_refund', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_refund_order',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [tOrder.tenantId, tOrder.id],
    }).onDelete('cascade'),
    unique('uq_t_refund_shop_shopify_id').on(t.shopId, t.shopifyId),
    unique('uq_t_refund_tenant_id_id').on(t.tenantId, t.id),
    index('ix_t_refund_order').on(t.orderId),
    index('ix_t_refund_shop_processed_at').on(t.shopId, t.processedAt),
  ],
);

export const tRefundLineItem = pgTable(
  't_refund_line_item',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    refundId: uuid('refund_id').notNull(),
    shopifyId: shopifyId(),
    lineItemShopifyId: shopifyId('line_item_shopify_id'),
    quantity: integer('quantity').notNull(),
    subtotalAmount: money('subtotal_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    restockType: text('restock_type'),
    syncedAt: syncedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_t_refund_line_item', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_refund_line_item_refund',
      columns: [t.tenantId, t.refundId],
      foreignColumns: [tRefund.tenantId, tRefund.id],
    }).onDelete('cascade'),
    unique('uq_t_refund_line_item_shop_shopify_id').on(t.shopId, t.shopifyId),
    index('ix_t_refund_line_item_refund').on(t.refundId),
  ],
);

export const tOrderTransaction = pgTable(
  't_order_transaction',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    orderId: uuid('order_id').notNull(),
    shopifyId: shopifyId(),
    parentShopifyId: bigint('parent_shopify_id', { mode: 'number' }),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    gateway: text('gateway'),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    processedAt: tsz('processed_at').notNull(),
    /** Actual processing fee when Shopify reports one (Shopify Payments only). null = unknown. */
    feeAmount: money('fee_amount'),
    syncedAt: syncedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_t_order_transaction', columns: [t.id] }),
    foreignKey({
      name: 'fk_t_order_transaction_order',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [tOrder.tenantId, tOrder.id],
    }).onDelete('cascade'),
    unique('uq_t_order_transaction_shop_shopify_id').on(t.shopId, t.shopifyId),
    index('ix_t_order_transaction_order').on(t.orderId),
  ],
);

/**
 * One row per Shopify webhook delivery (deduplicated by X-Shopify-Webhook-Id). Raw payloads are
 * not stored: the handler re-fetches the resource from Shopify, so only the topic and resource id
 * are kept. Rows are purged after a short retention period.
 */
export const oWebhookEvent = pgTable(
  'o_webhook_event',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    webhookId: text('webhook_id').notNull(),
    topic: text('topic').notNull(),
    resourceId: bigint('resource_id', { mode: 'number' }),
    triggeredAt: tsz('triggered_at'),
    receivedAt: tsz('received_at').notNull().defaultNow(),
    status: text('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    processedAt: tsz('processed_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_o_webhook_event', columns: [t.id] }),
    foreignKey({
      name: 'fk_o_webhook_event_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    // The deduplication key: a redelivered webhook cannot create a second row.
    unique('uq_o_webhook_event_shop_webhook_id').on(t.shopId, t.webhookId),
    check(
      'ck_o_webhook_event_status',
      sql`${t.status} in ('received', 'processing', 'processed', 'failed', 'ignored')`,
    ),
    index('ix_o_webhook_event_shop_received').on(t.shopId, t.receivedAt),
    index('ix_o_webhook_event_received').on(t.receivedAt),
  ],
);

export const oSyncJob = pgTable(
  'o_sync_job',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    stage: text('stage'),
    windowStart: tsz('window_start'),
    /** Resume point (GraphQL cursor) so a retry continues instead of restarting. */
    cursor: text('cursor'),
    productsProcessed: integer('products_processed').notNull().default(0),
    ordersProcessed: integer('orders_processed').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    queuedAt: tsz('queued_at').notNull().defaultNow(),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_o_sync_job', columns: [t.id] }),
    foreignKey({
      name: 'fk_o_sync_job_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check('ck_o_sync_job_kind', sql`${t.kind} in ('initial', 'incremental', 'reconcile')`),
    check(
      'ck_o_sync_job_status',
      sql`${t.status} in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')`,
    ),
    index('ix_o_sync_job_shop_queued').on(t.shopId, t.queuedAt),
    // At most one active sync per shop, enforced by the database.
    uniqueIndex('uq_o_sync_job_active_shop')
      .on(t.shopId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Phase 6: merchant cost data, rules, audit trail and the profit ledger.
// ---------------------------------------------------------------------------------------------

const dateOnly = (name: string) => date(name, { mode: 'string' });

/**
 * Effective-dated unit cost per variant. Append-only: a change adds a row, it never edits one, and
 * a row can be revoked (kept for history) but not deleted. A cost applies from `effective_from`
 * until the next row's date. Keyed by the Shopify variant id so it survives variant deletion.
 */
export const fProductCost = pgTable(
  'f_product_cost',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    variantShopifyId: shopifyId('variant_shopify_id'),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    effectiveFrom: dateOnly('effective_from').notNull(),
    source: text('source').notNull().default('manual'),
    reason: text('reason'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    revokedAt: tsz('revoked_at'),
    revokedBy: text('revoked_by'),
  },
  (t) => [
    primaryKey({ name: 'pk_f_product_cost', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_product_cost_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check('ck_f_product_cost_amount', sql`${t.amount} >= 0`),
    check('ck_f_product_cost_source', sql`${t.source} in ('manual', 'import')`),
    index('ix_f_product_cost_variant').on(t.shopId, t.variantShopifyId),
    // Only one active cost per variant and start date.
    uniqueIndex('uq_f_product_cost_active')
      .on(t.shopId, t.variantShopifyId, t.effectiveFrom)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Payment fee estimate: percent + fixed per successful payment, per gateway or for all gateways. */
export const sPaymentFeeRule = pgTable(
  's_payment_fee_rule',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    gateway: text('gateway'),
    percent: numeric('percent', { precision: 9, scale: 6 }).notNull(),
    fixedAmount: money('fixed_amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    effectiveFrom: dateOnly('effective_from').notNull(),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    revokedAt: tsz('revoked_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_s_payment_fee_rule', columns: [t.id] }),
    foreignKey({
      name: 'fk_s_payment_fee_rule_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check('ck_s_payment_fee_rule_percent', sql`${t.percent} >= 0 and ${t.percent} <= 100`),
    check('ck_s_payment_fee_rule_fixed', sql`${t.fixedAmount} >= 0`),
    index('ix_s_payment_fee_rule_shop').on(t.shopId),
    uniqueIndex('uq_s_payment_fee_rule_active')
      .on(t.shopId, sql`coalesce(${t.gateway}, '')`, t.currency, t.effectiveFrom)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Carrier cost: flat, percent of shipping charged, or per kilogram, optionally by country and weight. */
export const sShippingCostRule = pgTable(
  's_shipping_cost_rule',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    mode: text('mode').notNull(),
    amount: money('amount'),
    percent: numeric('percent', { precision: 9, scale: 6 }),
    /** Merchant's label. Not used when choosing which rule applies. */
    zoneName: text('zone_name'),
    /** ISO country codes. Empty means any country. */
    countries: text('countries')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Inclusive lower bound in grams. Null means no lower bound. */
    weightMinGrams: integer('weight_min_grams'),
    /** Exclusive upper bound in grams. Null means no upper bound. */
    weightMaxGrams: integer('weight_max_grams'),
    effectiveFrom: dateOnly('effective_from').notNull(),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    revokedAt: tsz('revoked_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_s_shipping_cost_rule', columns: [t.id] }),
    foreignKey({
      name: 'fk_s_shipping_cost_rule_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check(
      'ck_s_shipping_cost_rule_mode',
      sql`(${t.mode} = 'flat' and ${t.amount} is not null and ${t.amount} >= 0)
        or (${t.mode} = 'percent_of_shipping_charged' and ${t.percent} is not null and ${t.percent} >= 0 and ${t.percent} <= 1000)
        or (${t.mode} = 'per_kilogram' and ${t.amount} is not null and ${t.amount} >= 0)`,
    ),
    check(
      'ck_s_shipping_cost_rule_weight',
      sql`(${t.weightMinGrams} is null or ${t.weightMinGrams} >= 0)
        and (${t.weightMaxGrams} is null or ${t.weightMaxGrams} > 0)
        and (${t.weightMinGrams} is null or ${t.weightMaxGrams} is null or ${t.weightMinGrams} < ${t.weightMaxGrams})`,
    ),
    index('ix_s_shipping_cost_rule_shop').on(t.shopId),
    uniqueIndex('uq_s_shipping_cost_rule_active')
      .on(
        t.shopId,
        sql`coalesce(${t.zoneName}, '')`,
        t.countries,
        sql`coalesce(${t.weightMinGrams}, -1)`,
        sql`coalesce(${t.weightMaxGrams}, -1)`,
        t.effectiveFrom,
      )
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Per-shop settings. One row per shop. */
export const sAppSetting = pgTable(
  's_app_setting',
  {
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    /** Banner when the share of sales without a product cost exceeds this percentage. */
    missingCogsWarningPct: numeric('missing_cogs_warning_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('10'),
    /** Warn when the contribution margin of a period falls below this percentage. */
    marginWarningPct: numeric('margin_warning_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('20'),
    /** Warn when refunds exceed this percentage of sales. */
    refundRateWarningPct: numeric('refund_rate_warning_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('10'),
    /** Flag a product cost that changed by at least this percentage. */
    costChangeWarningPct: numeric('cost_change_warning_pct', { precision: 6, scale: 2 })
      .notNull()
      .default('10'),
    /** Where alert emails go (up to 5 addresses the merchant typed); empty means no emails. */
    alertEmailRecipients: text('alert_email_recipients')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** What a new expense starts as: one-time or recurring, and monthly or yearly. */
    expenseDefaultKind: text('expense_default_kind').notNull().default('recurring'),
    expenseDefaultFrequency: text('expense_default_frequency').notNull().default('monthly'),
    updatedBy: text('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_s_app_setting', columns: [t.shopId] }),
    foreignKey({
      name: 'fk_s_app_setting_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check(
      'ck_s_app_setting_missing_cogs',
      sql`${t.missingCogsWarningPct} >= 0 and ${t.missingCogsWarningPct} <= 100`,
    ),
    check('ck_s_app_setting_alert_emails', sql`cardinality(${t.alertEmailRecipients}) <= 5`),
    check(
      'ck_s_app_setting_expense_defaults',
      sql`${t.expenseDefaultKind} in ('recurring', 'one_time') and ${t.expenseDefaultFrequency} in ('monthly', 'yearly')`,
    ),
    check(
      'ck_s_app_setting_leakage',
      sql`${t.marginWarningPct} between 0 and 100 and ${t.refundRateWarningPct} between 0 and 100 and ${t.costChangeWarningPct} between 0 and 1000`,
    ),
  ],
);

/** Append-only record of merchant changes (who, what, old value, new value, why). Never updated. */
export const aAuditLog = pgTable(
  'a_audit_log',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_a_audit_log', columns: [t.id] }),
    foreignKey({
      name: 'fk_a_audit_log_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    index('ix_a_audit_log_shop_created').on(t.shopId, t.createdAt),
  ],
);

/**
 * The profit ledger: one row per component per event (order or refund), produced by the profit
 * engine. Daily and monthly totals are sums of these rows; every dashboard number can be traced
 * back to them. Replaced per order on recalculation (idempotent).
 */
export const fProfitEntry = pgTable(
  'f_profit_entry',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    orderId: uuid('order_id').notNull(),
    refundShopifyId: bigint('refund_shopify_id', { mode: 'number' }),
    lineItemShopifyId: bigint('line_item_shopify_id', { mode: 'number' }),
    component: text('component').notNull(),
    occurredAt: tsz('occurred_at').notNull(),
    /** Business date in the shop time zone. */
    entryDate: dateOnly('entry_date').notNull(),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: text('status').notNull(),
    source: text('source').notNull(),
    /** Sales value this entry's data quality applies to (weights the confidence). */
    basisAmount: money('basis_amount'),
    memo: boolean('memo').notNull().default(false),
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    engineVersion: text('engine_version').notNull(),
    calculatedAt: tsz('calculated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_f_profit_entry', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_profit_entry_order',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [tOrder.tenantId, tOrder.id],
    }).onDelete('cascade'),
    check(
      'ck_f_profit_entry_component',
      sql`${t.component} in ('gross_sales', 'discounts', 'shipping_revenue', 'tax_collected', 'product_refund', 'shipping_refund', 'tax_refunded', 'cogs', 'cogs_reversal', 'payment_fees', 'shipping_cost')`,
    ),
    check(
      'ck_f_profit_entry_status',
      sql`${t.status} in ('actual', 'estimated', 'missing', 'not_applicable')`,
    ),
    index('ix_f_profit_entry_shop_date').on(t.shopId, t.entryDate),
    index('ix_f_profit_entry_order').on(t.orderId),
    index('ix_f_profit_entry_shop_component_date').on(t.shopId, t.component, t.entryDate),
  ],
);

/** One row per order: was it counted, why not, and review flags. Replaced on recalculation. */
export const fOrderProfit = pgTable(
  'f_order_profit',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    orderId: uuid('order_id').notNull(),
    /** Business date (shop time zone) of the order: counts orders per period. */
    orderDate: dateOnly('order_date').notNull(),
    recognized: boolean('recognized').notNull(),
    exclusionReason: text('exclusion_reason'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Sum of the profit components of this order (all events, memo excluded). */
    contributionAmount: money('contribution_amount'),
    /** True when a cost, fee or shipping cost was missing: the figure is partial. */
    partial: boolean('partial').notNull().default(false),
    engineVersion: text('engine_version').notNull(),
    calculatedAt: tsz('calculated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_f_order_profit', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_order_profit_order',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [tOrder.tenantId, tOrder.id],
    }).onDelete('cascade'),
    unique('uq_f_order_profit_order').on(t.orderId),
    index('ix_f_order_profit_shop').on(t.shopId, t.recognized),
    index('ix_f_order_profit_shop_date').on(t.shopId, t.orderDate),
  ],
);

// ---------------------------------------------------------------------------
// Phase 9: expenses and advertising
// ---------------------------------------------------------------------------

/** Merchant-defined expense categories. Archived, never deleted, so history keeps its label. */
export const fExpenseCategory = pgTable(
  'f_expense_category',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    name: text('name').notNull(),
    /**
     * What kind of cost the category holds: product (purchases, which are already in profit through
     * product costs), logistics (shipping and handling, partly in order-level shipping costs),
     * advertising, or operating. It tells the merchant where a cost could be counted twice.
     */
    class: text('class').notNull().default('operating'),
    createdAt: createdAt(),
    archivedAt: tsz('archived_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_f_expense_category', columns: [t.id] }),
    check(
      'ck_f_expense_category_class',
      sql`${t.class} in ('product', 'logistics', 'advertising', 'operating')`,
    ),
    foreignKey({
      name: 'fk_f_expense_category_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    unique('uq_f_expense_category_tenant_id_id').on(t.tenantId, t.id),
    check('ck_f_expense_category_name', sql`length(btrim(${t.name})) between 1 and 60`),
    uniqueIndex('uq_f_expense_category_name')
      .on(t.shopId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * One-time and recurring operating expenses. Occurrences are computed from these rows, never
 * stored, so a retried job or request cannot create a duplicate charge. A change of amount for a
 * recurring expense ends the old row and starts a new one (replaces_id), so past months keep the
 * amount that applied then.
 */
export const fExpense = pgTable(
  'f_expense',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    name: text('name').notNull(),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    kind: text('kind').notNull(),
    frequency: text('frequency'),
    startDate: dateOnly('start_date').notNull(),
    /** Last day a recurring expense applies (inclusive), or null while it continues. */
    endDate: dateOnly('end_date'),
    replacesId: uuid('replaces_id'),
    /** Client-supplied key making a create request safe to retry. */
    requestKey: text('request_key'),
    /** The merchant's own reference (an invoice or receipt number). */
    reference: text('reference'),
    description: text('description'),
    /**
     * When the expense was typed in another currency: the amount as typed, its currency, and the rate
     * and rate date used to convert it once into `amount` (shop currency). All null for shop-currency
     * expenses.
     */
    originalAmount: money('original_amount'),
    originalCurrency: char('original_currency', { length: 3 }),
    fxRate: numeric('fx_rate', { precision: 18, scale: 10 }),
    fxRateDate: dateOnly('fx_rate_date'),
    /** True when the rate was older than the expense date or not from the reference source on the day. */
    fxEstimated: boolean('fx_estimated').notNull().default(false),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    revokedAt: tsz('revoked_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_f_expense', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_expense_category',
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [fExpenseCategory.tenantId, fExpenseCategory.id],
    }),
    unique('uq_f_expense_tenant_id_id').on(t.tenantId, t.id),
    check('ck_f_expense_amount', sql`${t.amount} >= 0`),
    check('ck_f_expense_name', sql`length(btrim(${t.name})) between 1 and 120`),
    check(
      'ck_f_expense_kind',
      sql`(${t.kind} = 'one_time' and ${t.frequency} is null and ${t.endDate} is null)
        or (${t.kind} = 'recurring' and ${t.frequency} in ('monthly', 'yearly'))`,
    ),
    check('ck_f_expense_dates', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check(
      'ck_f_expense_reference',
      sql`${t.reference} is null or length(btrim(${t.reference})) between 1 and 60`,
    ),
    check(
      'ck_f_expense_description',
      sql`${t.description} is null or length(btrim(${t.description})) between 1 and 500`,
    ),
    check(
      'ck_f_expense_foreign',
      sql`(${t.originalAmount} is null) = (${t.originalCurrency} is null) and (${t.originalAmount} is null) = (${t.fxRate} is null)`,
    ),
    index('ix_f_expense_shop').on(t.shopId, t.startDate),
    uniqueIndex('uq_f_expense_request_key')
      .on(t.shopId, t.requestKey)
      .where(sql`${t.requestKey} is not null`),
  ],
);

/** A change for one month of a recurring expense: a different amount, or skip that month. */
export const fExpenseOverride = pgTable(
  'f_expense_override',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    expenseId: uuid('expense_id').notNull(),
    /** First day of the month the change applies to. */
    month: dateOnly('month').notNull(),
    amount: money('amount'),
    skipped: boolean('skipped').notNull().default(false),
    updatedBy: text('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_f_expense_override', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_expense_override_expense',
      columns: [t.tenantId, t.expenseId],
      foreignColumns: [fExpense.tenantId, fExpense.id],
    }).onDelete('cascade'),
    unique('uq_f_expense_override_month').on(t.expenseId, t.month),
    check('ck_f_expense_override_month', sql`extract(day from ${t.month}) = 1`),
    check(
      'ck_f_expense_override_value',
      sql`(${t.skipped} and ${t.amount} is null) or (not ${t.skipped} and ${t.amount} is not null and ${t.amount} >= 0)`,
    ),
  ],
);

/** A source of advertising spend: a platform account, or manual entry. */
export const fAdAccount = pgTable(
  'f_ad_account',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    /** 'manual' today; platform providers are added one at a time. */
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    externalId: text('external_id'),
    /** Platform access token, encrypted the same way as the Shopify token. Null for manual entry. */
    encryptedAccessToken: text('encrypted_access_token'),
    status: text('status').notNull().default('active'),
    lastSyncAt: tsz('last_sync_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    archivedAt: tsz('archived_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_f_ad_account', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_ad_account_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    unique('uq_f_ad_account_tenant_id_id').on(t.tenantId, t.id),
    check('ck_f_ad_account_name', sql`length(btrim(${t.name})) between 1 and 80`),
    check('ck_f_ad_account_status', sql`${t.status} in ('active', 'error', 'disconnected')`),
    uniqueIndex('uq_f_ad_account_name')
      .on(t.shopId, t.provider, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * Daily advertising spend per account and campaign. `reported_sales` is what the platform claims it
 * drove and is kept apart from Shopify sales. Upserted by (account, date, campaign), so a repeated
 * sync never counts the same spend twice.
 */
export const fAdSpendDaily = pgTable(
  'f_ad_spend_daily',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    accountId: uuid('account_id').notNull(),
    spendDate: dateOnly('spend_date').notNull(),
    campaign: text('campaign').notNull().default(''),
    spend: money('spend').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    reportedSales: money('reported_sales'),
    clicks: integer('clicks'),
    impressions: integer('impressions'),
    source: text('source').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_f_ad_spend_daily', columns: [t.id] }),
    foreignKey({
      name: 'fk_f_ad_spend_daily_account',
      columns: [t.tenantId, t.accountId],
      foreignColumns: [fAdAccount.tenantId, fAdAccount.id],
    }).onDelete('cascade'),
    unique('uq_f_ad_spend_daily_key').on(t.accountId, t.spendDate, t.campaign),
    check('ck_f_ad_spend_daily_spend', sql`${t.spend} >= 0`),
    check('ck_f_ad_spend_daily_sales', sql`${t.reportedSales} is null or ${t.reportedSales} >= 0`),
    index('ix_f_ad_spend_daily_shop_date').on(t.shopId, t.spendDate),
  ],
);

// ---------------------------------------------------------------------------
// Phase 10: reports, exports, notifications
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** A generated report file (CSV or PDF), produced in the background and kept for a few days. */
export const oReportExport = pgTable(
  'o_report_export',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    kind: text('kind').notNull(),
    format: text('format').notNull(),
    periodFrom: dateOnly('period_from').notNull(),
    periodTo: dateOnly('period_to').notNull(),
    status: text('status').notNull().default('queued'),
    error: text('error'),
    sizeBytes: integer('size_bytes'),
    content: bytea('content'),
    attempts: integer('attempts').notNull().default(0),
    requestedBy: text('requested_by'),
    scheduleId: uuid('schedule_id'),
    createdAt: createdAt(),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    expiresAt: tsz('expires_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_o_report_export', columns: [t.id] }),
    foreignKey({
      name: 'fk_o_report_export_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    unique('uq_o_report_export_tenant_id_id').on(t.tenantId, t.id),
    check(
      'ck_o_report_export_kind',
      sql`${t.kind} in ('profit_loss', 'products', 'orders', 'marketing', 'expenses', 'refunds', 'missing_costs')`,
    ),
    check('ck_o_report_export_format', sql`${t.format} in ('csv', 'pdf')`),
    check(
      'ck_o_report_export_status',
      sql`${t.status} in ('queued', 'running', 'ready', 'failed')`,
    ),
    check('ck_o_report_export_period', sql`${t.periodTo} >= ${t.periodFrom}`),
    index('ix_o_report_export_shop').on(t.shopId, t.createdAt),
  ],
);

/** A report sent by email on a schedule, in the shop's own time zone. */
export const sReportSchedule = pgTable(
  's_report_schedule',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    kind: text('kind').notNull(),
    format: text('format').notNull(),
    frequency: text('frequency').notNull(),
    /** 0 = Sunday .. 6 = Saturday, for weekly schedules */
    weekday: integer('weekday'),
    /** hour of day in the shop time zone, 0 to 23 */
    hour: integer('hour').notNull(),
    recipients: text('recipients').array().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** the last period end date already sent: a schedule never sends the same period twice */
    lastPeriodEnd: dateOnly('last_period_end'),
    lastRunAt: tsz('last_run_at'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    deletedAt: tsz('deleted_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_s_report_schedule', columns: [t.id] }),
    foreignKey({
      name: 'fk_s_report_schedule_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    unique('uq_s_report_schedule_tenant_id_id').on(t.tenantId, t.id),
    check(
      'ck_s_report_schedule_kind',
      sql`${t.kind} in ('profit_loss', 'products', 'orders', 'marketing', 'expenses', 'refunds', 'missing_costs')`,
    ),
    check('ck_s_report_schedule_format', sql`${t.format} in ('csv', 'pdf')`),
    check(
      'ck_s_report_schedule_when',
      sql`${t.hour} between 0 and 23 and (
        (${t.frequency} = 'weekly' and ${t.weekday} between 0 and 6)
        or (${t.frequency} = 'monthly' and ${t.weekday} is null))`,
    ),
    check('ck_s_report_schedule_recipients', sql`cardinality(${t.recipients}) between 1 and 5`),
    index('ix_s_report_schedule_shop').on(t.shopId),
  ],
);

/** One email to one recipient: its state is kept so a failure is visible and can be retried. */
export const oReportDelivery = pgTable(
  'o_report_delivery',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    scheduleId: uuid('schedule_id'),
    exportId: uuid('export_id').notNull(),
    recipient: text('recipient').notNull(),
    status: text('status').notNull().default('queued'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    sentAt: tsz('sent_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_o_report_delivery', columns: [t.id] }),
    foreignKey({
      name: 'fk_o_report_delivery_export',
      columns: [t.tenantId, t.exportId],
      foreignColumns: [oReportExport.tenantId, oReportExport.id],
    }).onDelete('cascade'),
    check('ck_o_report_delivery_status', sql`${t.status} in ('queued', 'sent', 'failed')`),
    unique('uq_o_report_delivery_once').on(t.exportId, t.recipient),
    index('ix_o_report_delivery_shop').on(t.shopId, t.createdAt),
  ],
);

/** A message for the merchant inside the app. */
export const oNotification = pgTable(
  'o_notification',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    /** one notification per key: a repeated event does not create a second message */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    readAt: tsz('read_at'),
    /** when this message was sent by email (null: not emailed, or emailing is off) */
    emailedAt: tsz('emailed_at'),
  },
  (t) => [
    primaryKey({ name: 'pk_o_notification', columns: [t.id] }),
    foreignKey({
      name: 'fk_o_notification_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check(
      'ck_o_notification_severity',
      sql`${t.severity} in ('info', 'success', 'warning', 'critical')`,
    ),
    uniqueIndex('uq_o_notification_dedupe')
      .on(t.shopId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('ix_o_notification_shop').on(t.shopId, t.createdAt),
    index('ix_o_notification_unemailed')
      .on(t.shopId, t.createdAt)
      .where(sql`${t.emailedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Phase 12: billing and support
// ---------------------------------------------------------------------------

/**
 * What Shopify says about the shop's app subscription. One row per shop, replaced when Shopify
 * reports a change. The app never stores card data or prices it is paid: Shopify bills the merchant.
 */
export const sSubscription = pgTable(
  's_subscription',
  {
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    plan: text('plan').notNull(),
    status: text('status').notNull(),
    shopifySubscriptionId: text('shopify_subscription_id'),
    /** the name of the plan as Shopify shows it */
    planName: text('plan_name'),
    isTest: boolean('is_test').notNull().default(false),
    currentPeriodEnd: tsz('current_period_end'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_s_subscription', columns: [t.shopId] }),
    foreignKey({
      name: 'fk_s_subscription_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check('ck_s_subscription_plan', sql`${t.plan} in ('free', 'growth', 'pro')`),
    check(
      'ck_s_subscription_status',
      sql`${t.status} in ('none', 'pending', 'active', 'frozen', 'cancelled', 'declined', 'expired')`,
    ),
  ],
);

/** A message from the merchant to us: feedback, a question or a problem. */
export const oFeedback = pgTable(
  'o_feedback',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    shopId: uuid('shop_id').notNull(),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    /** where to reply, if the merchant wants an answer */
    contactEmail: text('contact_email'),
    status: text('status').notNull().default('new'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'pk_o_feedback', columns: [t.id] }),
    foreignKey({
      name: 'fk_o_feedback_shop',
      columns: [t.tenantId, t.shopId],
      foreignColumns: [mShop.tenantId, mShop.id],
    }),
    check('ck_o_feedback_kind', sql`${t.kind} in ('feedback', 'question', 'problem')`),
    check('ck_o_feedback_status', sql`${t.status} in ('new', 'seen', 'answered', 'closed')`),
    check('ck_o_feedback_message', sql`length(btrim(${t.message})) between 3 and 2000`),
    index('ix_o_feedback_shop').on(t.shopId, t.createdAt),
  ],
);

/**
 * Daily euro reference rates (units of the quote currency per 1 EUR), from the European Central Bank. Public
 * market data shared by every shop, so it has no tenant id; see migration 0020 for its access rules.
 */
export const oExchangeRate = pgTable(
  'o_exchange_rate',
  {
    quote: char('quote', { length: 3 }).notNull(),
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    rate: numeric('rate', { precision: 19, scale: 10 }).notNull(),
    source: text('source').notNull(),
    fetchedAt: tsz('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_o_exchange_rate', columns: [t.quote, t.rateDate] }),
    check('ck_o_exchange_rate_quote', sql`${t.quote} ~ '^[A-Z]{3}$'`),
    check('ck_o_exchange_rate_positive', sql`${t.rate} > 0`),
  ],
);
