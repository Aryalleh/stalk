-- "Buy from other sites": a shop the site's admins run (is_platform). A wisher adds a product link
-- from any online shop (Digikala…); its price there (source_price, toman) is read from the page, the
-- site's commission is added, and post is the shop's post fee. Buyers pay to the admins' card; the
-- admins buy it on that site and send it to the recipient.
ALTER TABLE shops ADD COLUMN is_platform INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN source_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN source_checked_at TEXT;
