-- One database for the whole site: shared accounts, the gift shop, and the CRM.
-- Money is integer Toman.

-- ===================== accounts =====================

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,          -- login id, normalized 09xxxxxxxxx
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, -- platform admin (also has CRM access)
  is_staff INTEGER NOT NULL DEFAULT 0, -- may use the CRM
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- ===================== gift shop =====================

CREATE TABLE shops (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
  -- Card-to-card: givers transfer straight to the shop, which confirms receipt.
  card_number TEXT NOT NULL DEFAULT '',
  card_holder TEXT NOT NULL DEFAULT '',
  bale_chat_id TEXT NOT NULL DEFAULT '',
  telegram_chat_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price > 0),
  image_key TEXT NOT NULL DEFAULT '',  -- R2 object key
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX products_shop ON products(shop_id);
CREATE INDEX products_active ON products(is_active, created_at);

CREATE TABLE wishlists (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,           -- random, used in the share link
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  occasion_date TEXT NOT NULL DEFAULT '',
  -- Delivery details: shown only to the shop after it confirms payment, never to givers.
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX wishlists_user ON wishlists(user_id);

CREATE TABLE wishlist_items (
  id INTEGER PRIMARY KEY,
  wishlist_id INTEGER NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (wishlist_id, product_id)
);

-- One row = one unit bought by a giver for a wishlist item.
-- pending -> (giver reports transfer) awaiting -> (shop confirms) paid -> shipped -> delivered
--                                               \-> (shop rejects) rejected
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,          -- giver's private link to this order (givers have no account)
  item_id INTEGER NOT NULL REFERENCES wishlist_items(id),
  wishlist_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  product_title TEXT NOT NULL,
  amount INTEGER NOT NULL,             -- Toman, price at checkout
  giver_name TEXT NOT NULL,
  giver_phone TEXT NOT NULL,
  gift_message TEXT NOT NULL DEFAULT '',
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'awaiting', 'paid', 'shipped', 'delivered', 'rejected')),
  expires_at TEXT NOT NULL,            -- end of the hold while 'pending'
  -- Card-to-card transfer as reported by the giver.
  pay_card_number TEXT NOT NULL DEFAULT '', -- shop card shown to the giver (snapshot)
  transfer_ref TEXT NOT NULL DEFAULT '',    -- شماره پیگیری
  transfer_card_last4 TEXT NOT NULL DEFAULT '',
  transfer_at TEXT NOT NULL DEFAULT '',     -- time the giver says they transferred (free text)
  receipt_key TEXT NOT NULL DEFAULT '',     -- optional receipt image in R2 (private)
  reported_at TEXT,
  reject_reason TEXT NOT NULL DEFAULT '',
  -- Delivery snapshot copied from the wishlist when the shop confirms payment.
  ship_name TEXT NOT NULL DEFAULT '',
  ship_phone TEXT NOT NULL DEFAULT '',
  ship_address TEXT NOT NULL DEFAULT '',
  ship_postal_code TEXT NOT NULL DEFAULT '',
  tracking_code TEXT NOT NULL DEFAULT '',
  shop_notified INTEGER NOT NULL DEFAULT 0,
  notify_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  paid_at TEXT,
  shipped_at TEXT
);
CREATE INDEX orders_item ON orders(item_id, status);
CREATE INDEX orders_shop ON orders(shop_id, status, created_at);
CREATE INDEX orders_wishlist ON orders(wishlist_id, status);

-- ===================== CRM =====================

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

-- User-defined extra contact fields (ایمیل، واتساپ، ...)
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
  username TEXT NOT NULL DEFAULT '',   -- display name at the time of the change
  changed_at TEXT NOT NULL
);
CREATE INDEX change_log_contact ON change_log(contact_id, changed_at);
CREATE INDEX change_log_changed_at ON change_log(changed_at);

INSERT INTO field_definitions (name) VALUES
  ('ایمیل'), ('واتساپ'), ('ایتا'), ('روبیکا'), ('لینکدین'),
  ('تاریخ تولد'), ('شغل'), ('شماره مادر'), ('تلفن ثابت');
