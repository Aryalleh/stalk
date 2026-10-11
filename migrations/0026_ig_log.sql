-- What happened to the DMs sent to the site's own Instagram account (and to deliveries that matched
-- no connected account), for the admin's Instagram page: did the message arrive, whose page is it,
-- was the reply sent.
CREATE TABLE ig_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '', -- the Instagram account the delivery was for
  sender TEXT NOT NULL DEFAULT '',     -- who wrote (IGSID), and their @username when known
  result TEXT NOT NULL,                -- see LOG_LABEL in views/panel.tsx
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ig_log_at ON ig_log(at);
