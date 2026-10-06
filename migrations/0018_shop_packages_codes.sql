-- Gift-wrap packages are set once per shop (not per product). Existing per-product packages move to
-- their shop (one row per name, at its highest price); product_packages stays for old data only.
CREATE TABLE shop_packages (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX shop_packages_shop ON shop_packages(shop_id, sort);
INSERT INTO shop_packages (shop_id, name, price, sort)
  SELECT p.shop_id, k.name, MAX(k.price), MIN(k.sort) FROM product_packages k JOIN products p ON p.id = k.product_id GROUP BY p.shop_id, k.name;
-- Public profile: "gave gifts to N people" (off unless the person turns it on).
ALTER TABLE users ADD COLUMN show_given_count INTEGER NOT NULL DEFAULT 0;
-- Product code in four parts, shop first: <shop>-xxxx-xxxx-xxxx (also the product's address /p/<code>).
ALTER TABLE products ADD COLUMN code TEXT NOT NULL DEFAULT '';
UPDATE products SET code =
  COALESCE(NULLIF(substr(replace(replace(lower((SELECT slug FROM shops s WHERE s.id = products.shop_id)), '-', ''), '_', ''), 1, 10), ''), 'shop')
  || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2)));
CREATE UNIQUE INDEX products_code ON products(code) WHERE code <> '';
