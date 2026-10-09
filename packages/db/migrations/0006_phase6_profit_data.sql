CREATE TABLE "a_audit_log" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_a_audit_log" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "f_order_profit" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"recognized" boolean NOT NULL,
	"exclusion_reason" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"contribution_amount" numeric(19, 4),
	"partial" boolean DEFAULT false NOT NULL,
	"engine_version" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_f_order_profit" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_order_profit_order" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "f_product_cost" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"variant_shopify_id" bigint NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_from" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "pk_f_product_cost" PRIMARY KEY("id"),
	CONSTRAINT "ck_f_product_cost_amount" CHECK ("f_product_cost"."amount" >= 0),
	CONSTRAINT "ck_f_product_cost_source" CHECK ("f_product_cost"."source" in ('manual', 'import'))
);
--> statement-breakpoint
CREATE TABLE "f_profit_entry" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"refund_shopify_id" bigint,
	"line_item_shopify_id" bigint,
	"component" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"entry_date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"basis_amount" numeric(19, 4),
	"memo" boolean DEFAULT false NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_f_profit_entry" PRIMARY KEY("id"),
	CONSTRAINT "ck_f_profit_entry_component" CHECK ("f_profit_entry"."component" in ('gross_sales', 'discounts', 'shipping_revenue', 'tax_collected', 'product_refund', 'shipping_refund', 'tax_refunded', 'cogs', 'cogs_reversal', 'payment_fees', 'shipping_cost')),
	CONSTRAINT "ck_f_profit_entry_status" CHECK ("f_profit_entry"."status" in ('actual', 'estimated', 'missing', 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "s_app_setting" (
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"missing_cogs_warning_pct" numeric(5, 2) DEFAULT '10' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_s_app_setting" PRIMARY KEY("shop_id"),
	CONSTRAINT "ck_s_app_setting_missing_cogs" CHECK ("s_app_setting"."missing_cogs_warning_pct" >= 0 and "s_app_setting"."missing_cogs_warning_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "s_payment_fee_rule" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"gateway" text,
	"percent" numeric(9, 6) NOT NULL,
	"fixed_amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pk_s_payment_fee_rule" PRIMARY KEY("id"),
	CONSTRAINT "ck_s_payment_fee_rule_percent" CHECK ("s_payment_fee_rule"."percent" >= 0 and "s_payment_fee_rule"."percent" <= 100),
	CONSTRAINT "ck_s_payment_fee_rule_fixed" CHECK ("s_payment_fee_rule"."fixed_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "s_shipping_cost_rule" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"amount" numeric(19, 4),
	"percent" numeric(9, 6),
	"effective_from" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pk_s_shipping_cost_rule" PRIMARY KEY("id"),
	CONSTRAINT "ck_s_shipping_cost_rule_mode" CHECK (("s_shipping_cost_rule"."mode" = 'flat' and "s_shipping_cost_rule"."amount" is not null and "s_shipping_cost_rule"."amount" >= 0)
        or ("s_shipping_cost_rule"."mode" = 'percent_of_shipping_charged' and "s_shipping_cost_rule"."percent" is not null and "s_shipping_cost_rule"."percent" >= 0 and "s_shipping_cost_rule"."percent" <= 1000))
);
--> statement-breakpoint
ALTER TABLE "a_audit_log" ADD CONSTRAINT "fk_a_audit_log_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_order_profit" ADD CONSTRAINT "fk_f_order_profit_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."t_order"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_product_cost" ADD CONSTRAINT "fk_f_product_cost_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_profit_entry" ADD CONSTRAINT "fk_f_profit_entry_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."t_order"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s_app_setting" ADD CONSTRAINT "fk_s_app_setting_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s_payment_fee_rule" ADD CONSTRAINT "fk_s_payment_fee_rule_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" ADD CONSTRAINT "fk_s_shipping_cost_rule_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_a_audit_log_shop_created" ON "a_audit_log" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_f_order_profit_shop" ON "f_order_profit" USING btree ("shop_id","recognized");--> statement-breakpoint
CREATE INDEX "ix_f_product_cost_variant" ON "f_product_cost" USING btree ("shop_id","variant_shopify_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_f_product_cost_active" ON "f_product_cost" USING btree ("shop_id","variant_shopify_id","effective_from") WHERE "f_product_cost"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "ix_f_profit_entry_shop_date" ON "f_profit_entry" USING btree ("shop_id","entry_date");--> statement-breakpoint
CREATE INDEX "ix_f_profit_entry_order" ON "f_profit_entry" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_f_profit_entry_shop_component_date" ON "f_profit_entry" USING btree ("shop_id","component","entry_date");--> statement-breakpoint
CREATE INDEX "ix_s_payment_fee_rule_shop" ON "s_payment_fee_rule" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_s_payment_fee_rule_active" ON "s_payment_fee_rule" USING btree ("shop_id",(coalesce("gateway", '')),"currency","effective_from") WHERE "s_payment_fee_rule"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "ix_s_shipping_cost_rule_shop" ON "s_shipping_cost_rule" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_s_shipping_cost_rule_active" ON "s_shipping_cost_rule" USING btree ("shop_id","effective_from") WHERE "s_shipping_cost_rule"."revoked_at" is null;