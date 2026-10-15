-- Who is behind a Bale / Telegram chat (name, @username, the messenger's numeric user id), kept up to
-- date from every message the bots get; anonymous messages also keep the sender's as it was when sent,
-- so admins can tell who wrote even when they have no account on the site (/admin/anon).
CREATE TABLE bot_profiles (
  kind TEXT NOT NULL,
  chat TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, chat)
);
ALTER TABLE anon_messages ADD COLUMN from_name TEXT NOT NULL DEFAULT '';
ALTER TABLE anon_messages ADD COLUMN from_username TEXT NOT NULL DEFAULT '';
ALTER TABLE anon_messages ADD COLUMN from_uid TEXT NOT NULL DEFAULT '';
-- Older messages: in a private chat the chat id is the person's user id.
UPDATE anon_messages SET from_uid = from_chat WHERE from_kind IN ('bale', 'telegram');
