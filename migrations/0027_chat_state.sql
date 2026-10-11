-- Chat buttons that need a value (card number, a price, a tracking code) ask for it; the shop's
-- next message is that value. The question waits here for 30 minutes.
ALTER TABLE shops ADD COLUMN chat_state TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN chat_state_at TEXT;
