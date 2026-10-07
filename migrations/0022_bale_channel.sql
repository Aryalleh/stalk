-- A shop's Bale channel, like its Telegram channel: tagged posts become products, and the panel can
-- post products and the storefront there. Products imported from Bale keep "bale:<chat id>" in
-- tg_chat_id so they never clash with Telegram chat ids.
ALTER TABLE shops ADD COLUMN bale_channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN bale_channel_title TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN bale_channel_username TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN bale_last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN bale_shop_post_at TEXT;
ALTER TABLE products ADD COLUMN bale_shared_at TEXT;
