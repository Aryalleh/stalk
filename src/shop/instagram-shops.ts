// Instagram pages that aren't on the site yet ("external" shops).
//
// A user puts an item they saw on any Instagram page into their wishlist: the post link, the page
// and the item's name; the photo is taken from the post. The site keeps a stand-in shop for the
// page, owned by a placeholder account that can't sign in. The page is told (by the wisher or an
// admin) and DMs the site's own Instagram account; from then on it runs its items there by chat
// commands (commands.ts): its card number, prices, confirming transfers, tracking codes,
// cancelling. Givers pay the page's own card. With "عضویت" the page takes the shop over as its
// own, with everything in it.
//
// Instagram only lets a business account write to someone who wrote to it in the last 24 hours,
// so the first message to a page can't be sent by the site; it's prepared for a person to send.
import type { Settings } from "../settings";
import { now, randomSlug, type Shop } from "./db";
import { fetchProfile, instagramWeb, publishPhoto, sendDm, sendImageDm, type IgEvent } from "./crm/instagram";
import { buttonsFor, cardProduct, rememberCard, runShopChat, setupTodo, type ProductCard } from "./commands";
import type { Deps } from "./orders";
import { assignUsername } from "../session";

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

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
const meta = (html: string, prop: string) =>
  decode(
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1] ??
      "",
  );
/** HTML to plain text: line breaks kept, tags dropped, blank runs squeezed. */
const plain = (html: string) =>
  decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export interface PostInfo {
  image: string;
  handle: string;
  /** The post's caption (becomes the product description). */
  caption: string;
}

/**
 * The cover image, page and caption of a public post (best effort: private posts or a blocked
 * request give nothing).
 */
export async function fetchPost(postUrl: string): Promise<PostInfo> {
  // The embed page has the bare photo / reel cover (the link-preview image of a reel carries a play
  // icon), the page's username and the caption.
  const embed = await fetchEmbed(postUrl);
  if (embed.image && embed.handle && embed.caption) return embed;
  const og = await fetchPreview(postUrl);
  return { image: embed.image || og.image, handle: embed.handle || og.handle, caption: embed.caption || og.caption };
}

const NOTHING: PostInfo = { image: "", handle: "", caption: "" };

async function fetchEmbed(postUrl: string): Promise<PostInfo> {
  try {
    const res = await fetch(`${instagramWeb()}${new URL(postUrl).pathname}embed/captioned/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; facebookexternalhit/1.1)", "Accept-Language": "en-US,en" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NOTHING;
    const html = (await res.text()).slice(0, 600_000);
    const tag = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*>/i)?.[0] ?? "";
    const image = decode(tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? "");
    const handle = parseHandle(decode(html.match(/class=["'][^"']*UsernameText[^"']*["'][^>]*>\s*([^<\s]+)\s*</i)?.[1] ?? ""));
    // <div class="Caption"><a class="CaptionUsername">page</a><br/>caption…<div class="CaptionComments">…
    let cap = html.match(/<div[^>]+class=["']Caption["'][^>]*>([\s\S]*?)(?:<div[^>]+class=["']CaptionComments|<\/div>)/i)?.[1] ?? "";
    cap = cap.replace(/<a[^>]+class=["'][^"']*CaptionUsername[^"']*["'][^>]*>[\s\S]*?<\/a>/i, "");
    return { image: /^https?:\/\//.test(image) ? image : "", handle, caption: plain(cap) };
  } catch {
    return NOTHING;
  }
}

async function fetchPreview(postUrl: string): Promise<PostInfo> {
  try {
    const res = await fetch(instagramWeb() + new URL(postUrl).pathname, {
      headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "en-US,en" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NOTHING;
    const html = (await res.text()).slice(0, 400_000);
    const image = meta(html, "og:image");
    // "12 likes, 3 comments - nice.shop on May 1, 2025: "caption"." or "Name (@nice.shop) • Instagram reel"
    const desc = meta(html, "og:description");
    const text = `${desc} ${meta(html, "og:title")} ${meta(html, "twitter:title")}`;
    const handle = parseHandle(text.match(/-\s+([a-z0-9._]{1,30})\s+on\s/i)?.[1] ?? text.match(/@([a-z0-9._]{1,30})/i)?.[1] ?? "");
    const caption = (desc.match(/:\s*["“]([\s\S]*)["”]\.?\s*$/)?.[1] ?? "").trim();
    return { image: /^https?:\/\//.test(image) ? image : "", handle, caption };
  } catch {
    return NOTHING;
  }
}

/** Download a post's cover so it outlives Instagram's expiring CDN link. */
export async function downloadImage(url: string, tries = 2): Promise<{ data: ArrayBuffer; type: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const data = await res.arrayBuffer();
    return data.byteLength > 0 && data.byteLength <= 8 * 1024 * 1024 ? { data, type } : null;
  } catch {
    // A dropped connection: once more.
    if (tries <= 1) return null;
    await new Promise((r) => setTimeout(r, 500));
    return downloadImage(url, tries - 1);
  }
}

/** A shop already on the site that runs this Instagram page, if any. */
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

/** The stand-in shop for an Instagram page, created on first use (no card yet: the page sends it). */
export async function externalShop(db: D1Database, handle: string): Promise<Shop> {
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
        `INSERT INTO shops (owner_id, name, slug, description, status, post_enabled, post_fee, instagram, is_external, created_at)
         VALUES (?, ?, ?, ?, 'approved', 1, 0, ?, 1, ?) RETURNING *`,
      )
      .bind(owner.id, `@${handle}`, slug, `محصولات صفحه‌ی اینستاگرام @${handle} در لیست آرزوهای کاربران.`, handle, now())
      .first<Shop>();
  let shop: Shop | null;
  try {
    shop = await insert(base.length >= 3 ? base : `ig-${randomSlug(6).toLowerCase()}`);
  } catch {
    shop = await insert(`${base}-${randomSlug(4)}`.toLowerCase());
  }
  await db.prepare("UPDATE users SET shop_id = ?, shop_role = 'admin' WHERE id = ?").bind(shop!.id, owner.id).run();
  return shop!;
}

/**
 * Fill in a stand-in shop's name and logo from Instagram (only what is still the default): from
 * the page's public profile, or from its profile in the DMs (`profile`).
 */
export async function enrichShop(db: D1Database, images: R2Bucket, shopId: number, profile?: { name?: string; profilePic?: string }) {
  const shop = await db.prepare("SELECT id, name, instagram, logo_key, description FROM shops WHERE id = ? AND is_external = 1").bind(shopId).first<{ id: number; name: string; instagram: string; logo_key: string; description: string }>();
  if (!shop) return;
  let name = profile?.name ?? "";
  let pic = profile?.profilePic ?? "";
  if (!name || !pic) {
    try {
      const res = await fetch(`${instagramWeb()}/${shop.instagram}/`, {
        headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "en-US,en" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 400_000);
        // "Nice Shop (@nice.shop) • Instagram photos and videos"
        name ||= meta(html, "og:title").match(/^(.+?)\s*\(@[a-z0-9._]+\)/i)?.[1]?.trim() ?? "";
        pic ||= meta(html, "og:image");
      }
    } catch {
      // best effort
    }
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (name && shop.name === `@${shop.instagram}`) {
    sets.push("name = ?");
    binds.push(`${name.slice(0, 60)} (@${shop.instagram})`);
  }
  if (pic && !shop.logo_key && /^https?:\/\//.test(pic)) {
    const img = await downloadImage(pic);
    if (img) {
      const key = `s/${shop.id}/${randomSlug(16)}.${img.type === "image/png" ? "png" : img.type === "image/webp" ? "webp" : "jpg"}`;
      await images.put(key, img.data, { httpMetadata: { contentType: img.type } });
      sets.push("logo_key = ?");
      binds.push(key);
    }
  }
  if (sets.length) await db.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, shop.id).run();
}

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

/** A one-time link (30 minutes) that signs the page into its shop's web panel. */
export async function loginLink(db: D1Database, site: string, shop: { owner_id: number }) {
  const token = randomSlug(32);
  await db.batch([
    db.prepare("DELETE FROM login_links WHERE expires_at < ?").bind(Date.now()),
    db.prepare("INSERT INTO login_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), shop.owner_id, Date.now() + 30 * 60_000),
  ]);
  return `${site}/l/${token}`;
}

/** Use a login link: the account it signs in to, or null (unknown, used or expired). */
export async function useLoginLink(db: D1Database, token: string) {
  const row = await db.prepare("DELETE FROM login_links WHERE token_hash = ? RETURNING user_id, expires_at").bind(await sha256(token)).first<{ user_id: number; expires_at: number }>();
  return row && row.expires_at > Date.now() ? row.user_id : null;
}

/**
 * The page's own account for its verified phone number (created if new); the stand-in shop is
 * handed over to it. Returns the user id, or an error message.
 */
export async function joinWithPhone(db: D1Database, shop: Shop, phone: string): Promise<number | string> {
  let user = await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();
  if (!user) {
    user = await db
      .prepare("INSERT INTO users (phone, name, first_name, password_hash, created_at) VALUES (?, ?, ?, '!', ?) ON CONFLICT (phone) DO NOTHING RETURNING id")
      .bind(phone, shop.name, shop.name, now())
      .first<{ id: number }>();
    user ??= await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();
    await assignUsername(db, user!.id);
  }
  const error = await handOver(db, shop.id, user!.id);
  await db.prepare("UPDATE shops SET claim_phone = '' WHERE id = ?").bind(shop.id).run();
  return error ?? user!.id;
}

/** Fill {placeholders} in an admin-written message. */
export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{([a-z_]+)\}/g, (all, k: string) => (k in vars ? vars[k] : all));
}

/** Instagram DM link for a page. */
export const dmLink = (handle: string) => `https://ig.me/m/${handle}`;

/** The DM telling a page its item is wished for, and how to start selling it here. */
export function inviteText(s: Settings, site: string, shop: { instagram: string }, item: { title: string; source_url: string }, wishes: number) {
  const platform = s.platform_instagram;
  return fill(s.ig_invite_text, {
    site,
    site_name: s.site_name,
    shop: `@${shop.instagram}`,
    product: item.title,
    link: item.source_url,
    wishes: String(wishes),
    platform: platform ? `@${platform}` : s.site_name,
    dm: platform ? dmLink(platform) : site,
  });
}

/** Hand a stand-in shop to its page's own account (from "عضویت" or an admin). Returns an error, or null. */
export async function handOver(db: D1Database, shopId: number, userId: number) {
  const shop = await db.prepare("SELECT * FROM shops WHERE id = ? AND is_external = 1").bind(shopId).first<Shop>();
  if (!shop) return "این فروشگاه قبلاً تحویل شده است.";
  const user = await db.prepare("SELECT id, name, shop_id, phone FROM users WHERE id = ?").bind(userId).first<{ id: number; name: string; shop_id: number | null; phone: string }>();
  if (!user || user.phone.startsWith("ig:")) return "کاربر پیدا نشد.";
  const owns = user.shop_id || (await db.prepare("SELECT 1 AS x FROM shops WHERE owner_id = ?").bind(user.id).first());
  if (owns) return `${user.name} از قبل فروشگاه دارد؛ با حساب دیگری وارد شوید.`;
  // Payments already go to the page's own card, so open orders simply carry on in the new panel.
  await db.batch([
    db.prepare("UPDATE shops SET owner_id = ?, is_external = 0, invite_status = 'joined', claim_token = '', ig_username = CASE WHEN ig_username = '' THEN instagram ELSE ig_username END WHERE id = ?").bind(user.id, shop.id),
    db.prepare("UPDATE users SET shop_id = NULL, shop_role = '' WHERE id = ?").bind(shop.owner_id),
    db.prepare("UPDATE users SET shop_id = ?, shop_role = 'admin' WHERE id = ?").bind(shop.id, user.id),
  ]);
  return null;
}

/** A line in the admin's log of the site account's DMs (the last 200 are kept). */
export async function igLog(db: D1Database, e: { account_id?: string; sender?: string; result: string; detail?: string }) {
  await db
    .batch([
      db.prepare("INSERT INTO ig_log (at, account_id, sender, result, detail) VALUES (?, ?, ?, ?, ?)").bind(new Date().toISOString(), e.account_id ?? "", e.sender ?? "", e.result, (e.detail ?? "").slice(0, 500)),
      db.prepare("DELETE FROM ig_log WHERE id <= (SELECT MAX(id) - 200 FROM ig_log)"),
    ])
    .catch((err) => console.error("ig_log", err));
}

const platformReady = (s: Settings) => !!(s.platform_ig_account_id && s.platform_ig_token);

/** DM a page that has written to the site's Instagram account (fails quietly outside the 24-hour window). */
export async function dmPage(d: Deps, shopId: number, text: string) {
  if (!platformReady(d.settings)) return false;
  const shop = await d.db.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<Shop>();
  if (!shop?.ig_contact_id) return false;
  try {
    await sendDm(d.settings.platform_ig_token, d.settings.platform_ig_account_id, shop.ig_contact_id, text, await buttonsFor(d.db, shop));
    return true;
  } catch (e) {
    console.error("instagram dm to page", shopId, e);
    return false;
  }
}

/**
 * Reach a page that hasn't written to the site's account yet. Instagram doesn't let the account
 * DM it first (there is no id to write to until it does), so the account publishes a post with
 * the item's photo that mentions the page: Instagram notifies the page, and the caption asks it to
 * send a message. Once per page; logged either way. Returns whether the post went up.
 */
export async function mentionPage(d: Deps, shopId: number, productId: number) {
  const s = d.settings;
  if (!s.ig_mention_post || !platformReady(s)) return false;
  const db = d.db;
  const row = await db
    .prepare(
      `SELECT s.instagram, s.ig_contact_id, s.mention_at, s.is_external, p.title, p.source_url, p.image_key,
              (SELECT COUNT(*) FROM wishlist_items i JOIN products q ON q.id = i.product_id WHERE q.shop_id = s.id) AS wishes
       FROM shops s JOIN products p ON p.shop_id = s.id WHERE s.id = ? AND p.id = ?`,
    )
    .bind(shopId, productId)
    .first<{ instagram: string; ig_contact_id: string; mention_at: string | null; is_external: number; title: string; source_url: string; image_key: string; wishes: number }>();
  if (!row || !row.is_external || row.ig_contact_id || row.mention_at) return false;
  const who = `@${row.instagram}`;
  const log = (result: string, detail = "") => igLog(db, { account_id: s.platform_ig_account_id, sender: who, result, detail });
  // Instagram publishes JPEG photos only, from a public address.
  if (!/\.jpe?g$/i.test(row.image_key)) return log("mention_failed", "عکس محصول JPEG نیست").then(() => false);
  // Claim the page first, so two wishes at once don't post twice.
  const claim = await db.prepare("UPDATE shops SET mention_at = ? WHERE id = ? AND mention_at IS NULL").bind(now(), shopId).run();
  if (!claim.meta.changes) return false;
  const caption = fill(s.ig_mention_caption, {
    site: d.siteUrl,
    site_name: s.site_name,
    shop: who,
    product: row.title,
    link: row.source_url,
    wishes: String(row.wishes),
    platform: s.platform_instagram ? `@${s.platform_instagram}` : s.site_name,
    dm: s.platform_instagram ? dmLink(s.platform_instagram) : d.siteUrl,
  });
  try {
    const id = await publishPhoto(s.platform_ig_token, s.platform_ig_account_id, `${d.siteUrl}/img/${row.image_key}`, caption.slice(0, 2200));
    await db.prepare("UPDATE shops SET mention_post_id = ?, invite_status = CASE WHEN invite_status = '' THEN 'invited' ELSE invite_status END, invited_at = COALESCE(invited_at, ?) WHERE id = ?")
      .bind(id, now(), shopId)
      .run();
    await log("mentioned", `post ${id}`);
    return true;
  } catch (e) {
    // Not posted: let a later wish try again.
    await db.prepare("UPDATE shops SET mention_at = NULL WHERE id = ?").bind(shopId).run();
    await log("mention_failed", String((e as Error).message ?? e).slice(0, 300));
    return false;
  }
}

/** A DM to the site's Instagram account: a page with a stand-in shop runs it by commands. */
export async function handlePlatformDm(d: Deps, ev: IgEvent) {
  const s = d.settings;
  const db = d.db;
  const log = (result: string, sender: string, detail = "") => igLog(db, { account_id: ev.accountId, sender, result, detail });
  if (!platformReady(s)) return log("not_connected", ev.customerId);
  // (A page that has since joined keeps using the same commands here.)
  let shop = await db.prepare("SELECT * FROM shops WHERE ig_contact_id = ?").bind(ev.customerId).first<Shop>();
  let first = false;
  if (!shop) {
    // Who is writing: the page's own account proves it runs the page (its username comes from Instagram).
    const profile = await fetchProfile(s.platform_ig_token, ev.customerId);
    const handle = parseHandle(profile.username ?? "");
    if (!handle) return log("no_username", ev.customerId, ev.body.slice(0, 120));
    shop = await db.prepare("SELECT * FROM shops WHERE is_external = 1 AND instagram = ?").bind(handle).first<Shop>();
    if (!shop) return log("no_wishes", `${ev.customerId} @${handle}`, ev.body.slice(0, 120)); // left for a person to answer
    await enrichShop(db, d.images, shop.id, profile).catch((e) => console.error("enrich shop", e));
    shop = (await db.prepare("SELECT * FROM shops WHERE id = ?").bind(shop.id).first<Shop>())!;
    await db.prepare("UPDATE shops SET ig_contact_id = '' WHERE ig_contact_id = ?").bind(ev.customerId).run();
    first = true;
  }
  await db.prepare("UPDATE shops SET ig_contact_id = ?, ig_contact_at = ?, invite_status = CASE WHEN invite_status IN ('', 'invited') THEN 'talking' ELSE invite_status END WHERE id = ?")
    .bind(ev.customerId, now(), shop.id)
    .run();
  shop.ig_contact_id = ev.customerId;
  let reply: string;
  let buttons = await buttonsFor(db, shop);
  let cards: ProductCard[] = [];
  if (first) {
    const todo = await setupTodo(db, shop);
    reply = [
      `سلام 🌸 به ${s.site_name} خوش آمدید! محصولات صفحه‌ی @${shop.instagram} در لیست آرزوی کاربران ما هستند و دوستانشان می‌خواهند برایشان بخرند 🎁`,
      "پول مستقیم به کارت خودتان واریز می‌شود و همه‌چیز را از همین گفتگو مدیریت می‌کنید.",
      ...todo,
      "📱 برای فروش راحت‌تر (پنل، همه محصولات، سفارش‌ها در بات): «ثبت‌نام در سایت» را بزنید یا شماره موبایلتان را همین‌جا بفرستید.",
      "👇 کارها را با دکمه‌های زیر انجام دهید.",
    ].join("\n\n");
  } else {
    if (ev.type === "text" || ev.payload) {
      const replyTo = await cardProduct(db, "instagram", ev.customerId, ev.replyTo);
      const r = await runShopChat(d, shop, { text: ev.body, payload: ev.payload, replyTo });
      cards = r.cards ?? [];
      reply = r.text;
      buttons = r.buttons;
    } else reply = "لطفاً از دکمه‌ها استفاده کنید یا دستور را به‌صورت متن بفرستید. 👇";
  }
  const who = `${ev.customerId} @${shop.instagram}`;
  try {
    // Instagram caps a text DM at 1000 characters: longer replies go in parts.
    // The buttons go with the last part.
    const parts = splitMessage(reply, 990);
    const send = (text: string, last: boolean) => sendDm(s.platform_ig_token, s.platform_ig_account_id, ev.customerId, text, last ? buttons : []);
    for (const [i, part] of parts.entries()) await send(part, i === parts.length - 1 && !cards.length);
    // Each product as its photo and a caption; replying to either sets that product's price.
    for (const [i, card] of cards.entries()) {
      if (card.image_key) {
        const mid = await sendImageDm(s.platform_ig_token, s.platform_ig_account_id, ev.customerId, `${d.siteUrl}/img/${card.image_key}`).catch(() => "");
        if (mid) await rememberCard(db, "instagram", ev.customerId, mid, card.id);
      }
      const mid = await send(card.caption, i === cards.length - 1);
      await rememberCard(db, "instagram", ev.customerId, mid, card.id);
    }
    await log(first ? "linked" : "replied", who, ev.body.slice(0, 120));
  } catch (e) {
    await log("send_failed", who, String((e as Error).message ?? e));
  }
}

/** Split at line breaks into parts of at most `max` characters. */
export function splitMessage(text: string, max: number) {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const add = cur ? `${cur}\n${line}` : line;
    if (add.length <= max) cur = add;
    else {
      if (cur) parts.push(cur);
      cur = line.slice(0, max);
    }
  }
  if (cur) parts.push(cur);
  return parts;
}
