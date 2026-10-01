-- Prices are integer Toman.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,          -- login id, normalized 09xxxxxxxxx
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, -- platform admin
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE shops (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
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
  -- Delivery details: shown only to the shop after a paid order, never to givers.
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
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
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
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'failed', 'expired')),
  expires_at TEXT NOT NULL,            -- reservation end while pending
  pay_authority TEXT,
  pay_ref_id TEXT,
  -- Delivery snapshot copied from the wishlist when payment succeeds.
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
CREATE UNIQUE INDEX orders_authority ON orders(pay_authority) WHERE pay_authority IS NOT NULL;
