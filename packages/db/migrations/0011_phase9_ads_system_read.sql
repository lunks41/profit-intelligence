-- The daily advertising sync has to list ad accounts across shops. System context may read them
-- (no write access); every write still goes through the tenant policy.
CREATE POLICY p_system_list ON f_ad_account FOR SELECT TO app_user
	USING (app_system_enabled());
