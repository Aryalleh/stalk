-- Instagram shops that aren't on the platform yet. A user adds an item from such a page to their
-- wishlist; the platform keeps a stand-in ("external") shop for that Instagram page, run by the
-- platform admins: givers pay the platform, which then orders from the page. The page is invited
-- to join, and on joining takes the shop over with its products and wishes.
ALTER TABLE shops ADD COLUMN is_external INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN invite_status TEXT NOT NULL DEFAULT '';  -- '' | 'invited' | 'joined' | 'declined'
ALTER TABLE shops ADD COLUMN invited_at TEXT;
-- Where an item came from (the Instagram post) and who added it.
ALTER TABLE products ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN added_by INTEGER;
CREATE INDEX shops_external ON shops(is_external);
