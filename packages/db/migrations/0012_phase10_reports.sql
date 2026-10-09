CREATE TABLE "o_notification" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "pk_o_notification" PRIMARY KEY("id"),
	CONSTRAINT "ck_o_notification_severity" CHECK ("o_notification"."severity" in ('info', 'success', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "o_report_delivery" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"schedule_id" uuid,
	"export_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "pk_o_report_delivery" PRIMARY KEY("id"),
	CONSTRAINT "uq_o_report_delivery_once" UNIQUE("export_id","recipient"),
	CONSTRAINT "ck_o_report_delivery_status" CHECK ("o_report_delivery"."status" in ('queued', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "o_report_export" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"size_bytes" integer,
	"content" "bytea",
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_by" text,
	"schedule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "pk_o_report_export" PRIMARY KEY("id"),
	CONSTRAINT "uq_o_report_export_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_o_report_export_kind" CHECK ("o_report_export"."kind" in ('profit_loss', 'products', 'orders', 'marketing', 'expenses')),
	CONSTRAINT "ck_o_report_export_format" CHECK ("o_report_export"."format" in ('csv', 'pdf')),
	CONSTRAINT "ck_o_report_export_status" CHECK ("o_report_export"."status" in ('queued', 'running', 'ready', 'failed')),
	CONSTRAINT "ck_o_report_export_period" CHECK ("o_report_export"."period_to" >= "o_report_export"."period_from")
);
--> statement-breakpoint
CREATE TABLE "s_report_schedule" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"frequency" text NOT NULL,
	"weekday" integer,
	"hour" integer NOT NULL,
	"recipients" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_period_end" date,
	"last_run_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pk_s_report_schedule" PRIMARY KEY("id"),
	CONSTRAINT "uq_s_report_schedule_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_s_report_schedule_kind" CHECK ("s_report_schedule"."kind" in ('profit_loss', 'products', 'orders', 'marketing', 'expenses')),
	CONSTRAINT "ck_s_report_schedule_format" CHECK ("s_report_schedule"."format" in ('csv', 'pdf')),
	CONSTRAINT "ck_s_report_schedule_when" CHECK ("s_report_schedule"."hour" between 0 and 23 and (
        ("s_report_schedule"."frequency" = 'weekly' and "s_report_schedule"."weekday" between 0 and 6)
        or ("s_report_schedule"."frequency" = 'monthly' and "s_report_schedule"."weekday" is null))),
	CONSTRAINT "ck_s_report_schedule_recipients" CHECK (cardinality("s_report_schedule"."recipients") between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "o_notification" ADD CONSTRAINT "fk_o_notification_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "o_report_delivery" ADD CONSTRAINT "fk_o_report_delivery_export" FOREIGN KEY ("tenant_id","export_id") REFERENCES "public"."o_report_export"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "o_report_export" ADD CONSTRAINT "fk_o_report_export_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s_report_schedule" ADD CONSTRAINT "fk_s_report_schedule_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_o_notification_dedupe" ON "o_notification" USING btree ("shop_id","dedupe_key") WHERE "o_notification"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_o_notification_shop" ON "o_notification" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_o_report_delivery_shop" ON "o_report_delivery" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_o_report_export_shop" ON "o_report_export" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_s_report_schedule_shop" ON "s_report_schedule" USING btree ("shop_id");