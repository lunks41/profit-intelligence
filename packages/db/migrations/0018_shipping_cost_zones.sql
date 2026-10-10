-- Shipping cost rules can name a country and a weight band, and charge per kilogram.
-- Orders keep the destination country code (not an address) so a rule can be chosen.
-- Variants keep their weight in grams.
ALTER TABLE "s_shipping_cost_rule" ADD COLUMN "zone_name" text;--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" ADD COLUMN "countries" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" ADD COLUMN "weight_min_grams" integer;--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" ADD COLUMN "weight_max_grams" integer;--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" DROP CONSTRAINT "ck_s_shipping_cost_rule_mode";--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" ADD CONSTRAINT "ck_s_shipping_cost_rule_mode" CHECK (
	("s_shipping_cost_rule"."mode" = 'flat' and "s_shipping_cost_rule"."amount" is not null and "s_shipping_cost_rule"."amount" >= 0)
	or ("s_shipping_cost_rule"."mode" = 'percent_of_shipping_charged' and "s_shipping_cost_rule"."percent" is not null and "s_shipping_cost_rule"."percent" >= 0 and "s_shipping_cost_rule"."percent" <= 1000)
	or ("s_shipping_cost_rule"."mode" = 'per_kilogram' and "s_shipping_cost_rule"."amount" is not null and "s_shipping_cost_rule"."amount" >= 0)
);--> statement-breakpoint
ALTER TABLE "s_shipping_cost_rule" ADD CONSTRAINT "ck_s_shipping_cost_rule_weight" CHECK (
	("s_shipping_cost_rule"."weight_min_grams" is null or "s_shipping_cost_rule"."weight_min_grams" >= 0)
	and ("s_shipping_cost_rule"."weight_max_grams" is null or "s_shipping_cost_rule"."weight_max_grams" > 0)
	and ("s_shipping_cost_rule"."weight_min_grams" is null or "s_shipping_cost_rule"."weight_max_grams" is null or "s_shipping_cost_rule"."weight_min_grams" < "s_shipping_cost_rule"."weight_max_grams")
);--> statement-breakpoint
DROP INDEX "uq_s_shipping_cost_rule_active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_s_shipping_cost_rule_active" ON "s_shipping_cost_rule" USING btree ("shop_id", coalesce("zone_name", ''), "countries", coalesce("weight_min_grams", -1), coalesce("weight_max_grams", -1), "effective_from") WHERE "s_shipping_cost_rule"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "t_order" ADD COLUMN "ship_country" char(2);--> statement-breakpoint
ALTER TABLE "t_order" ADD CONSTRAINT "ck_t_order_ship_country" CHECK ("ship_country" is null or "ship_country" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "t_product_variant" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "t_product_variant" ADD CONSTRAINT "ck_t_product_variant_weight" CHECK ("weight_grams" is null or "weight_grams" >= 0);
