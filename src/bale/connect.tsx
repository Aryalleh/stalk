import { Hono } from "hono";
import type { Env } from "../env";
import { render } from "../render";
import { isConnected, type User } from "../session";
import { randomSlug } from "../shop/db";
import { safeNext } from "../shop/routes/helpers";
import { ConnectPage } from "../shop/views/account";
import { activeBots, botLink, type BotKind } from "./botapi";

// Every account must connect the site's Bale or Telegram bot right after signing up: that is how
// shops get orders and receipts, and how people get notified. The bot link carries a one-time token.

const TOKEN_TTL_MS = 24 * 3600_000;

/** Paths a not-yet-connected user may still use. */
export const CONNECT_EXEMPT = /^\/(connect|logout|setup|bot\/|img\/|order\/|admin\/settings)/;

export async function connectToken(db: D1Database, userId: number) {
  const row = await db
    .prepare("SELECT token FROM connect_tokens WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(userId, Date.now() - TOKEN_TTL_MS)
    .first<{ token: string }>();
  if (row) return row.token;
  const token = randomSlug(20);
  await db.batch([
    db.prepare("DELETE FROM connect_tokens WHERE user_id = ?").bind(userId),
    db.prepare("INSERT INTO connect_tokens (token, user_id, created_at) VALUES (?, ?, ?)").bind(token, userId, Date.now()),
  ]);
  return token;
}

/** Tie a chat to the account that owns the token. Returns the user, or null for an unknown/expired token. */
export async function useConnectToken(db: D1Database, token: string, kind: BotKind, chatId: string) {
  const row = await db
    .prepare("SELECT user_id FROM connect_tokens WHERE token = ? AND created_at > ?")
    .bind(token, Date.now() - TOKEN_TTL_MS)
    .first<{ user_id: number }>();
  if (!row) return null;
  const col = kind === "bale" ? "bale_chat_id" : "telegram_chat_id";
  await db.batch([
    db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(chatId, row.user_id),
    db.prepare("DELETE FROM connect_tokens WHERE user_id = ?").bind(row.user_id),
  ]);
  return db.prepare("SELECT id, name, phone FROM users WHERE id = ?").bind(row.user_id).first<{ id: number; name: string; phone: string }>();
}

export const connect = new Hono<Env>();

connect.get("/connect", async (c) => {
  const user = c.get("user") as User | null;
  if (!user) return c.redirect("/login?next=/connect");
  const next = safeNext(c.req.query("next"));
  const s = c.get("settings");
  const bots = activeBots(s);
  if (isConnected(user) || (!bots.length && user.is_admin)) return c.redirect(next);
  if (!bots.length) return render(c, <ConnectPage user={user} next={next} links={[]} />);
  const token = await connectToken(c.env.DB, user.id);
  return render(c, <ConnectPage user={user} next={next} links={bots.map((k) => ({ kind: k, url: botLink(s, k, token) }))} />);
});

connect.get("/connect/status", (c) => {
  const user = c.get("user") as User | null;
  return c.json({ connected: !!user && isConnected(user), bots: activeBots(c.get("settings")).length });
});
