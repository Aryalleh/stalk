-- Sessions stay alive while used: each day of use pushes the end back (lib/auth.ts). Short sessions
-- (an admin acting as a user) don't renew.
ALTER TABLE sessions ADD COLUMN renews INTEGER NOT NULL DEFAULT 1;
