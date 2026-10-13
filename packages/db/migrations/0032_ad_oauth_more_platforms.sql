-- Microsoft Ads, Snapchat, Pinterest and Reddit join Meta, Google and TikTok as platforms the merchant can sign in to.
ALTER TABLE "f_ad_connection_pending" DROP CONSTRAINT "ck_f_ad_connection_pending_provider";--> statement-breakpoint
ALTER TABLE "f_ad_connection_pending" ADD CONSTRAINT "ck_f_ad_connection_pending_provider" CHECK ("f_ad_connection_pending"."provider" in ('meta', 'google', 'tiktok', 'microsoft', 'snapchat', 'pinterest', 'reddit'));
