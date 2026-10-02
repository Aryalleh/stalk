-- Accounts connected to the site's Bale/Telegram bot (required after sign-up when a bot is set up).
ALTER TABLE users ADD COLUMN bale_chat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN telegram_chat_id TEXT NOT NULL DEFAULT '';

-- One-time codes carried in the bot deep link (?start=<token>) to tie a chat to an account.
CREATE TABLE connect_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX connect_tokens_user ON connect_tokens(user_id);

-- Shop: city, delivery options and social links.
ALTER TABLE shops ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN courier_enabled INTEGER NOT NULL DEFAULT 0; -- پیک: same city only
ALTER TABLE shops ADD COLUMN courier_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN post_enabled INTEGER NOT NULL DEFAULT 1;    -- پست: any city
ALTER TABLE shops ADD COLUMN post_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN instagram TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN telegram TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN bale TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN website TEXT NOT NULL DEFAULT '';

-- Recipient city decides which delivery methods a giver can choose.
ALTER TABLE wishlists ADD COLUMN city TEXT NOT NULL DEFAULT '';

-- Products: a video link and several photos (products.image_key stays the cover for listings).
ALTER TABLE products ADD COLUMN video_url TEXT NOT NULL DEFAULT '';
CREATE TABLE product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_key TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product ON product_images(product_id, sort);
INSERT INTO product_images (product_id, image_key, sort) SELECT id, image_key, 0 FROM products WHERE image_key <> '';

-- Gift-wrap packages per product, each with its own price.
CREATE TABLE product_packages (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX product_packages_product ON product_packages(product_id, sort);

-- Orders: price breakdown (amount stays the total the giver pays).
ALTER TABLE orders ADD COLUMN item_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN package_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN package_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT '';  -- 'courier' | 'post'
ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN ship_city TEXT NOT NULL DEFAULT '';
UPDATE orders SET item_price = amount WHERE item_price = 0;

-- Bring existing site users into the CRM (new ones are added as they sign up).
INSERT INTO contacts (first_name, last_name, phone, notes, created_at, updated_at, created_by)
SELECT
  CASE WHEN instr(trim(u.name), ' ') > 0 THEN substr(trim(u.name), 1, instr(trim(u.name), ' ') - 1) ELSE trim(u.name) END,
  CASE WHEN instr(trim(u.name), ' ') > 0 THEN trim(substr(trim(u.name), instr(trim(u.name), ' ') + 1)) ELSE '' END,
  u.phone, 'کاربر سایت', u.created_at, u.created_at, NULL
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.phone = u.phone OR c.phone2 = u.phone);

INSERT INTO change_log (contact_id, contact_repr, field_name, field_label, action, old_value, new_value, user_id, username, changed_at)
SELECT c.id, trim(c.first_name || ' ' || c.last_name), f.field_name, f.field_label, 'create', '', f.value, NULL, 'سیستم', c.created_at
FROM contacts c
JOIN (
  SELECT id, '__contact__' AS field_name, 'مخاطب' AS field_label, '' AS value, 0 AS ord FROM contacts
  UNION ALL SELECT id, 'first_name', 'نام', first_name, 1 FROM contacts WHERE first_name <> ''
  UNION ALL SELECT id, 'last_name', 'نام خانوادگی', last_name, 2 FROM contacts WHERE last_name <> ''
  UNION ALL SELECT id, 'phone', 'شماره تماس', phone, 3 FROM contacts WHERE phone <> ''
  UNION ALL SELECT id, 'notes', 'یادداشت', notes, 4 FROM contacts WHERE notes <> ''
) f ON f.id = c.id
WHERE c.notes = 'کاربر سایت' AND NOT EXISTS (SELECT 1 FROM change_log l WHERE l.contact_id = c.id)
ORDER BY c.id, f.ord;
