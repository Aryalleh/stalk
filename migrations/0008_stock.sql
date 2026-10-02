-- Inventory. A product with track_stock = 1 sells only what product_stock holds for the chosen size
-- ('' for products without sizes); a size with no row has 0. track_stock = 0 means unlimited.
-- quantity = units left to sell; it drops by one when the shop confirms a payment.
ALTER TABLE products ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 0;
CREATE TABLE product_stock (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (product_id, size)
);
CREATE INDEX orders_product_size ON orders(product_id, size, status);

-- Out of stock after the order was placed: the shop cancels (status 'rejected', cancel_kind
-- 'out_of_stock', with a refund note when it had already confirmed the money), or first asks the
-- recipient to accept another size / color.
ALTER TABLE orders ADD COLUMN cancel_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN refund_note TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN change_status TEXT NOT NULL DEFAULT ''; -- '' | pending | accepted | declined
ALTER TABLE orders ADD COLUMN change_message TEXT NOT NULL DEFAULT ''; -- the shop's proposal
ALTER TABLE orders ADD COLUMN change_size TEXT NOT NULL DEFAULT '';    -- proposed size ('' = same size)
ALTER TABLE orders ADD COLUMN change_reply TEXT NOT NULL DEFAULT '';   -- the recipient's note (e.g. chosen color)
