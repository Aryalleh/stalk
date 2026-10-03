-- Shop CRM (v1): Instagram DMs → customers/leads, conversations, tasks, notes, tags, manual orders,
-- automation. Every table carries shop_id so the data is per shop from day one.
--
-- Mapping to the data model:
--   shops            + ig_account_id, ig_access_token (Instagram account connected by the shop)
--   users            + shop_id, shop_role ('admin' | 'agent')  (the owner is the shop's admin)
--   products         = the existing products table (name = title, images = product_images)
--   product_variants = the existing product_stock table (one row per size × color) + sku, price,
--                      sale_price, min_stock; "stock" is its quantity column
--   orders           = crm_orders / crm_order_items (the name "orders" already holds the site's gift
--                      orders, which are also counted in customer stats and timelines)
--   leads            = customers.stage (lead → interested → offer_sent → purchased), not a table
--   timeline         = a UNION over messages, notes, tasks, crm_orders and gift orders, no table

ALTER TABLE shops ADD COLUMN ig_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN ig_access_token TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN shop_id INTEGER;
ALTER TABLE users ADD COLUMN shop_role TEXT NOT NULL DEFAULT '';
UPDATE users SET shop_id = (SELECT id FROM shops WHERE owner_id = users.id), shop_role = 'admin'
  WHERE id IN (SELECT owner_id FROM shops);
CREATE INDEX users_shop ON users(shop_id);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  user_id INTEGER,
  action TEXT NOT NULL,          -- create / update / delete / stage / assign / send / ...
  entity_type TEXT NOT NULL,     -- customer / conversation / order / task / product / ...
  entity_id INTEGER,
  changes TEXT NOT NULL DEFAULT '', -- JSON {field: [old, new]} or a short description
  created_at TEXT NOT NULL
);
CREATE INDEX activity_shop ON activity_log(shop_id, created_at);
CREATE INDEX activity_entity ON activity_log(entity_type, entity_id);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  ig_user_id TEXT,               -- Instagram-scoped id of the person who DMed the shop
  username TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '', -- Jalali YYYY-MM-DD
  source TEXT NOT NULL DEFAULT '',   -- instagram / site / manual / ...
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead', 'interested', 'offer_sent', 'purchased')),
  total_spent INTEGER NOT NULL DEFAULT 0,
  orders_count INTEGER NOT NULL DEFAULT 0,
  last_order_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX customers_ig ON customers(shop_id, ig_user_id) WHERE ig_user_id IS NOT NULL;
CREATE INDEX customers_phone ON customers(shop_id, phone);
CREATE INDEX customers_stage ON customers(shop_id, stage, updated_at);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  UNIQUE (shop_id, name)
);
CREATE TABLE customer_tags (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, tag_id)
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id INTEGER,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX notes_customer ON notes(customer_id, created_at);

CREATE TABLE product_interests (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  source TEXT NOT NULL DEFAULT 'dm' CHECK (source IN ('dm', 'order')),
  created_at TEXT NOT NULL,
  UNIQUE (customer_id, product_id, source)
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assigned_to INTEGER,
  last_customer_msg_at TEXT,
  last_message_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX conversations_customer ON conversations(customer_id);
CREATE INDEX conversations_shop ON conversations(shop_id, status, last_message_at);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ig_message_id TEXT UNIQUE,     -- Instagram's id; makes webhook retries idempotent
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  type TEXT NOT NULL DEFAULT 'text', -- text / image / story_reply / ...
  body TEXT NOT NULL DEFAULT '',
  sent_by INTEGER,               -- user who sent an outgoing message (NULL = automation)
  status TEXT NOT NULL DEFAULT 'sent', -- outgoing: sent / failed
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE quick_replies (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL
);

-- Product variants: the size × color stock rows gain sku, price, sale_price and min_stock.
ALTER TABLE product_stock ADD COLUMN sku TEXT NOT NULL DEFAULT '';
ALTER TABLE product_stock ADD COLUMN price INTEGER;      -- NULL = the product's price
ALTER TABLE product_stock ADD COLUMN sale_price INTEGER; -- NULL = no sale
ALTER TABLE product_stock ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0; -- low-stock alert at or below

CREATE TABLE crm_orders (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  number INTEGER NOT NULL,       -- per-shop running number
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'shipped', 'delivered', 'canceled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  payment_method TEXT NOT NULL DEFAULT 'card', -- card (card-to-card) / cash / online / other
  discount INTEGER NOT NULL DEFAULT 0,
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  tracking_number TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, number)
);
CREATE INDEX crm_orders_customer ON crm_orders(customer_id, created_at);
CREATE INDEX crm_orders_shop ON crm_orders(shop_id, status, created_at);
CREATE TABLE crm_order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES crm_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,           -- snapshot
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  assigned_to INTEGER,
  type TEXT NOT NULL DEFAULT 'follow_up', -- follow_up / call / send_offer / birthday / other
  title TEXT NOT NULL,
  due_at TEXT,
  done_at TEXT,
  created_by INTEGER,            -- NULL = automation
  created_at TEXT NOT NULL
);
CREATE INDEX tasks_open ON tasks(shop_id, done_at, due_at);
CREATE INDEX tasks_customer ON tasks(customer_id);

-- Automation: welcome reply to a first DM, keyword replies (optionally setting a stage / tag), and a
-- follow-up task when an offer gets no answer.
CREATE TABLE automation_rules (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'keyword', 'offer_followup')),
  keyword TEXT NOT NULL DEFAULT '',
  reply TEXT NOT NULL DEFAULT '',
  set_stage TEXT NOT NULL DEFAULT '',
  tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  hours INTEGER NOT NULL DEFAULT 24, -- offer_followup: wait this long for an answer
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX automation_shop ON automation_rules(shop_id, kind, active);
