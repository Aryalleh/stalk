-- Shops connect their Telegram channel to the site's bot: tagged photo posts become products, and
-- the bot adds "buy / add to wishlist" buttons under them.

ALTER TABLE shops ADD COLUMN tg_channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN tg_channel_title TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN tg_channel_username TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN tg_link_code TEXT NOT NULL DEFAULT '';  -- posted in the channel once to connect it
ALTER TABLE shops ADD COLUMN tg_tag TEXT NOT NULL DEFAULT '#محصول';   -- posts carrying this hashtag become products
ALTER TABLE shops ADD COLUMN tg_buttons INTEGER NOT NULL DEFAULT 1;   -- add buy / wishlist buttons under posts
ALTER TABLE shops ADD COLUMN tg_last_error TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX shops_tg_channel ON shops(tg_channel_id) WHERE tg_channel_id <> '';

ALTER TABLE products ADD COLUMN tg_chat_id TEXT;
ALTER TABLE products ADD COLUMN tg_message_id INTEGER;
ALTER TABLE products ADD COLUMN tg_media_group TEXT;
ALTER TABLE products ADD COLUMN tg_photo_uid TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX products_tg_post ON products(tg_chat_id, tg_message_id) WHERE tg_chat_id IS NOT NULL;
CREATE INDEX products_tg_group ON products(tg_chat_id, tg_media_group);

-- Album photos that arrive before the captioned post of the same album has made the product.
CREATE TABLE tg_album_photos (
  chat_id TEXT NOT NULL,
  media_group TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX tg_album_group ON tg_album_photos(chat_id, media_group);
