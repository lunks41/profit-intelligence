CREATE TABLE "o_sync_job" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text,
	"window_start" timestamp with time zone,
	"cursor" text,
	"products_processed" integer DEFAULT 0 NOT NULL,
	"orders_processed" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_o_sync_job" PRIMARY KEY("id"),
	CONSTRAINT "ck_o_sync_job_kind" CHECK ("o_sync_job"."kind" in ('initial', 'incremental', 'reconcile')),
	CONSTRAINT "ck_o_sync_job_status" CHECK ("o_sync_job"."status" in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "t_order" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"name" text NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"shopify_created_at" timestamp with time zone NOT NULL,
	"shopify_updated_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"financial_status" text NOT NULL,
	"fulfillment_status" text,
	"taxes_included" boolean NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"currency" char(3) NOT NULL,
	"presentment_currency" char(3),
	"subtotal_amount" numeric(19, 4) NOT NULL,
	"discounts_amount" numeric(19, 4) NOT NULL,
	"shipping_amount" numeric(19, 4) NOT NULL,
	"tax_amount" numeric(19, 4) NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"refunded_amount" numeric(19, 4) NOT NULL,
	"presentment_total_amount" numeric(19, 4),
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_name" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_t_order" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_order_shop_shopify_id" UNIQUE("shop_id","shopify_id"),
	CONSTRAINT "uq_t_order_tenant_id_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "t_order_line_item" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"product_shopify_id" bigint,
	"variant_shopify_id" bigint,
	"title" text NOT NULL,
	"variant_title" text,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price_amount" numeric(19, 4) NOT NULL,
	"discount_amount" numeric(19, 4) NOT NULL,
	"tax_amount" numeric(19, 4) NOT NULL,
	"requires_shipping" boolean NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_t_order_line_item" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_order_line_item_shop_shopify_id" UNIQUE("shop_id","shopify_id"),
	CONSTRAINT "uq_t_order_line_item_tenant_id_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "t_order_transaction" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"parent_shopify_id" bigint,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"gateway" text,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"fee_amount" numeric(19, 4),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_t_order_transaction" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_order_transaction_shop_shopify_id" UNIQUE("shop_id","shopify_id")
);
--> statement-breakpoint
CREATE TABLE "t_product" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"title" text NOT NULL,
	"handle" text,
	"status" text NOT NULL,
	"product_type" text DEFAULT '' NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"is_gift_card" boolean DEFAULT false NOT NULL,
	"shopify_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pk_t_product" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_product_shop_shopify_id" UNIQUE("shop_id","shopify_id"),
	CONSTRAINT "uq_t_product_tenant_id_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "t_product_variant" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"product_shopify_id" bigint NOT NULL,
	"title" text NOT NULL,
	"sku" text,
	"price_amount" numeric(19, 4) NOT NULL,
	"inventory_item_shopify_id" bigint,
	"unit_cost_amount" numeric(19, 4),
	"shopify_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_t_product_variant" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_product_variant_shop_shopify_id" UNIQUE("shop_id","shopify_id"),
	CONSTRAINT "uq_t_product_variant_tenant_id_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "t_refund" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"shopify_created_at" timestamp with time zone NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"note" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_t_refund" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_refund_shop_shopify_id" UNIQUE("shop_id","shopify_id"),
	CONSTRAINT "uq_t_refund_tenant_id_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "t_refund_line_item" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"shopify_id" bigint NOT NULL,
	"line_item_shopify_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal_amount" numeric(19, 4) NOT NULL,
	"tax_amount" numeric(19, 4) NOT NULL,
	"restock_type" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_t_refund_line_item" PRIMARY KEY("id"),
	CONSTRAINT "uq_t_refund_line_item_shop_shopify_id" UNIQUE("shop_id","shopify_id")
);
--> statement-breakpoint
ALTER TABLE "o_sync_job" ADD CONSTRAINT "fk_o_sync_job_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_order" ADD CONSTRAINT "fk_t_order_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_order_line_item" ADD CONSTRAINT "fk_t_order_line_item_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."t_order"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_order_transaction" ADD CONSTRAINT "fk_t_order_transaction_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."t_order"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_product" ADD CONSTRAINT "fk_t_product_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_product_variant" ADD CONSTRAINT "fk_t_product_variant_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_product_variant" ADD CONSTRAINT "fk_t_product_variant_product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."t_product"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_refund" ADD CONSTRAINT "fk_t_refund_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."t_order"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "t_refund_line_item" ADD CONSTRAINT "fk_t_refund_line_item_refund" FOREIGN KEY ("tenant_id","refund_id") REFERENCES "public"."t_refund"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_o_sync_job_shop_queued" ON "o_sync_job" USING btree ("shop_id","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_o_sync_job_active_shop" ON "o_sync_job" USING btree ("shop_id") WHERE "o_sync_job"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ix_t_order_shop_processed_at" ON "t_order" USING btree ("tenant_id","shop_id","processed_at");--> statement-breakpoint
CREATE INDEX "ix_t_order_shop_updated_at" ON "t_order" USING btree ("shop_id","shopify_updated_at");--> statement-breakpoint
CREATE INDEX "ix_t_order_line_item_order" ON "t_order_line_item" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_t_order_line_item_variant" ON "t_order_line_item" USING btree ("shop_id","variant_shopify_id");--> statement-breakpoint
CREATE INDEX "ix_t_order_transaction_order" ON "t_order_transaction" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_t_product_tenant_shop" ON "t_product" USING btree ("tenant_id","shop_id");--> statement-breakpoint
CREATE INDEX "ix_t_product_variant_product" ON "t_product_variant" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ix_t_refund_order" ON "t_refund" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_t_refund_shop_processed_at" ON "t_refund" USING btree ("shop_id","processed_at");--> statement-breakpoint
CREATE INDEX "ix_t_refund_line_item_refund" ON "t_refund_line_item" USING btree ("refund_id");