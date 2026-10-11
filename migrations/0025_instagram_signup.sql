-- An Instagram page signs up by sending its phone number in the DM: the number waits here for the
-- one-time code sent to it.
ALTER TABLE shops ADD COLUMN claim_phone TEXT NOT NULL DEFAULT '';
