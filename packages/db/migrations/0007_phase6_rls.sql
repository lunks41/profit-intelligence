-- Phase 6 tables: forced Row Level Security with a tenant-isolation policy on every table.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY[
		'f_product_cost', 's_payment_fee_rule', 's_shipping_cost_rule', 's_app_setting',
		'a_audit_log', 'f_profit_entry', 'f_order_profit'
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

-- Calculated results: full DML (replaced on every recalculation).
GRANT SELECT, INSERT, UPDATE, DELETE ON f_profit_entry, f_order_profit TO app_user;
--> statement-breakpoint
-- Settings: editable.
GRANT SELECT, INSERT, UPDATE, DELETE ON s_app_setting TO app_user;
--> statement-breakpoint

-- Merchant cost data is append-only: new rows can be added and old rows revoked, but an amount or
-- an effective date can never be edited. DELETE exists only for the privacy purge of a whole shop.
GRANT SELECT, INSERT, DELETE ON f_product_cost, s_payment_fee_rule, s_shipping_cost_rule TO app_user;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by) ON f_product_cost TO app_user;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON s_payment_fee_rule, s_shipping_cost_rule TO app_user;
--> statement-breakpoint

-- The audit log is never updated.
GRANT SELECT, INSERT, DELETE ON a_audit_log TO app_user;
