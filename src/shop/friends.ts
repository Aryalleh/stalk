// Friends: a user shares an invite link (the site's /f/<code>, or the Bale / Telegram bot with
// "?start=f_<code>"); whoever accepts it becomes their friend, both ways. Friends see each other's
// birthday (day and month, never the year) and reach each other's wishlists from /me/friends.
import { sendToChats, type Chats } from "../bale/botapi";
import type { Settings } from "../settings";
import { publicNameSql } from "../session";
import { toGregorian, toJalali } from "../../lib/jalali";
import { now, randomSlug } from "./db";

export const FRIEND_CODE = /^[a-z0-9]{10}$/;
/** The bots' /start payload for an invite. */
export const friendStart = (code: string) => `f_${code}`;

/** The user's invite code (made on first use; a new one makes the old links stop working). */
export async function friendCode(db: D1Database, userId: number, renew = false) {
  if (!renew) {
    const row = await db.prepare("SELECT friend_code FROM users WHERE id = ?").bind(userId).first<{ friend_code: string | null }>();
    if (row?.friend_code) return row.friend_code;
  }
  for (;;) {
    const code = randomSlug(10);
    const r = await db.prepare("UPDATE users SET friend_code = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE friend_code = ?)").bind(code, userId, code).run();
    if (r.meta.changes) return code;
  }
}

export interface Inviter {
  id: number;
  name: string;
  username: string | null;
  avatar_key: string;
}

export const inviterByCode = (db: D1Database, code: string) =>
  FRIEND_CODE.test(code)
    ? db.prepare(`SELECT id, ${publicNameSql("users")} AS name, username, avatar_key FROM users WHERE friend_code = ?`).bind(code).first<Inviter>()
    : Promise.resolve(null);

export const areFriends = async (db: D1Database, a: number, b: number) =>
  !!(await db.prepare("SELECT 1 AS x FROM friendships WHERE user_id = ? AND friend_id = ?").bind(a, b).first());

/** Make two users friends (both ways). "self" for one's own link, "already" when they were. */
export async function befriend(db: D1Database, a: number, b: number): Promise<"ok" | "self" | "already"> {
  if (a === b) return "self";
  const t = now();
  const [r] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(a, b, t),
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(b, a, t),
  ]);
  return r.meta.changes ? "ok" : "already";
}

export async function unfriend(db: D1Database, a: number, b: number) {
  await db.prepare("DELETE FROM friendships WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)").bind(a, b).run();
}

/** Tell the inviter (on their bot) that someone accepted. */
export async function tellInviter(db: D1Database, s: Settings, site: string, inviterId: number, friend: { name: string }) {
  const chats = await db.prepare("SELECT bale_chat_id, telegram_chat_id FROM users WHERE id = ?").bind(inviterId).first<Chats>();
  if (!chats) return;
  await sendToChats(s, chats, `🎉 ${friend.name} دعوتتان را پذیرفت و حالا با هم دوستید در ${s.site_name}.\nتولد و لیست آرزوهای دوستانتان: ${site}/me/friends`).catch(() => undefined);
}

export interface FriendRow {
  id: number;
  name: string;
  username: string | null;
  avatar_key: string;
  birth_date: string; // Jalali YYYY-MM-DD (only day and month are shown)
  lists: number; // open wishlists
  wishes: number; // items on them
  since: string;
  days: number | null; // to the next birthday (0 = today)
}

/** Days from today (Tehran) to the next birthday of a Jalali YYYY-MM-DD date; null if unknown. */
export function daysToBirthday(birth: string, today = new Date()) {
  const m = birth.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = new Date(today.getTime() + 210 * 60_000); // Tehran
  const day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const { jy } = toJalali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  for (const y of [jy, jy + 1]) {
    const g = toGregorian(y, Number(m[1]), Number(m[2]));
    const diff = Math.round((Date.UTC(g.gy, g.gm - 1, g.gd) - day) / 86400_000);
    if (diff >= 0) return diff;
  }
  return null;
}

/** A user's friends, the next birthday first. */
export async function listFriends(db: D1Database, userId: number): Promise<FriendRow[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, ${publicNameSql("u")} AS name, u.username, u.avatar_key, u.birth_date, f.created_at AS since,
              (SELECT COUNT(*) FROM wishlists w WHERE w.user_id = u.id AND w.is_open = 1 AND w.is_direct = 0) AS lists,
              (SELECT COUNT(*) FROM wishlist_items i JOIN wishlists w ON w.id = i.wishlist_id WHERE w.user_id = u.id AND w.is_open = 1 AND w.is_direct = 0) AS wishes
       FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? LIMIT 500`,
    )
    .bind(userId)
    .all<Omit<FriendRow, "days">>();
  return results
    .map((r) => ({ ...r, days: daysToBirthday(r.birth_date) }))
    .sort((a, b) => (a.days ?? 999) - (b.days ?? 999) || a.name.localeCompare(b.name, "fa"));
}
