-- One-time links that sign an Instagram page into its shop's web panel (sent in its DM).
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,   -- SHA-256 of the token in the link
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL    -- ms since epoch
);
