import { sessionUserId } from "../lib/auth";

export const SESSION_COOKIE = "session";

export interface User {
  id: number;
  phone: string;
  name: string;
  is_admin: number;
  is_staff: number;
  bale_chat_id: string;
  telegram_chat_id: string;
  avatar_key: string;
  first_name: string;
  last_name: string;
  nickname: string; // shown on public pages instead of the real name
  birth_date: string; // Jalali YYYY-MM-DD
  username: string | null;
  show_received: number;
  show_givers: number;
  show_birthday: number;
  shop_id: number | null; // the shop this person works in (owner or agent)
  shop_role: string; // "admin" (owner) | "agent" | ""
  accent: string; // "blue" | "pink" | "" (site default)
  theme: string; // "dark" | "light" | "" (dark)
}

export const ACCENTS = { blue: "59 130 246", pink: "255 92 147" } as const;
export type Accent = keyof typeof ACCENTS;

export const USER_COLUMNS =
  "id, phone, name, is_admin, is_staff, bale_chat_id, telegram_chat_id, avatar_key, first_name, last_name, nickname, birth_date, username, show_received, show_givers, show_birthday, shop_id, shop_role, accent, theme";

export async function sessionUser(db: D1Database, token: string | undefined): Promise<User | null> {
  const id = await sessionUserId(db, token);
  if (id === null) return null;
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();
}

export const canUseCrm = (u: User | null) => !!u && (u.is_admin === 1 || u.is_staff === 1);

export const isConnected = (u: User) => !!(u.bale_chat_id || u.telegram_chat_id);

/** Signed up before names, nickname and birth date were required: must complete the profile. */
export const needsProfile = (u: User) => !u.first_name || !u.last_name || !u.nickname || !u.birth_date;

/** The name other people see (public profile, wishlists, gift pages): the nickname, never the full name. */
export const publicName = (u: { nickname?: string | null; first_name?: string | null }) => u.nickname || u.first_name || "کاربر";

/** The same, as SQL over a users row aliased `alias`. */
export const publicNameSql = (alias: string) => `COALESCE(NULLIF(${alias}.nickname, ''), NULLIF(${alias}.first_name, ''), 'کاربر')`;

/** A random public handle (10 lowercase letters/digits) for the profile link /u/<handle>. */
export function randomHandle() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Give an account its permanent, random public handle (once; it never changes afterwards).
 * Retries on the unlikely collision with an existing handle.
 */
export async function assignUsername(db: D1Database, id: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.prepare("UPDATE users SET username = ? WHERE id = ? AND username IS NULL").bind(randomHandle(), id).run();
      return;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
    }
  }
}
