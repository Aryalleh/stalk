-- Each person picks their look: accent color (blue / pink) and dark / light theme. '' = site default.
ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT '';
