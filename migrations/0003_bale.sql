-- Bale account <-> phone links. Filled when someone shares their own contact with the site's
-- Bale bot, so the CRM (and shop notifications) can message them through the bot for free.
CREATE TABLE bale_links (
  phone TEXT PRIMARY KEY,              -- normalized 09xxxxxxxxx
  chat_id TEXT NOT NULL,
  bale_user_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL
);
CREATE INDEX bale_links_chat ON bale_links(chat_id);

-- One-time login codes sent through Bale Safir. Only a hash of the code is stored.
CREATE TABLE otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,         -- ms epoch
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL,
  window_start INTEGER NOT NULL,       -- start of the hourly send-limit window
  window_count INTEGER NOT NULL
);

-- Messages sent to CRM contacts.
CREATE TABLE crm_messages (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('bot', 'safir')),
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  username TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL
);
CREATE INDEX crm_messages_contact ON crm_messages(contact_id, sent_at);
