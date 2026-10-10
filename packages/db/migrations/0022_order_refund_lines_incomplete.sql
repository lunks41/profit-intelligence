-- Marks orders whose refund line items were only partly imported (Shopify returned more than one
-- page). Their product refunds may be understated until the order is fetched in full.
ALTER TABLE "t_order" ADD COLUMN "refund_lines_incomplete" boolean DEFAULT false NOT NULL;
