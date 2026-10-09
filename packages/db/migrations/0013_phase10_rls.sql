-- Phase 10 tables: forced Row Level Security with a tenant-isolation policy on every table.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY[
		'o_report_export', 's_report_schedule', 'o_report_delivery', 'o_notification'
	] LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
		EXECUTE format(
			'CREATE POLICY p_tenant_isolation ON %I FOR ALL TO app_user USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
			t
		);
	END LOOP;
END
$$;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON o_report_export, o_report_delivery, o_notification TO app_user;
--> statement-breakpoint

-- Schedules are edited by the merchant (enable, change recipients) and soft-deleted.
GRANT SELECT, INSERT, UPDATE, DELETE ON s_report_schedule TO app_user;
--> statement-breakpoint

-- System context (the worker's scheduler and retention job) may look across shops: list schedules
-- that are due, and delete expired export files. Everything else goes through the tenant policy.
CREATE POLICY p_system_list ON s_report_schedule FOR SELECT TO app_user
	USING (app_system_enabled());
--> statement-breakpoint
CREATE POLICY p_system_delete ON o_report_export FOR DELETE TO app_user
	USING (app_system_enabled());
--> statement-breakpoint
CREATE POLICY p_system_select ON o_report_export FOR SELECT TO app_user
	USING (app_system_enabled());
