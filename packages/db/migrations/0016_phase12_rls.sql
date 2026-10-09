-- Phase 12 tables: forced Row Level Security with a tenant-isolation policy on every table.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['s_subscription', 'o_feedback'] LOOP
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

-- The subscription row is replaced when Shopify reports a change.
GRANT SELECT, INSERT, UPDATE, DELETE ON s_subscription TO app_user;
--> statement-breakpoint

-- Feedback is append-only for its content; only its status moves. DELETE exists only for the
-- privacy purge of a whole shop.
GRANT SELECT, INSERT, DELETE ON o_feedback TO app_user;
--> statement-breakpoint
GRANT UPDATE (status) ON o_feedback TO app_user;
