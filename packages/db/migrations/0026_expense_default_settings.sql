-- What a new expense starts as (one-time or recurring, monthly or yearly), set per shop in Settings.
ALTER TABLE "s_app_setting" ADD COLUMN "expense_default_kind" text DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "s_app_setting" ADD COLUMN "expense_default_frequency" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "s_app_setting" ADD CONSTRAINT "ck_s_app_setting_expense_defaults" CHECK ("s_app_setting"."expense_default_kind" in ('recurring', 'one_time') and "s_app_setting"."expense_default_frequency" in ('monthly', 'yearly'));
