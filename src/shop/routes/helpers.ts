import { setCookie } from "hono/cookie";
import { createSession } from "../../../lib/auth";
import type { C } from "../../env";
import { SESSION_COOKIE, type User } from "../../session";

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

export async function startSession(c: C, userId: number, next = "/") {
  const { token, maxAge } = await createSession(c.env.DB, userId);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge });
  return c.redirect(safeNext(next));
}

export const currentUser = (c: C) => c.get("user") as User;

export function siteUrl(c: C) {
  return (c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, "");
}
