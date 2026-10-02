import type { BotKind } from "./botapi";

// A chat proven by mini-app initData (or by the /start link) belongs to one account: linking it
// to a user removes it from any other account that had it.

export const MINIAPP_COOKIE = "miniapp";
export const PENDING_TTL_MS = 30 * 60_000;

const column = (kind: BotKind) => (kind === "bale" ? "bale_chat_id" : "telegram_chat_id");

export async function linkChat(db: D1Database, kind: BotKind, chatId: string, userId: number) {
  const col = column(kind);
  await db.batch([
    db.prepare(`UPDATE users SET ${col} = '' WHERE ${col} = ? AND id <> ?`).bind(chatId, userId),
    db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(chatId, userId),
  ]);
}

export function userByChat(db: D1Database, kind: BotKind, chatId: string) {
  return db.prepare(`SELECT id FROM users WHERE ${column(kind)} = ? LIMIT 1`).bind(chatId).first<{ id: number }>();
}

/** After signing in, attach the mini-app chat that was waiting in this browser (if any). */
export async function linkPendingChat(db: D1Database, token: string, userId: number) {
  const row = await db
    .prepare("SELECT kind, chat_id FROM miniapp_pending WHERE token = ? AND created_at > ?")
    .bind(token, Date.now() - PENDING_TTL_MS)
    .first<{ kind: BotKind; chat_id: string }>();
  await db.prepare("DELETE FROM miniapp_pending WHERE token = ? OR created_at <= ?").bind(token, Date.now() - PENDING_TTL_MS).run();
  if (row) await linkChat(db, row.kind, row.chat_id, userId);
}
