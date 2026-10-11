-- Instagram pages run their stand-in shop from a chat (see src/shop/commands.ts):
--  - an item added from Instagram has no price until the page sets one;
--  - the page's id in the DMs with the platform's own Instagram account, and when it last wrote
--    (Instagram only lets the platform write back within 24 hours of that);
--  - a one-time link the page opens to turn the stand-in into its own shop on the site.
ALTER TABLE products ADD COLUMN awaiting_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN ig_contact_id TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN ig_contact_at TEXT;
ALTER TABLE shops ADD COLUMN claim_token TEXT NOT NULL DEFAULT '';
CREATE INDEX shops_ig_contact ON shops(ig_contact_id);
