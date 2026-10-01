CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  father_name TEXT NOT NULL DEFAULT '',
  national_code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone2 TEXT NOT NULL DEFAULT '',
  father_phone TEXT NOT NULL DEFAULT '',
  telegram_id TEXT NOT NULL DEFAULT '',
  instagram_id TEXT NOT NULL DEFAULT '',
  twitter_id TEXT NOT NULL DEFAULT '',
  bale_id TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER
);
CREATE UNIQUE INDEX contacts_national_code ON contacts(national_code) WHERE national_code <> '';
CREATE INDEX contacts_phone ON contacts(phone);
CREATE INDEX contacts_phone2 ON contacts(phone2);
CREATE INDEX contacts_father_phone ON contacts(father_phone);
CREATE INDEX contacts_updated ON contacts(updated_at);

-- User-defined extra fields (ایمیل، واتساپ، ...)
CREATE TABLE field_definitions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE extra_values (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES field_definitions(id),
  value TEXT NOT NULL,
  PRIMARY KEY (contact_id, field_id)
);

-- Append-only; no FK so history survives contact deletion.
CREATE TABLE change_log (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  contact_repr TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  username TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL
);
CREATE INDEX change_log_contact ON change_log(contact_id, changed_at);
CREATE INDEX change_log_changed_at ON change_log(changed_at);

INSERT INTO field_definitions (name) VALUES
  ('ایمیل'), ('واتساپ'), ('ایتا'), ('روبیکا'), ('لینکدین'),
  ('تاریخ تولد'), ('شغل'), ('شماره مادر'), ('تلفن ثابت');
