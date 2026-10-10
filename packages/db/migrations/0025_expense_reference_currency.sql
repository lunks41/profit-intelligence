-- Expenses: a reference and a description, the amount as typed in another currency (converted once to
-- the shop currency at the rate of the expense date, with the rate kept), and a class on every
-- category so costs that overlap with order-level profit can be told apart. Additive only.
ALTER TABLE "f_expense" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "f_expense" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "f_expense" ADD COLUMN "original_amount" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "f_expense" ADD COLUMN "original_currency" char(3);--> statement-breakpoint
ALTER TABLE "f_expense" ADD COLUMN "fx_rate" numeric(18, 10);--> statement-breakpoint
ALTER TABLE "f_expense" ADD COLUMN "fx_rate_date" date;--> statement-breakpoint
ALTER TABLE "f_expense" ADD COLUMN "fx_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "f_expense" ADD CONSTRAINT "ck_f_expense_reference" CHECK ("f_expense"."reference" is null or length(btrim("f_expense"."reference")) between 1 and 60);--> statement-breakpoint
ALTER TABLE "f_expense" ADD CONSTRAINT "ck_f_expense_description" CHECK ("f_expense"."description" is null or length(btrim("f_expense"."description")) between 1 and 500);--> statement-breakpoint
ALTER TABLE "f_expense" ADD CONSTRAINT "ck_f_expense_foreign" CHECK (("f_expense"."original_amount" is null) = ("f_expense"."original_currency" is null) and ("f_expense"."original_amount" is null) = ("f_expense"."fx_rate" is null));--> statement-breakpoint
ALTER TABLE "f_expense_category" ADD COLUMN "class" text DEFAULT 'operating' NOT NULL;--> statement-breakpoint
ALTER TABLE "f_expense_category" ADD CONSTRAINT "ck_f_expense_category_class" CHECK ("f_expense_category"."class" in ('product', 'logistics', 'advertising', 'operating'));--> statement-breakpoint
UPDATE "f_expense_category" SET "class" = CASE
  WHEN lower("name") ~ '(market|advert|promo|influenc)' THEN 'advertising'
  WHEN lower("name") ~ '(shipping|logistic|courier|warehous|packag|fulfil|customs|freight)' THEN 'logistics'
  WHEN lower("name") ~ '(product|inventory|supplier|procure|stock|purchase)' THEN 'product'
  ELSE 'operating' END;
