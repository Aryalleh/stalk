-- Anonymous messages through the site's Bale / Telegram bots: each user has a link
-- (?start=a_<code>); whoever opens it can write to them without their name showing; the recipient
-- can answer (still anonymous), block or report. Everything goes between chats, so senders need no
-- account. The bot (and the site's admins, on a report) still know who sent what.
ALTER TABLE users ADD COLUMN anon_code TEXT;
ALTER TABLE users ADD COLUMN anon_enabled INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX users_anon_code ON users(anon_code);
-- What a chat's next message is for: a new message to someone, or an answer to a received one.
CREATE TABLE anon_state (
  kind TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_chat TEXT NOT NULL,
  to_user_id INTEGER, -- a new message to this user (from their link)
  reply_to INTEGER,   -- an answer to anon_messages.id
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, chat_id)
);
-- Each delivered message: where it landed (to find the way back when it's answered) and who sent it.
CREATE TABLE anon_messages (
  id INTEGER PRIMARY KEY,
  from_kind TEXT NOT NULL,
  from_chat TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_chat TEXT NOT NULL,
  to_msg_id TEXT NOT NULL DEFAULT '',
  to_user_id INTEGER, -- the link's owner, for a first message
  body TEXT NOT NULL DEFAULT '', -- the text (for a report)
  created_at INTEGER NOT NULL
);
CREATE INDEX anon_messages_landed ON anon_messages(to_kind, to_chat, to_msg_id);
CREATE INDEX anon_messages_sender ON anon_messages(from_kind, from_chat, created_at);
CREATE TABLE anon_blocks (
  blocker_kind TEXT NOT NULL,
  blocker_chat TEXT NOT NULL,
  blocked_kind TEXT NOT NULL,
  blocked_chat TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_kind, blocker_chat, blocked_kind, blocked_chat)
);
