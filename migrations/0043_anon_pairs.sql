-- Admins read anonymous messages per pair of people (/admin/anon): everything ever sent between
-- them, in both directions, whichever conversation (root_id) it belonged to. A side is its account
-- ("u<id>") or, with no account, its chat ("telegram:<chat>"); the pair is the two, sorted.
ALTER TABLE anon_messages ADD COLUMN pair TEXT GENERATED ALWAYS AS (
  min(CASE WHEN from_user_id IS NOT NULL THEN 'u' || from_user_id ELSE from_kind || ':' || from_chat END,
      CASE WHEN recipient_id IS NOT NULL THEN 'u' || recipient_id ELSE to_kind || ':' || to_chat END)
  || '|' ||
  max(CASE WHEN from_user_id IS NOT NULL THEN 'u' || from_user_id ELSE from_kind || ':' || from_chat END,
      CASE WHEN recipient_id IS NOT NULL THEN 'u' || recipient_id ELSE to_kind || ':' || to_chat END)
) VIRTUAL;
CREATE INDEX anon_messages_pair ON anon_messages(pair, created_at);
