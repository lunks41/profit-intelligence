-- A pseudonymous key of the customer on each order (a one-way hash of Shopify's customer id; no name, email or
-- address), used only to group orders by customer for lifetime value. Null for guest checkouts and older orders
-- until they are imported again.
ALTER TABLE "t_order" ADD COLUMN "customer_key" char(32);--> statement-breakpoint
ALTER TABLE "t_order" ADD CONSTRAINT "ck_t_order_customer_key" CHECK ("t_order"."customer_key" is null or "t_order"."customer_key" ~ '^[0-9a-f]{32}$');--> statement-breakpoint
CREATE INDEX "ix_t_order_shop_customer" ON "t_order" USING btree ("tenant_id","shop_id","customer_key") WHERE "t_order"."customer_key" is not null;
