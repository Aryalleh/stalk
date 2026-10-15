-- Referral points: whoever signs up through someone's invite link (/f/<code>, the bots' f_<code>) is
-- recorded as invited by them; the inviter earns points as that person joins (1), makes a wishlist
-- with a gift (5) and opens a shop with 5 products (5). A ledger, so points can be cashed later.
ALTER TABLE users ADD COLUMN referred_by INTEGER;
CREATE INDEX users_referred_by ON users(referred_by);
CREATE TABLE points (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- who earned them
  referred_user_id INTEGER, -- for whom
  kind TEXT NOT NULL,       -- 'join' | 'wish' | 'shop'
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, referred_user_id, kind)
);
CREATE INDEX points_user ON points(user_id, created_at);
