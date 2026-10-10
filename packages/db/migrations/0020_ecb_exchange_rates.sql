-- Daily euro reference rates from the European Central Bank. This is public market data with no
-- shop, tenant or customer information in it, so it is the one table (besides the tenant table)
-- that carries no tenant id: every shop reads the same rates. Reading is open to the application
-- role; only background (system) work may add or update rows, and nothing can delete them.
CREATE TABLE "o_exchange_rate" (
	"quote" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(19, 10) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_o_exchange_rate" PRIMARY KEY("quote","rate_date"),
	CONSTRAINT "ck_o_exchange_rate_quote" CHECK ("o_exchange_rate"."quote" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ck_o_exchange_rate_positive" CHECK ("o_exchange_rate"."rate" > 0)
);--> statement-breakpoint
ALTER TABLE "o_exchange_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "o_exchange_rate" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON o_exchange_rate TO app_user;--> statement-breakpoint
CREATE POLICY p_public_read ON o_exchange_rate FOR SELECT TO app_user
	USING (true);--> statement-breakpoint
CREATE POLICY p_system_insert ON o_exchange_rate FOR INSERT TO app_user
	WITH CHECK (app_system_enabled());--> statement-breakpoint
CREATE POLICY p_system_update ON o_exchange_rate FOR UPDATE TO app_user
	USING (app_system_enabled()) WITH CHECK (app_system_enabled());
