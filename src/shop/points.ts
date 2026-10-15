// Referral points: a user's invite link (the friend link /f/<code>, or the bots' "?start=f_<code>",
// friends.ts) is also their invite to the platform. Whoever signs up through it is "referred by"
// them, and the inviter earns:
//   join +1  as soon as the new account is attributed,
//   wish +5  once the new user has a wishlist with at least one gift on it,
//   shop +5  once the new user's own shop is approved and has SHOP_PRODUCTS products.
// Each is earned once per invited person (points UNIQUE (user_id, referred_user_id, kind)). Points
// can't be spent yet; a later update will make them cashable.
import { sendToChats, type Chats } from "../bale/botapi";
import type { Settings } from "../settings";
import { publicNameSql } from "../session";
import { now } from "./db";

export const REF_COOKIE = "ref";
export const REF_DAYS = 30;
/** Only accounts this new are attributed (an old account opening a link isn't a sign-up). */
export const REF_NEW_HOURS = 48;
export const SHOP_PRODUCTS = 5;

export const POINTS = { join: 1, wish: 5, shop: 5 } as const;
export type PointKind = keyof typeof POINTS;

const KIND_FA: Record<PointKind, string> = {
  join: "عضو شد",
  wish: "لیست آرزو ساخت و کادو اضافه کرد",
  shop: `فروشگاه ساخت (با ${SHOP_PRODUCTS} محصول)`,
};

/**
 * Mark `userId` as invited by `inviterId` (once, only for a new account, never oneself) and award the
 * join point. Returns true when this call attributed it.
 */
export async function attributeReferral(db: D1Database, userId: number, inviterId: number) {
  if (userId === inviterId) return false;
  const since = new Date(Date.now() - REF_NEW_HOURS * 3600_000).toISOString();
  const r = await db
    .prepare("UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL AND created_at >= ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)")
    .bind(inviterId, userId, since, inviterId)
    .run();
  if (!r.meta.changes) return false;
  await db.prepare("INSERT OR IGNORE INTO points (user_id, referred_user_id, kind, points, created_at) VALUES (?, ?, 'join', ?, ?)").bind(inviterId, userId, POINTS.join, now()).run();
  return true;
}

interface Award {
  user_id: number;
  referred_user_id: number;
  kind: PointKind;
  points: number;
}

/** Give every earned wish / shop point not given yet; returns what was just awarded. */
export async function awardReferrals(db: D1Database): Promise<Award[]> {
  const t = now();
  const [wish, shop] = await db.batch<Award>([
    db
      .prepare(
        `INSERT OR IGNORE INTO points (user_id, referred_user_id, kind, points, created_at)
         SELECT u.referred_by, u.id, 'wish', ?, ? FROM users u
         WHERE u.referred_by IS NOT NULL
           AND EXISTS (SELECT 1 FROM wishlists w JOIN wishlist_items i ON i.wishlist_id = w.id WHERE w.user_id = u.id AND w.is_direct = 0)
           AND NOT EXISTS (SELECT 1 FROM points p WHERE p.user_id = u.referred_by AND p.referred_user_id = u.id AND p.kind = 'wish')
         RETURNING user_id, referred_user_id, kind, points`,
      )
      .bind(POINTS.wish, t),
    db
      .prepare(
        `INSERT OR IGNORE INTO points (user_id, referred_user_id, kind, points, created_at)
         SELECT u.referred_by, u.id, 'shop', ?, ? FROM users u JOIN shops s ON s.owner_id = u.id
         WHERE u.referred_by IS NOT NULL AND s.status = 'approved' AND s.is_external = 0 AND s.is_platform = 0
           AND (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.deleted_at IS NULL) >= ?
           AND NOT EXISTS (SELECT 1 FROM points p WHERE p.user_id = u.referred_by AND p.referred_user_id = u.id AND p.kind = 'shop')
         RETURNING user_id, referred_user_id, kind, points`,
      )
      .bind(POINTS.shop, t, SHOP_PRODUCTS),
  ]);
  return [...wish.results, ...shop.results];
}

/** Tell inviters (on their bot) about points they just got. */
export async function tellAwards(db: D1Database, s: Settings, site: string, awards: Award[]) {
  for (const a of awards) {
    const row = await db
      .prepare(
        `SELECT i.bale_chat_id, i.telegram_chat_id, ${publicNameSql("u")} AS name,
                (SELECT COALESCE(SUM(points), 0) FROM points WHERE user_id = i.id) AS total
         FROM users i, users u WHERE i.id = ? AND u.id = ?`,
      )
      .bind(a.user_id, a.referred_user_id)
      .first<Chats & { name: string; total: number }>();
    if (!row) continue;
    await sendToChats(s, row, `⭐ +${a.points} امتیاز: ${row.name} ${KIND_FA[a.kind]}.\nجمع امتیازهای شما: ${row.total}\n${site}/me/points`).catch(() => undefined);
  }
}

/** Run the sweep and notify; used by the hourly cron and when someone opens their points page. */
export async function sweepReferrals(db: D1Database, s: Settings, site: string) {
  const awards = await awardReferrals(db);
  if (awards.length && site) await tellAwards(db, s, site, awards);
  return awards;
}

export interface Referred {
  id: number;
  name: string;
  username: string | null;
  avatar_key: string;
  created_at: string;
  join: number;
  wish: number;
  shop: number;
}

export async function pointsSummary(db: D1Database, userId: number) {
  const [total, people] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(points), 0) AS total FROM points WHERE user_id = ?").bind(userId),
    db
      .prepare(
        `SELECT u.id, ${publicNameSql("u")} AS name, u.username, u.avatar_key, u.created_at,
                COALESCE(SUM(CASE WHEN p.kind = 'join' THEN p.points END), 0) AS "join",
                COALESCE(SUM(CASE WHEN p.kind = 'wish' THEN p.points END), 0) AS wish,
                COALESCE(SUM(CASE WHEN p.kind = 'shop' THEN p.points END), 0) AS shop
         FROM users u LEFT JOIN points p ON p.referred_user_id = u.id AND p.user_id = u.referred_by
         WHERE u.referred_by = ? GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`,
      )
      .bind(userId),
  ]);
  return { total: (total.results[0] as { total: number }).total, people: people.results as unknown as Referred[] };
}
