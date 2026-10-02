-- Fields the new design (html/) shows: profile pictures, shop logo/cover, product category and key features.
ALTER TABLE users ADD COLUMN avatar_key TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN logo_key TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN cover_key TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN features TEXT NOT NULL DEFAULT ''; -- one per line
CREATE INDEX products_category ON products(category, is_active);
