-- Anonymous messages across Bale, Telegram and the site: a message goes to every chat its
-- recipient connected (and their inbox on the site, /me/anon), and an answer goes back to every
-- chat of the sender. Messages are grouped in conversations (root_id) and each delivered copy is
-- remembered (anon_landings) so a reply in any chat finds its way back. Admins read conversations
-- at /admin/anon.
ALTER TABLE anon_messages ADD COLUMN from_user_id INTEGER; -- the sender's account, when they have one
ALTER TABLE anon_messages ADD COLUMN recipient_id INTEGER; -- the account it went to, when it went to one
ALTER TABLE anon_messages ADD COLUMN reply_to INTEGER;     -- the message it answers
ALTER TABLE anon_messages ADD COLUMN root_id INTEGER;      -- the conversation's first message
CREATE TABLE anon_landings (
  message_id INTEGER NOT NULL REFERENCES anon_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  chat TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  PRIMARY KEY (kind, chat, msg_id)
);
CREATE INDEX anon_landings_message ON anon_landings(message_id);
INSERT OR IGNORE INTO anon_landings (message_id, kind, chat, msg_id) SELECT id, to_kind, to_chat, to_msg_id FROM anon_messages WHERE to_msg_id <> '';
UPDATE anon_messages SET
  root_id = id,
  from_user_id = (SELECT u.id FROM users u WHERE (from_kind = 'bale' AND u.bale_chat_id = from_chat) OR (from_kind = 'telegram' AND u.telegram_chat_id = from_chat) LIMIT 1),
  recipient_id = COALESCE(to_user_id, (SELECT u.id FROM users u WHERE (to_kind = 'bale' AND u.bale_chat_id = to_chat) OR (to_kind = 'telegram' AND u.telegram_chat_id = to_chat) LIMIT 1));
CREATE INDEX anon_messages_root ON anon_messages(root_id, id);
CREATE INDEX anon_messages_from_user ON anon_messages(from_user_id, created_at);
CREATE INDEX anon_messages_recipient ON anon_messages(recipient_id, created_at);
