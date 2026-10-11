// Instagram shops that aren't on the platform yet ("external" shops).
//
// A user can put an item they saw on any Instagram page into their wishlist. The platform keeps a
// stand-in shop for that page, owned by a placeholder account (it can't sign in) and run by the
// platform admins: givers pay the platform's card, and the admins order the item from the page by
// DM. The page itself is invited to join; when it does, an admin hands the shop over to the page's
// own account, products and wishes included.
//
// Instagram's API only lets a business account answer people who messaged it first, so the
// invite and order DMs are prepared here and sent by an admin from the platform's page.
import type { Settings } from "../settings";
import { now, randomSlug, type Shop } from "./db";

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

/** "@name", "instagram.com/name/…" or "name" → "name" (lower case), or "" when it isn't a handle. */
export function parseHandle(input: string) {
  let s = input.trim().toLowerCase();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/([^/?#]+)/);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  if (["p", "reel", "reels", "tv", "stories", "explore"].includes(s)) return "";
  return HANDLE_RE.test(s) && !/^[.]|[.]$|\.\./.test(s) ? s : "";
}

/** An Instagram post / reel link, cleaned to https://www.instagram.com/p/<code>/, or "" when it isn't one. */
export function parsePostUrl(input: string) {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/(?:[a-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/i);
  if (!m) return "";
  const kind = m[1].toLowerCase() === "reels" ? "reel" : m[1].toLowerCase();
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

/** A shop already on the platform that runs this Instagram page, if any. */
export function memberShopFor(db: D1Database, handle: string) {
  return db
    .prepare(
      `SELECT id, name, slug FROM shops
       WHERE is_external = 0 AND status = 'approved'
         AND (LOWER(ig_username) = ?1 OR LOWER(REPLACE(instagram, '@', '')) = ?1
              OR LOWER(instagram) LIKE '%instagram.com/' || ?1 OR LOWER(instagram) LIKE '%instagram.com/' || ?1 || '/%')
       LIMIT 1`,
    )
    .bind(handle)
    .first<{ id: number; name: string; slug: string }>();
}

/** The stand-in shop for an Instagram page, created on first use. */
export async function externalShop(db: D1Database, s: Settings, handle: string): Promise<Shop> {
  const found = await db.prepare("SELECT * FROM shops WHERE is_external = 1 AND instagram = ?").bind(handle).first<Shop>();
  if (found) return found;
  // Placeholder owner: its "phone" can never be typed at login, and it has no password.
  const phone = `ig:${handle}`;
  await db
    .prepare("INSERT INTO users (phone, name, first_name, password_hash, created_at) VALUES (?, ?, ?, '!', ?) ON CONFLICT (phone) DO NOTHING")
    .bind(phone, `@${handle}`, `@${handle}`, now())
    .run();
  const owner = (await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>())!;
  const base = `ig-${handle.replace(/[._]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 34).replace(/-+$/, "");
  const insert = (slug: string) =>
    db
      .prepare(
        `INSERT INTO shops (owner_id, name, slug, description, status, card_number, card_holder, post_enabled, post_fee, instagram, is_external, created_at)
         VALUES (?, ?, ?, ?, 'approved', ?, ?, 1, 0, ?, 1, ?) RETURNING *`,
      )
      .bind(owner.id, `@${handle}`, slug, `محصولات صفحه‌ی اینستاگرام @${handle} که کاربران به لیست آرزویشان اضافه کرده‌اند.`, s.ext_card_number, s.ext_card_holder, handle, now())
      .first<Shop>();
  let shop: Shop | null = null;
  try {
    shop = await insert(base.length >= 3 ? base : `ig-${randomSlug(6)}`);
  } catch {
    shop = await insert(`${base}-${randomSlug(4)}`.toLowerCase());
  }
  await db.prepare("UPDATE users SET shop_id = ?, shop_role = 'admin' WHERE id = ?").bind(shop!.id, owner.id).run();
  return shop!;
}

/** Fill {placeholders} in an admin-written message. */
export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{([a-z_]+)\}/g, (all, k: string) => (k in vars ? vars[k] : all));
}

const siteVars = (s: Settings, site: string) => ({ site, site_name: s.site_name });

/** The DM inviting an Instagram page to join, about one of its wished-for items. */
export function inviteText(s: Settings, site: string, shop: { instagram: string }, item: { title: string; source_url: string }, wishes: number) {
  return fill(s.ig_invite_text, { ...siteVars(s, site), shop: `@${shop.instagram}`, product: item.title, link: item.source_url, wishes: String(wishes) });
}

/** The DM ordering a paid item from an Instagram page (with where to send it). */
export function orderText(
  s: Settings,
  site: string,
  o: { product_title: string; source_url: string; size: string; color: string; instagram: string; ship_name: string; ship_phone: string; ship_city: string; ship_address: string; ship_postal_code: string },
) {
  const variant = [o.size && `سایز: ${o.size}`, o.color && `رنگ: ${o.color}`].filter(Boolean).join(" — ");
  const ship = [`${o.ship_name} — ${o.ship_phone}`, [o.ship_city, o.ship_address].filter(Boolean).join("، "), o.ship_postal_code && `کد پستی: ${o.ship_postal_code}`].filter(Boolean).join("\n");
  return fill(s.ig_order_text, { ...siteVars(s, site), shop: `@${o.instagram}`, product: o.product_title, link: o.source_url, variant: variant ? `${variant}\n` : "", qty: "۱", ship });
}

/** Instagram DM link for a page. */
export const dmLink = (handle: string) => `https://ig.me/m/${handle}`;
