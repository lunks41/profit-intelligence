-- More standard expense categories, so a merchant starts with a fuller list. Added once to every shop that already
-- has categories; a shop without any gets the whole standard set the first time it opens Expenses. A name the shop
-- already has is left alone.
INSERT INTO "f_expense_category" ("tenant_id", "shop_id", "name", "class")
SELECT s."tenant_id", s."id", n."name", n."class"
FROM "m_shop" s
CROSS JOIN (VALUES
  ('Accounting and legal', 'operating'),
  ('Bank charges', 'operating'),
  ('Equipment', 'operating'),
  ('Insurance', 'operating'),
  ('Office supplies', 'operating'),
  ('Packaging', 'logistics'),
  ('Repairs and maintenance', 'operating'),
  ('Shipping and logistics', 'logistics'),
  ('Taxes and licences', 'operating'),
  ('Training and travel', 'operating'),
  ('Utilities', 'operating')
) AS n("name", "class")
WHERE EXISTS (SELECT 1 FROM "f_expense_category" c WHERE c."shop_id" = s."id")
ON CONFLICT DO NOTHING;
