import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession } from "../../../lib/auth";
import type { C } from "../../env";
import { SESSION_COOKIE, type User } from "../../session";
import { MINIAPP_COOKIE, linkPendingChat } from "../../bale/chatlink";

export const PAGE = 24;
export const pageParam = (c: C) => Math.max(1, Number(c.req.query("page")) || 1);
export const intParam = (c: C, name: string) => Number(c.req.param(name));

export async function form(c: C) {
  const body = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v.trim();
  return out;
}

/** Only same-site relative paths, to avoid open redirects. */
export function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/**
 * Cookie options. Inside a Bale/Telegram mini app the site may run in a cross-site iframe (web
 * clients), where only SameSite=None cookies work; Partitioned keeps them scoped to that embedding.
 * Cross-site form posts are still refused by the CSRF (Origin) check.
 */
export function cookieOptions(maxAge: number, embedded: boolean) {
  return embedded
    ? ({ httpOnly: true, secure: true, sameSite: "None", partitioned: true, path: "/", maxAge } as const)
    : ({ httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge } as const);
}

export async function startSession(c: C, userId: number, next = "/", embedded = false) {
  const { token, maxAge } = await createSession(c.env.DB, userId);
  const pending = getCookie(c, MINIAPP_COOKIE);
  if (pending) {
    // Signed in from a mini app: connect that Bale/Telegram chat to this account automatically.
    await linkPendingChat(c.env.DB, pending, userId);
    deleteCookie(c, MINIAPP_COOKIE, cookieOptions(0, true));
  }
  setCookie(c, SESSION_COOKIE, token, cookieOptions(maxAge, embedded || !!pending));
  return c.redirect(safeNext(next));
}

export const currentUser = (c: C) => c.get("user") as User;

export function siteUrl(c: C) {
  return (c.get("settings").site_url || new URL(c.req.url).origin).replace(/\/$/, "");
}
