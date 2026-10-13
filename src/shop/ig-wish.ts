// Adding an item seen on Instagram to someone's wishlist: from the site form (/me/instagram) and
// from a post link sent in a DM to the site's Instagram account. The post's page becomes (or is
// already) a shop; the item gets the post's photo and caption and waits for the shop's price.
import { notifyAdmins, sendToChats } from "../bale/botapi";
import { inlineKeyboard } from "./commands";
import { now, productCode, randomSlug, type Shop } from "./db";
import { storeImage } from "./images";
import { dmPage, downloadImage, enrichShop, externalShop, fetchPost, inviteText, memberShopFor, mentionPage, parseHandle } from "./instagram-shops";
import { shopOwnerChats, type Deps } from "./orders";

/** Put a product on a wishlist (or update its quantity / note / variant there). */
export async function addItem(db: D1Database, wishlistId: number, productId: number, quantity = 1, note = "", size = "", color = "") {
  await db
    .prepare(
      `INSERT INTO wishlist_items (wishlist_id, product_id, quantity, note, size, color, created_at)
       SELECT ?, p.id, ?, ?, ?, ?, ? FROM products p WHERE p.id = ? AND p.is_active = 1
       ON CONFLICT (wishlist_id, product_id) DO UPDATE SET quantity = excluded.quantity, note = excluded.note, size = excluded.size, color = excluded.color`,
    )
    .bind(wishlistId, quantity, note, size, color, now(), productId)
    .run();
}

/** A name for an item from its caption: the first line, without hashtags and mentions. */
export const titleFromCaption = (caption: string) =>
  (caption.split("\n").map((l) => l.replace(/[#@][^\s#@]+/g, "").trim()).find((l) => l.length > 1) ?? "").slice(0, 80);

export interface WishInput {
  postUrl: string; // cleaned with parsePostUrl
  wishlistId: number;
  title?: string; // empty: from the caption
  note?: string;
  handle?: string; // the page, when the post doesn't tell
  photo?: File | null;
  /** Mention a page that hasn't written to us in a post (default). A post link sent in our DM may be a slip, so not for those. */
  mention?: boolean;
}

export type WishResult =
  | { ok: true; productId: number; wishlistId: number; title: string; notify: Promise<unknown>; askShop?: { handle: string; text: string } }
  | { ok: false; error: string; askHandle?: boolean };

/**
 * Add the post's item to the wishlist. `notify` tells the shop (or the admins) about it; run it
 * in the background.
 */
export async function addInstagramWish(d: Deps, user: { id: number; name: string }, inp: WishInput): Promise<WishResult> {
  const db = d.db;
  // The same post added again (by anyone) is the same product, so its wishes add up.
  let product = await db
    .prepare(
      "SELECT p.id, p.shop_id FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.source_url = ? AND p.deleted_at IS NULL AND s.status <> 'suspended' ORDER BY s.is_external LIMIT 1",
    )
    .bind(inp.postUrl)
    .first<{ id: number; shop_id: number }>();
  const background: Promise<unknown>[] = [];
  if (!product) {
    // The page and the cover photo come from the post itself.
    const post = await fetchPost(inp.postUrl);
    const handle = parseHandle(inp.handle ?? "") || post.handle;
    if (!handle) return { ok: false, error: "صفحه‌ی این پست پیدا نشد؛ آیدی صفحه‌ی فروشگاه را هم بنویسید (مثل ‎@shop_name).", askHandle: true };
    // A page that is already a shop here gets the item in its own shop (it sets the price);
    // otherwise its stand-in shop.
    const member = await memberShopFor(db, handle);
    const shop = member ? (await db.prepare("SELECT * FROM shops WHERE id = ?").bind(member.id).first<Shop>())! : await externalShop(db, handle);
    if (shop.status === "suspended") return { ok: false, error: "افزودن از این صفحه فعلاً ممکن نیست." };
    // The page's name and profile photo, from Instagram.
    if (shop.is_external && !shop.logo_key) background.push(enrichShop(db, d.images, shop.id));
    let image = "";
    if (inp.photo) image = await storeImage(d.images, inp.photo, "p");
    else if (post.image) {
      const img = await downloadImage(post.image);
      if (img) {
        image = `p/${randomSlug(16)}.${img.type === "image/png" ? "png" : img.type === "image/webp" ? "webp" : "jpg"}`;
        await d.images.put(image, img.data, { httpMetadata: { contentType: img.type } });
      }
    }
    const title = (inp.title?.trim() || titleFromCaption(post.caption) || `محصول از @${handle}`).slice(0, 120);
    const t = now();
    // No price yet: the shop sets it (commands.ts or its panel); 1 is a placeholder the price check accepts.
    product = await db
      .prepare(
        `INSERT INTO products (shop_id, title, description, price, awaiting_price, image_key, is_active, created_at, updated_at, code, source_url, added_by)
         VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, ?, ?, ?) RETURNING id, shop_id`,
      )
      .bind(shop.id, title, post.caption.slice(0, 2000) || `از اینستاگرام @${handle}`, image, t, t, productCode(shop.slug), inp.postUrl, user.id)
      .first<{ id: number; shop_id: number }>();
    if (image) await db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, 0)").bind(product!.id, image).run();
  }
  await addItem(db, inp.wishlistId, product!.id, 1, (inp.note ?? "").slice(0, 200));
  const info = (await db
    .prepare(
      "SELECT p.id, p.title, p.source_url, p.awaiting_price, s.id AS shop_id, s.instagram, s.ig_username, s.ig_contact_id, s.is_external FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = ?",
    )
    .bind(product!.id)
    .first<{ id: number; title: string; source_url: string; awaiting_price: number; shop_id: number; instagram: string; ig_username: string; ig_contact_id: string; is_external: number }>())!;
  const s = d.settings;
  const site = d.siteUrl;
  const igPage = `@${info.is_external ? info.instagram : info.ig_username || parseHandle(info.instagram) || info.instagram}`;
  const price = info.awaiting_price ? `\nبرای فعال شدن خرید، قیمتش را بفرستید:\nقیمت ${info.id} مبلغ‌به‌تومان` : "";
  const toShop = `🎁 یک کاربر «${info.title}» را از پست اینستاگرام شما به لیست آرزویش اضافه کرد.\n${info.source_url}${price}`;
  background.push(
    info.is_external
      ? // The site can't DM a page first (Instagram's rule): the admins get the message ready to send.
        notifyAdmins(
          db,
          s,
          info.ig_contact_id
            ? `📸 آرزوی تازه از ${igPage}: «${info.title}» (فروشگاه در دایرکت با ما در ارتباط است و خبرش کردیم)`
            : [`📸 آرزوی تازه از ${igPage}: «${info.title}» — این پیام را برای فروشگاه بفرستید:`, `https://ig.me/m/${info.instagram}`, "", inviteText(s, site, info, info, 1)].join("\n"),
        )
      : // A member shop hears it in its bot right away, and can price it there with the same command.
        Promise.all([shopOwnerChats(db, info.shop_id), db.prepare("SELECT * FROM shops WHERE id = ?").bind(info.shop_id).first<Shop>()]).then(([chats, shop]) =>
          chats && shop
            ? sendToChats(s, chats, `${toShop}\nیا از پنل: ${site}/panel/products/${info.id}`, () => inlineKeyboard([{ title: `🏷 قیمت ${info.title.slice(0, 12)}`, payload: `pr:${info.id}` }]))
            : "",
        ),
    // A page we can DM hears it there; one that hasn't written yet is mentioned in a post (once).
    info.ig_contact_id ? dmPage(d, info.shop_id, toShop) : info.is_external && inp.mention !== false ? mentionPage(d, info.shop_id, info.id) : Promise.resolve(),
  );
  // A page we can't reach ourselves hears it from the wisher: the message to send it.
  const askShop = info.awaiting_price && info.is_external && !info.ig_contact_id ? { handle: info.instagram, text: inviteText(s, site, info, info, 1) } : undefined;
  return { ok: true, productId: info.id, wishlistId: inp.wishlistId, title: info.title, notify: Promise.allSettled(background), askShop };
}

// ---------- wishes sent as Instagram posts in a DM ----------

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

/** The code a user sends in the DM to link their Instagram account (valid 30 minutes). */
export async function linkCode(db: D1Database, userId: number) {
  // The same code while it has a while left (the page may be opened again before it's sent).
  const live = await db.prepare("SELECT code FROM ig_link_codes WHERE user_id = ? AND expires_at > ?").bind(userId, Date.now() + 5 * 60_000).first<{ code: string }>();
  if (live) return live.code;
  const code = `KD-${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
  await db.batch([
    db.prepare("DELETE FROM ig_link_codes WHERE user_id = ? OR expires_at < ?").bind(userId, Date.now()),
    db.prepare("INSERT OR REPLACE INTO ig_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)").bind(code, userId, Date.now() + 30 * 60_000),
  ]);
  return code;
}

/** Tie an Instagram account (its id in the site account's DMs) to a site user; one user per account. */
export async function linkInstagram(db: D1Database, userId: number, igsid: string, username: string) {
  await db.batch([
    db.prepare("UPDATE users SET ig_user_id = NULL, ig_username = '' WHERE ig_user_id = ? AND id <> ?").bind(igsid, userId),
    db.prepare("UPDATE users SET ig_user_id = ?, ig_username = ? WHERE id = ?").bind(igsid, username, userId),
  ]);
}

/** A one-time link (1 day) for someone who sent a post before linking: opening it (signed in) links them. */
export async function linkToken(db: D1Database, igsid: string, username: string, postUrl: string) {
  const token = randomSlug(32);
  await db.batch([
    db.prepare("DELETE FROM ig_link_tokens WHERE igsid = ? OR expires_at < ?").bind(igsid, Date.now()),
    db.prepare("INSERT INTO ig_link_tokens (token_hash, igsid, username, post_url, expires_at) VALUES (?, ?, ?, ?, ?)").bind(await sha256(token), igsid, username, postUrl, Date.now() + 86400_000),
  ]);
  return token;
}

export async function useLinkToken(db: D1Database, token: string) {
  const row = await db
    .prepare("DELETE FROM ig_link_tokens WHERE token_hash = ? RETURNING igsid, username, post_url, expires_at")
    .bind(await sha256(token))
    .first<{ igsid: string; username: string; post_url: string; expires_at: number }>();
  return row && row.expires_at > Date.now() ? row : null;
}

/** The user's most recent wishlist (one is made if they have none; its address is asked when a gift is bought). */
export async function defaultWishlist(db: D1Database, user: { id: number; name: string; phone: string }) {
  const w = await db.prepare("SELECT id, title FROM wishlists WHERE user_id = ? AND is_direct = 0 ORDER BY id DESC LIMIT 1").bind(user.id).first<{ id: number; title: string }>();
  if (w) return w;
  const title = "لیست آرزوی من";
  const row = await db
    .prepare(
      `INSERT INTO wishlists (user_id, slug, title, description, occasion_date, recipient_name, recipient_phone, address, postal_code, city, ask_address, created_at)
       VALUES (?, ?, ?, '', '', ?, ?, '', '', '', 1, ?) RETURNING id`,
    )
    .bind(user.id, randomSlug(), title, user.name, user.phone.startsWith("09") ? user.phone : "", now())
    .first<{ id: number }>();
  return { id: row!.id, title };
}
