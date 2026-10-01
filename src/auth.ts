const ITERATIONS = 100_000; // Workers' PBKDF2 maximum
const SESSION_DAYS = 7;
export const SESSION_COOKIE = "crm_session";

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

export interface User {
  id: number;
  username: string;
  is_admin: number;
}

/** Create a session and return the raw token for the cookie (only its hash is stored). */
export async function createSession(db: D1Database, userId: number) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), userId, expires),
  ]);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function sessionUser(db: D1Database, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256(token), Date.now())
    .first<User>();
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
