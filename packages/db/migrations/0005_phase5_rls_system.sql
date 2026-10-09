-- Webhook events: tenant isolation like every other tenant table.
GRANT SELECT, INSERT, UPDATE, DELETE ON o_webhook_event TO app_user;
--> statement-breakpoint
ALTER TABLE o_webhook_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE o_webhook_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON o_webhook_event FOR ALL TO app_user
	USING (tenant_id = app_current_tenant())
	WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint

-- System context: a small, read-mostly escape hatch for background maintenance that has to look
-- across tenants (nightly reconcile lists active shops; retention deletes old webhook events).
-- It is set with set_config('app.system', 'on', true) and only the worker's scheduler code path
-- does so. It grants no write access to business data.
CREATE FUNCTION app_system_enabled() RETURNS boolean
	LANGUAGE sql STABLE
	AS $$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_system_enabled() TO app_user;
--> statement-breakpoint
CREATE POLICY p_system_list ON m_shop FOR SELECT TO app_user
	USING (app_system_enabled());
--> statement-breakpoint
CREATE POLICY p_system_select ON o_webhook_event FOR SELECT TO app_user
	USING (app_system_enabled());
--> statement-breakpoint
CREATE POLICY p_system_delete ON o_webhook_event FOR DELETE TO app_user
	USING (app_system_enabled());
