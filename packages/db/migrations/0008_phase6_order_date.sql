ALTER TABLE "f_order_profit" ADD COLUMN "order_date" date NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_f_order_profit_shop_date" ON "f_order_profit" USING btree ("shop_id","order_date");