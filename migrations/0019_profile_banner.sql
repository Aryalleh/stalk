-- Profile banner: shown at the top of the public profile and of every wishlist of the person.
ALTER TABLE users ADD COLUMN banner_key TEXT NOT NULL DEFAULT '';
