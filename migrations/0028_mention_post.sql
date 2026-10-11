-- The site's Instagram account reaches a page that hasn't written yet by mentioning it in a post
-- (Instagram notifies the page); one post per page, recorded here.
ALTER TABLE shops ADD COLUMN mention_at TEXT;
ALTER TABLE shops ADD COLUMN mention_post_id TEXT NOT NULL DEFAULT '';
