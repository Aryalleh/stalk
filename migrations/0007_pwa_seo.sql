-- "Buy for myself": a hidden, single-use list that carries the buyer's own delivery address.
ALTER TABLE wishlists ADD COLUMN is_direct INTEGER NOT NULL DEFAULT 0;

-- A Bale/Telegram mini-app chat waiting to be linked to whoever signs in next in that browser.
CREATE TABLE miniapp_pending (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
