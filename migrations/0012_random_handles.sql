-- Public profile links are random and permanent. Replace the sequential user<id> handles (easy to
-- guess / enumerate) with random ones; handles already customized are kept so shared links work.
UPDATE users SET username = lower(hex(randomblob(5))) WHERE username IS NULL OR username GLOB 'user[0-9]*';
