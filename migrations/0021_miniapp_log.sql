-- Mini-app sign-in attempts (Bale / Telegram): result and reason, for the admin settings page.
CREATE TABLE miniapp_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',     -- bale | telegram | '' (unknown)
  result TEXT NOT NULL,              -- signed_in | linked | needs_login | failed | client_error
  detail TEXT NOT NULL DEFAULT '',   -- why it failed (per bot), or the browser-side error
  chat_id TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX miniapp_log_at ON miniapp_log(at);
