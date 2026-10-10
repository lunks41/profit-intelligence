-- Access token for a connected ad account (Meta or Google), encrypted at rest. Manual accounts leave it empty.
ALTER TABLE "f_ad_account" ADD COLUMN "encrypted_access_token" text;
