-- Connecting an ad platform by signing in to it (OAuth) instead of pasting a token.
-- The account row keeps the refresh token and when the access token expires, so the daily job can renew it.
ALTER TABLE "f_ad_account" ADD COLUMN "encrypted_refresh_token" text;--> statement-breakpoint
ALTER TABLE "f_ad_account" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "f_ad_account" ADD COLUMN "connected_via" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "f_ad_account" ADD CONSTRAINT "ck_f_ad_account_connected_via" CHECK ("f_ad_account"."connected_via" in ('manual', 'token', 'oauth'));--> statement-breakpoint
UPDATE "f_ad_account" SET "connected_via" = 'token' WHERE "encrypted_access_token" IS NOT NULL;--> statement-breakpoint
-- After the merchant signs in to the platform, the tokens and the ad accounts they can see wait here
-- until they choose which accounts to use. A row lives for 30 minutes and is deleted once used.
CREATE TABLE "f_ad_connection_pending" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_f_ad_connection_pending" PRIMARY KEY("id"),
	CONSTRAINT "ck_f_ad_connection_pending_provider" CHECK ("f_ad_connection_pending"."provider" in ('meta', 'google', 'tiktok'))
);--> statement-breakpoint
ALTER TABLE "f_ad_connection_pending" ADD CONSTRAINT "fk_f_ad_connection_pending_shop" FOREIGN KEY ("tenant_id","shop_id") REFERENCES "public"."m_shop"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_f_ad_connection_pending_shop" ON "f_ad_connection_pending" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "f_ad_connection_pending" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "f_ad_connection_pending" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON "f_ad_connection_pending" FOR ALL TO app_user USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "f_ad_connection_pending" TO app_user;
