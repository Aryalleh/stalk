-- Pages the admin writes (terms, shipping, ...) or rewrites (privacy, data deletion), each optionally
-- linked from a footer column.
CREATE TABLE pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  footer_column TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
