-- People who add wishes by sending Instagram posts to the site's Instagram account: their id in
-- those DMs, linked to their site account with a code (sent from the site) or a one-time link
-- (sent to them in the DM).
ALTER TABLE users ADD COLUMN ig_user_id TEXT;
ALTER TABLE users ADD COLUMN ig_username TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX users_ig_user ON users(ig_user_id) WHERE ig_user_id IS NOT NULL;
CREATE TABLE ig_link_codes (
  code TEXT PRIMARY KEY,          -- KD-123456, shown on the site, sent in the DM
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE ig_link_tokens (
  token_hash TEXT PRIMARY KEY,    -- SHA-256 of the token in the link sent in the DM
  igsid TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  post_url TEXT NOT NULL DEFAULT '', -- the post they sent, added once they link
  expires_at INTEGER NOT NULL
);
