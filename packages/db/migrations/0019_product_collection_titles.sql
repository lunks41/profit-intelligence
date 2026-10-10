-- Collection titles let a merchant set one product cost on every variant in a collection.
ALTER TABLE "t_product" ADD COLUMN "collection_titles" text[] DEFAULT '{}'::text[] NOT NULL;
