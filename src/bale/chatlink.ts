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

/**
 * A chat shared its own phone number through the messenger's contact button (the messenger vouches
 * for it, as an SMS code would): sign that chat up, or tie it to the account with that number.
 * Returns the account, and whether it was just made (it then completes its profile on the site).
 */
export async function accountFromContact(db: D1Database, kind: BotKind, chatId: string, phone: string, name: { first: string; last: string }) {
  const linked = await userByChat(db, kind, chatId);
  if (linked) return { id: linked.id, created: false };
  const existing = await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();
  if (existing) {
    await linkChat(db, kind, chatId, existing.id);
    return { id: existing.id, created: false };
  }
  const first = name.first.trim().slice(0, 40);
  const last = name.last.trim().slice(0, 40);
  const row = await db
    .prepare(
      `INSERT INTO users (phone, name, first_name, last_name, password_hash, created_at) VALUES (?, ?, ?, ?, '!', ?)
       ON CONFLICT (phone) DO NOTHING RETURNING id`,
    )
    .bind(phone, `${first} ${last}`.trim() || phone, first, last, new Date().toISOString())
    .first<{ id: number }>();
  const id = row?.id ?? (await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>())!.id;
  await linkChat(db, kind, chatId, id);
  return { id, created: !!row };
}
