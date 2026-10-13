-- A wishlist without a fixed address: once a gift on it is bought and the shop confirms the payment,
-- the wisher is asked for their current address, and the shop gets it then.
ALTER TABLE wishlists ADD COLUMN ask_address INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN address_asked_at TEXT; -- the recipient was asked for the address
ALTER TABLE orders ADD COLUMN address_at TEXT;       -- the recipient gave it
