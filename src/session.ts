import { sessionUserId } from "../lib/auth";

export const SESSION_COOKIE = "crm_session";

export interface User {
  id: number;
  username: string;
  is_admin: number;
}

export async function sessionUser(db: D1Database, token: string | undefined): Promise<User | null> {
  const id = await sessionUserId(db, token);
  if (id === null) return null;
  return db.prepare("SELECT id, username, is_admin FROM users WHERE id = ?").bind(id).first<User>();
}
