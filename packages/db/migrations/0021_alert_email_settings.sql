-- Email alerts: who should receive them (up to 5 addresses the merchant typed), and a mark on each
-- notification once it has been emailed, so a message is never sent twice.
ALTER TABLE "s_app_setting" ADD COLUMN "alert_email_recipients" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "s_app_setting" ADD CONSTRAINT "ck_s_app_setting_alert_emails" CHECK (cardinality("s_app_setting"."alert_email_recipients") <= 5);--> statement-breakpoint
ALTER TABLE "o_notification" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_o_notification_unemailed" ON "o_notification" USING btree ("shop_id","created_at") WHERE "o_notification"."emailed_at" is null;
