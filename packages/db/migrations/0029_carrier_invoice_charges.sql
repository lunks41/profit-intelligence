-- What a carrier really charged for the shipping of an order, from the carrier's invoice file (DHL, UPS, FedEx,
-- Amazon Shipping or another). One invoice row per imported file, one charge row per order it covers. A charge
-- replaces the rule-based estimate of the shipping cost of that order. An invoice can be taken back (revoked_at), and
-- its orders then go back to the estimate.
CREATE TABLE "f_carrier_invoice" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"file_name" text,
	"file_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"matched_orders" integer NOT NULL,
	"unmatched_rows" integer NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "pk_f_carrier_invoice" PRIMARY KEY("id"),
	CONSTRAINT "uq_f_carrier_invoice_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_f_carrier_invoice_carrier" CHECK ("f_carrier_invoice"."carrier" in ('dhl', 'ups', 'fedex', 'amazon', 'other'))
);--> statement-breakpoint
ALTER TABLE "f_carrier_invoice" ADD CONSTRAINT "fk_f_carrier_invoice_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_f_carrier_invoice_shop" ON "f_carrier_invoice" USING btree ("shop_id","created_at");--> statement-breakpoint
-- the same file cannot be imported twice while the first import stands
CREATE UNIQUE INDEX "uq_f_carrier_invoice_file" ON "f_carrier_invoice" USING btree ("shop_id","file_hash") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE TABLE "f_carrier_charge" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"reference" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"charge_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_f_carrier_charge" PRIMARY KEY("id")
);--> statement-breakpoint
ALTER TABLE "f_carrier_charge" ADD CONSTRAINT "fk_f_carrier_charge_invoice" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."f_carrier_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f_carrier_charge" ADD CONSTRAINT "fk_f_carrier_charge_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."t_order"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_f_carrier_charge_order" ON "f_carrier_charge" USING btree ("shop_id","order_id");--> statement-breakpoint
CREATE INDEX "ix_f_carrier_charge_invoice" ON "f_carrier_charge" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "f_carrier_invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "f_carrier_invoice" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON "f_carrier_invoice" FOR ALL TO app_user USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "f_carrier_charge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "f_carrier_charge" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON "f_carrier_charge" FOR ALL TO app_user USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "f_carrier_invoice" TO app_user;--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoked_by") ON "f_carrier_invoice" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "f_carrier_charge" TO app_user;
