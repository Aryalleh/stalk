-- Public pages (profile, wishlists) show a nickname instead of the real first and last name.
ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
-- Posts the shop sent to its Telegram channel from the panel (separate from products imported from
-- channel posts, so the importer never treats them as its own).
ALTER TABLE products ADD COLUMN tg_shared_chat TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN tg_shared_message INTEGER;
ALTER TABLE products ADD COLUMN tg_shared_at TEXT;
ALTER TABLE shops ADD COLUMN tg_shop_post_at TEXT;
