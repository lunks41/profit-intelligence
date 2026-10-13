-- A fourth plan, Basic, between Free and Growth.
ALTER TABLE "s_subscription" DROP CONSTRAINT "ck_s_subscription_plan";--> statement-breakpoint
ALTER TABLE "s_subscription" ADD CONSTRAINT "ck_s_subscription_plan" CHECK ("s_subscription"."plan" in ('free', 'basic', 'growth', 'pro'));
