// Password hashing and D1-backed sessions (needs a `sessions (token_hash, user_id, expires_at)` table).

const ITERATIONS = 100_000; // Workers' PBKDF2 maximum
// A session ends after this many days without use; every day it's used pushes the end back. The
// cookie itself lives longer (browsers cap it at 400 days), so only the server decides.
const SESSION_DAYS = 60;
export const COOKIE_MAX_AGE = 400 * 86400;
const DAY = 86400_000;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const actual = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function sha256(text: string) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/**
 * Create a session and return the raw token for the cookie (only its hash is stored). Without
 * `maxAgeSeconds` it renews while used; with it (e.g. an admin acting as a user), it ends then.
 */
export async function createSession(db: D1Database, userId: number, maxAgeSeconds?: number) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const renews = maxAgeSeconds === undefined;
  const expires = Date.now() + (renews ? SESSION_DAYS * DAY : maxAgeSeconds * 1000);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, renews) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, expires, renews ? 1 : 0),
  ]);
  return { token, maxAge: renews ? COOKIE_MAX_AGE : maxAgeSeconds };
}

/** The user id behind a session cookie, or null if missing/expired. A renewing session is extended (once a day). */
export async function sessionUserId(db: D1Database, token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const hash = await sha256(token);
  const now = Date.now();
  const row = await db
    .prepare("SELECT user_id, expires_at, renews FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(hash, now)
    .first<{ user_id: number; expires_at: number; renews: number }>();
  if (!row) return null;
  if (row.renews && row.expires_at < now + (SESSION_DAYS - 1) * DAY) {
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(now + SESSION_DAYS * DAY, hash).run();
  }
  return row.user_id;
}

export async function deleteSession(db: D1Database, token: string | undefined) {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

/** Constant-time string comparison for the setup token. */
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
