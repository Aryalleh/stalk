-- Instagram: account username / token refresh time, reels & posts linked to products (comment →
-- public reply + private DM), and every comment received (idempotency and stats).

ALTER TABLE shops ADD COLUMN ig_username TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN ig_token_refreshed_at TEXT;

CREATE TABLE ig_media_links (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  media_id TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  permalink TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  thumb TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',   -- comma separated; '' = every comment
  comment_reply TEXT NOT NULL DEFAULT '', -- public reply under the comment ('' = none)
  dm_text TEXT NOT NULL DEFAULT '',    -- private reply in Direct ({name} {title} {price} {link})
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (shop_id, media_id)
);

CREATE TABLE ig_comments (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  comment_id TEXT NOT NULL UNIQUE,
  media_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  action TEXT NOT NULL DEFAULT 'none', -- none / dm / repeat / error
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ig_comments_media ON ig_comments(shop_id, media_id, ig_user_id);
CREATE INDEX ig_comments_shop ON ig_comments(shop_id, created_at);
