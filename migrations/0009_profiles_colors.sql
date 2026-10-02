-- People: first and last name kept apart (users.name stays as "first last" for display), Jalali
-- birth date (YYYY-MM-DD), a unique username for the public profile at /u/<username>, and what
-- that profile shows.
ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN birth_date TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN show_received INTEGER NOT NULL DEFAULT 1; -- gifts received are listed on the profile
ALTER TABLE users ADD COLUMN show_givers INTEGER NOT NULL DEFAULT 1;   -- with the givers who agreed to be named
ALTER TABLE users ADD COLUMN show_birthday INTEGER NOT NULL DEFAULT 1; -- day and month only, never the year
UPDATE users SET
  first_name = CASE WHEN instr(trim(name), ' ') > 0 THEN substr(trim(name), 1, instr(trim(name), ' ') - 1) ELSE trim(name) END,
  last_name = CASE WHEN instr(trim(name), ' ') > 0 THEN trim(substr(trim(name), instr(trim(name), ' ') + 1)) ELSE '' END,
  username = 'user' || id;
CREATE UNIQUE INDEX users_username ON users(username);

-- The giver decides whether their name appears under the gift on the recipient's public profile.
ALTER TABLE orders ADD COLUMN show_on_profile INTEGER NOT NULL DEFAULT 0;

-- Colors: a product lists its colors (one per line); the wish and the order carry the chosen one,
-- and stock is kept per size + color.
ALTER TABLE products ADD COLUMN colors TEXT NOT NULL DEFAULT '';
ALTER TABLE wishlist_items ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN change_color TEXT NOT NULL DEFAULT '';
CREATE TABLE product_stock_v2 (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (product_id, size, color)
);
INSERT INTO product_stock_v2 (product_id, size, color, quantity) SELECT product_id, size, '', quantity FROM product_stock;
DROP TABLE product_stock;
ALTER TABLE product_stock_v2 RENAME TO product_stock;
DROP INDEX orders_product_size;
CREATE INDEX orders_variant ON orders(product_id, size, color, status);
