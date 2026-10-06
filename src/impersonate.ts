// Platform admins can sign in as any non-admin user, to see the site as they do and fix things for
// them. The admin's own session is kept aside in a cookie and restored by "back to admin" (or by
// logging out). The stand-in session lasts at most 2 hours, and every one is recorded.
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession, deleteSession } from "../lib/auth";
import type { C } from "./env";
import { SESSION_COOKIE, sessionUser, type User } from "./session";
import { now } from "./shop/db";
import { cookieOptions } from "./shop/routes/helpers";

export const IMPERSONATOR_COOKIE = "impersonator";
const MAX_SECONDS = 2 * 3600;

/** The admin behind the current session when they are acting as someone else, else null. */
export async function actingAdmin(c: C): Promise<User | null> {
  const token = getCookie(c, IMPERSONATOR_COOKIE);
  if (!token) return null;
  const admin = await sessionUser(c.env.DB, token);
  return admin?.is_admin ? admin : null;
}

/** Sign the current admin in as `target`; returns an error message instead when not allowed. */
export async function startImpersonation(c: C, admin: User, targetId: number): Promise<string | null> {
  const target = await c.env.DB.prepare("SELECT id, is_admin FROM users WHERE id = ?").bind(targetId).first<{ id: number; is_admin: number }>();
  if (!target) return "کاربر پیدا نشد.";
  if (target.is_admin) return "ورود به حساب مدیران دیگر ممکن نیست.";
  if (target.id === admin.id) return "این حساب خودتان است.";
  const adminToken = getCookie(c, SESSION_COOKIE);
  if (!adminToken) return "دوباره وارد شوید.";
  const { token, maxAge } = await createSession(c.env.DB, target.id, MAX_SECONDS);
  await c.env.DB.prepare("INSERT INTO impersonations (admin_id, user_id, started_at) VALUES (?, ?, ?)").bind(admin.id, target.id, now()).run();
  setCookie(c, IMPERSONATOR_COOKIE, adminToken, cookieOptions(MAX_SECONDS, false));
  setCookie(c, SESSION_COOKIE, token, cookieOptions(maxAge, false));
  console.log(`admin ${admin.id} signed in as user ${target.id}`);
  return null;
}

/** End acting as a user: drop that session and put the admin's own back. Returns whether one was active. */
export async function stopImpersonation(c: C): Promise<boolean> {
  const adminToken = getCookie(c, IMPERSONATOR_COOKIE);
  if (!adminToken) return false;
  const user = c.get("user");
  await deleteSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (user) {
    await c.env.DB.prepare("UPDATE impersonations SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL").bind(now(), user.id).run();
  }
  deleteCookie(c, IMPERSONATOR_COOKIE, { path: "/", secure: true });
  const admin = await sessionUser(c.env.DB, adminToken);
  if (admin?.is_admin) setCookie(c, SESSION_COOKIE, adminToken, cookieOptions(7 * 86400, false));
  else deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return true;
}
