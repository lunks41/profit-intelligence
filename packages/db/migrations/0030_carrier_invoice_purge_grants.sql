-- Erasing a shop (uninstall, or a request from Shopify) deletes its carrier invoices and charges too.
GRANT DELETE ON "f_carrier_charge" TO app_user;--> statement-breakpoint
GRANT DELETE ON "f_carrier_invoice" TO app_user;
