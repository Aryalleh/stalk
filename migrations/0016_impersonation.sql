-- Platform admins can sign in as a user (to see and fix things as they do); every time is recorded.
CREATE TABLE IF NOT EXISTS impersonations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS impersonations_started ON impersonations (started_at);
