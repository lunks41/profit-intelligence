CREATE TABLE "f_ad_account" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pk_f_ad_account" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_ad_account_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_f_ad_account_name" CHECK (length(btrim("f_ad_account"."name")) between 1 and 80),
	CONSTRAINT "ck_f_ad_account_status" CHECK ("f_ad_account"."status" in ('active', 'error', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "f_ad_spend_daily" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"spend_date" date NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"spend" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"reported_sales" numeric(19, 4),
	"clicks" integer,
	"impressions" integer,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_f_ad_spend_daily" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_ad_spend_daily_key" UNIQUE("account_id","spend_date","campaign"),
	CONSTRAINT "ck_f_ad_spend_daily_spend" CHECK ("f_ad_spend_daily"."spend" >= 0),
	CONSTRAINT "ck_f_ad_spend_daily_sales" CHECK ("f_ad_spend_daily"."reported_sales" is null or "f_ad_spend_daily"."reported_sales" >= 0)
);
--> statement-breakpoint
CREATE TABLE "f_expense" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"kind" text NOT NULL,
	"frequency" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"replaces_id" uuid,
	"request_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pk_f_expense" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_expense_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_f_expense_amount" CHECK ("f_expense"."amount" >= 0),
	CONSTRAINT "ck_f_expense_name" CHECK (length(btrim("f_expense"."name")) between 1 and 120),
	CONSTRAINT "ck_f_expense_kind" CHECK (("f_expense"."kind" = 'one_time' and "f_expense"."frequency" is null and "f_expense"."end_date" is null)
        or ("f_expense"."kind" = 'recurring' and "f_expense"."frequency" in ('monthly', 'yearly'))),
	CONSTRAINT "ck_f_expense_dates" CHECK ("f_expense"."end_date" is null or "f_expense"."end_date" >= "f_expense"."start_date")
);
--> statement-breakpoint
CREATE TABLE "f_expense_category" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pk_f_expense_category" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_expense_category_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_f_expense_category_name" CHECK (length(btrim("f_expense_category"."name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "f_expense_override" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(19, 4),
	"skipped" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_f_expense_override" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_expense_override_month" UNIQUE("expense_id","month"),
	CONSTRAINT "ck_f_expense_override_month" CHECK (extract(day from "f_expense_override"."month") = 1),
	CONSTRAINT "ck_f_expense_override_value" CHECK (("f_expense_override"."skipped" and "f_expense_override"."amount" is null) or (not "f_expense_override"."skipped" and "f_expense_override"."amount" is not null and "f_expense_override"."amount" >= 0))
);
--> statement-breakpoint
ALTER TABLE "f_ad_account" ADD CONSTRAINT "fk_f_ad_account_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_ad_spend_daily" ADD CONSTRAINT "fk_f_ad_spend_daily_account" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."f_ad_account"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_expense" ADD CONSTRAINT "fk_f_expense_category" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."f_expense_category"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_expense_category" ADD CONSTRAINT "fk_f_expense_category_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_expense_override" ADD CONSTRAINT "fk_f_expense_override_expense" FOREIGN KEY ("tenant_id","expense_id") REFERENCES "public"."f_expense"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_f_ad_account_name" ON "f_ad_account" USING btree ("shop_id","provider",lower("name")) WHERE "f_ad_account"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "ix_f_ad_spend_daily_shop_date" ON "f_ad_spend_daily" USING btree ("shop_id","spend_date");--> statement-breakpoint
CREATE INDEX "ix_f_expense_shop" ON "f_expense" USING btree ("shop_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_f_expense_request_key" ON "f_expense" USING btree ("shop_id","request_key") WHERE "f_expense"."request_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_f_expense_category_name" ON "f_expense_category" USING btree ("shop_id",lower("name")) WHERE "f_expense_category"."archived_at" is null;