-- A gift for a list with a saved address: the recipient has until this time to confirm or change the
-- address after the shop confirms the payment; then the saved one goes to the shop. Until one or the
-- other, the shop doesn't see the address.
ALTER TABLE orders ADD COLUMN address_due_at TEXT;
