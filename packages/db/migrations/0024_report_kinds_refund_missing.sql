-- Two more report kinds: refunds and missing product costs. The kind lists on exports and schedules
-- are widened; nothing is removed, so every existing row stays valid.
ALTER TABLE "o_report_export" DROP CONSTRAINT "ck_o_report_export_kind";--> statement-breakpoint
ALTER TABLE "o_report_export" ADD CONSTRAINT "ck_o_report_export_kind" CHECK ("o_report_export"."kind" in ('profit_loss', 'products', 'orders', 'marketing', 'expenses', 'refunds', 'missing_costs'));--> statement-breakpoint
ALTER TABLE "s_report_schedule" DROP CONSTRAINT "ck_s_report_schedule_kind";--> statement-breakpoint
ALTER TABLE "s_report_schedule" ADD CONSTRAINT "ck_s_report_schedule_kind" CHECK ("s_report_schedule"."kind" in ('profit_loss', 'products', 'orders', 'marketing', 'expenses', 'refunds', 'missing_costs'));
