-- Monitoring counts problems across all shops (stale imports, failed jobs, stuck work). System
-- context may read these tables, and only read them; it never sees another table's rows.
CREATE POLICY p_system_list ON o_sync_job FOR SELECT TO app_user
	USING (app_system_enabled());
--> statement-breakpoint
CREATE POLICY p_system_list ON o_report_delivery FOR SELECT TO app_user
	USING (app_system_enabled());
