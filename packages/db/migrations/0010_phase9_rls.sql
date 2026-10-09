-- Phase 9 tables: forced Row Level Security with a tenant-isolation policy on every table.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY[
		'f_expense_category', 'f_expense', 'f_expense_override', 'f_ad_account', 'f_ad_spend_daily'
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

-- Categories and accounts are editable (rename, archive). Overrides and daily spend are replaced by
-- upsert.
GRANT SELECT, INSERT, UPDATE, DELETE ON f_expense_category, f_expense_override, f_ad_account, f_ad_spend_daily TO app_user;
--> statement-breakpoint

-- Expenses are append-only for their amount, name, dates and category: a change ends the old row and
-- adds a new one. Only the end date and the revoke marker may change. DELETE exists only for the
-- privacy purge of a whole shop.
GRANT SELECT, INSERT, DELETE ON f_expense TO app_user;
--> statement-breakpoint
GRANT UPDATE (end_date, revoked_at) ON f_expense TO app_user;
