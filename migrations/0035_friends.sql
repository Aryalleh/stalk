-- Friends: each account has an invite code (links /f/<code>, and the bots' "?start=f_<code>"); whoever
-- opens it and accepts becomes a friend, both ways. Friends see each other's birthday (day and month)
-- and wishlists from the friends page.
ALTER TABLE users ADD COLUMN friend_code TEXT;
CREATE UNIQUE INDEX users_friend_code ON users(friend_code);
CREATE TABLE friendships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX friendships_friend ON friendships(friend_id);
