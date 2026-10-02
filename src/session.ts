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
  birth_date: string; // Jalali YYYY-MM-DD
  username: string | null;
  show_received: number;
  show_givers: number;
  show_birthday: number;
}

export const USER_COLUMNS =
  "id, phone, name, is_admin, is_staff, bale_chat_id, telegram_chat_id, avatar_key, first_name, last_name, birth_date, username, show_received, show_givers, show_birthday";

export async function sessionUser(db: D1Database, token: string | undefined): Promise<User | null> {
  const id = await sessionUserId(db, token);
  if (id === null) return null;
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();
}

export const canUseCrm = (u: User | null) => !!u && (u.is_admin === 1 || u.is_staff === 1);

export const isConnected = (u: User) => !!(u.bale_chat_id || u.telegram_chat_id);

/** Signed up before names, birth date and username were required: must complete the profile. */
export const needsProfile = (u: User) => !u.first_name || !u.last_name || !u.birth_date || !u.username;

/** New accounts get "user<id>" as their username until they choose one. */
export const assignUsername = (db: D1Database, id: number) =>
  db.prepare("UPDATE users SET username = 'user' || id WHERE id = ? AND username IS NULL").bind(id).run();
