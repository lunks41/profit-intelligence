-- Grants, forced Row Level Security and a tenant-isolation policy for every Phase 4 table.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY[
		't_product', 't_product_variant', 't_order', 't_order_line_item',
		't_refund', 't_refund_line_item', 't_order_transaction', 'o_sync_job'
	] LOOP
		EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
		EXECUTE format(
			'CREATE POLICY p_tenant_isolation ON %I FOR ALL TO app_user USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
			t
		);
	END LOOP;
END
$$;
