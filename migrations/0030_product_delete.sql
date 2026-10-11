-- Deleting a product that already has orders keeps its row (order history refers to it) but
-- hides it everywhere, the shop's panel included.
ALTER TABLE products ADD COLUMN deleted_at TEXT;
