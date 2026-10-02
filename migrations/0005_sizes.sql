-- Size guide for clothing: a table (JSON: {"columns": [...], "rows": [[...], ...]}, first column = size name)
-- and an optional size-chart photo. When a product has sizes, the wishlist owner picks one.
ALTER TABLE products ADD COLUMN size_guide TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN size_guide_image TEXT NOT NULL DEFAULT '';
ALTER TABLE wishlist_items ADD COLUMN size TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN size TEXT NOT NULL DEFAULT '';
