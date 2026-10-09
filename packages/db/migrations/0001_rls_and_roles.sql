-- Application role: no login until configured by `pnpm db:roles`; never superuser, never BYPASSRLS.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
		CREATE ROLE app_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
	END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint

-- Context helpers. The tenant / shop domain are set per transaction with set_config(..., true).
-- An unset or empty setting yields NULL, so policies match nothing (fail closed).
CREATE FUNCTION app_current_tenant() RETURNS uuid
	LANGUAGE sql STABLE
	AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_current_shop_domain() RETURNS text
	LANGUAGE sql STABLE
	AS $$ SELECT nullif(current_setting('app.shop_domain', true), '') $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_shop_domain() TO app_user;
--> statement-breakpoint

-- Table privileges (explicit per table; add a GRANT in every migration that creates a table).
GRANT SELECT, INSERT, UPDATE, DELETE ON m_tenant, m_shop, s_shop_credential TO app_user;
--> statement-breakpoint

-- Row Level Security. FORCE applies the policies to the table owner as well.
ALTER TABLE m_tenant ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE m_tenant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON m_tenant FOR ALL TO app_user
	USING (id = app_current_tenant())
	WITH CHECK (id = app_current_tenant());
--> statement-breakpoint

ALTER TABLE m_shop ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE m_shop FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON m_shop FOR ALL TO app_user
	USING (tenant_id = app_current_tenant())
	WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Bootstrap lookup: authentication resolves tenant_id from a cryptographically verified shop
-- domain (session token or webhook HMAC) before a tenant context exists. Read-only.
CREATE POLICY p_domain_lookup ON m_shop FOR SELECT TO app_user
	USING (shopify_domain = app_current_shop_domain());
--> statement-breakpoint

ALTER TABLE s_shop_credential ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE s_shop_credential FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p_tenant_isolation ON s_shop_credential FOR ALL TO app_user
	USING (tenant_id = app_current_tenant())
	WITH CHECK (tenant_id = app_current_tenant());
