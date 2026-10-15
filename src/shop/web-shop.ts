// "Buy from other sites": a wisher adds a product link from any online shop (Digikala, …). There's
// no API to buy through, so the site's admins do it: the item lives in a shop they run
// (is_platform); its price is the one read from the site plus the admins' commission (settings
// web_fee_fixed / web_fee_percent), and the post fee (web_post_fee) is charged as the shop's post.
// Buyers pay to the admins' card (this shop's card); the admins buy it there and send it.
import { notifyAdmins } from "../bale/botapi";
import type { Settings } from "../settings";
import { now, productCode, type Shop } from "./db";
import { addItem } from "./ig-wish";
import { downloadImage } from "./instagram-shops";
import type { Deps } from "./orders";
import { randomSlug } from "./db";

let digikalaBase = "https://api.digikala.com";
/** Local tests only: DIGIKALA_API_BASE in .dev.vars points Digikala's product API at a mock server. */
export function setDigikalaApiBase(base: string | undefined) {
  if (base) digikalaBase = base.replace(/\/$/, "");
}

export interface WebItem {
  title: string;
  image: string;
  price: number | null; // toman; null = couldn't read it
  available: boolean;
  site: string; // the site's name, for people
}

const SITES: Record<string, string> = {
  "digikala.com": "دیجی‌کالا",
  "digistyle.com": "دیجی‌استایل",
  "basalam.com": "باسلام",
  "torob.com": "ترب",
  "okala.com": "اُکالا",
  "snappshop.ir": "اسنپ‌شاپ",
  "timcheh.com": "تیمچه",
  "banimode.com": "بانی‌مد",
  "modiseh.com": "مدیسه",
};

export const siteName = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const key = Object.keys(SITES).find((k) => host === k || host.endsWith(`.${k}`));
    return key ? SITES[key] : host;
  } catch {
    return "";
  }
};

const digikalaId = (url: string) => url.match(/digikala\.com\/product\/dkp-(\d+)/i)?.[1] ?? null;

/** The first web link in a text (not Instagram: that has its own flow), cleaned: no tracking, no anchor. */
export function parseWebUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let u: URL;
  try {
    u = new URL(m[0]);
  } catch {
    return null;
  }
  if (/(^|\.)instagram\.com$/i.test(u.hostname) || /(^|\.)instagr\.am$/i.test(u.hostname)) return null;
  const dk = digikalaId(u.href);
  if (dk) return `https://www.digikala.com/product/dkp-${dk}/`;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

/** commission: the site's price + percent + fixed, rounded up to a thousand toman. */
export function retailPrice(source: number, s: Settings) {
  const pct = Math.max(0, Number(s.web_fee_percent) || 0);
  const fixed = Math.max(0, Number(s.web_fee_fixed) || 0);
  // (whole toman first: 350000 * 1.1 isn't exactly 385000 in floating point)
  const total = source + Math.round((source * pct) / 100) + Math.round(fixed);
  return Math.ceil(total / 1000) * 1000;
}

const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

async function fetchDigikala(id: string): Promise<WebItem | null> {
  const res = await fetch(`${digikalaBase}/v2/product/${id}/`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => null)) as {
    data?: { product?: { title_fa?: string; title_en?: string; status?: string; images?: { main?: { url?: string[] } }; default_variant?: { price?: { selling_price?: number } } | unknown[] } };
  } | null;
  const p = d?.data?.product;
  if (!p) return null;
  const variant = Array.isArray(p.default_variant) ? undefined : p.default_variant;
  const rial = variant?.price?.selling_price;
  return {
    title: (p.title_fa || p.title_en || "").trim(),
    image: p.images?.main?.url?.[0] ?? "",
    price: rial ? Math.round(rial / 10) : null, // Digikala prices are in rial
    available: p.status === "marketable" && !!rial,
    site: SITES["digikala.com"],
  };
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

const meta = (html: string, key: string) =>
  decode(
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, "i"))?.[1] ??
      "",
  );

type Json = Record<string, unknown>;
/** Schema.org Product data in the page (JSON-LD), however it's nested. */
function jsonLdProduct(html: string): Json | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const x = queue.shift();
      if (Array.isArray(x)) queue.push(...x);
      else if (x && typeof x === "object") {
        const o = x as Json;
        const type = o["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return o;
        if (o["@graph"]) queue.push(o["@graph"]);
      }
    }
  }
  return null;
}

/** A price in toman from an amount and its currency (Iranian sites mostly state rial, "IRR"). */
function toToman(amount: unknown, currency: unknown) {
  const n = Number(String(amount ?? "").replace(/[^\d.]/g, ""));
  if (!n) return null;
  return String(currency ?? "IRR").toUpperCase() === "IRT" || /تومان|toman/i.test(String(currency)) ? Math.round(n) : Math.round(n / 10);
}

async function fetchPage(url: string): Promise<WebItem | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 1_500_000);
  const ld = jsonLdProduct(html);
  const offersRaw = ld?.offers;
  const offer = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as Json | undefined;
  const imageRaw = ld?.image;
  const image = typeof imageRaw === "string" ? imageRaw : Array.isArray(imageRaw) ? String(imageRaw[0] ?? "") : imageRaw && typeof imageRaw === "object" ? String((imageRaw as Json).url ?? "") : "";
  const price =
    toToman(offer?.price ?? offer?.lowPrice, offer?.priceCurrency) ??
    toToman(meta(html, "product:price:amount"), meta(html, "product:price:currency"));
  const title = String(ld?.name ?? "").trim() || meta(html, "og:title") || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  if (!title) return null;
  return {
    title: title.slice(0, 200),
    image: image || meta(html, "og:image"),
    price,
    available: !/OutOfStock|SoldOut/i.test(String(offer?.availability ?? "")),
    site: siteName(url),
  };
}

/** Read a product page: Digikala through its product API, any other site from the page's data. */
export async function fetchWebItem(url: string): Promise<WebItem | null> {
  try {
    const dk = digikalaId(url);
    return dk ? await fetchDigikala(dk) : await fetchPage(url);
  } catch (e) {
    console.error("web item", url, e);
    return null;
  }
}

/** The shop the admins run for items from other sites (made on first use). */
export async function webShop(db: D1Database, s: Settings): Promise<Shop> {
  const found = await db.prepare("SELECT * FROM shops WHERE is_platform = 1 LIMIT 1").first<Shop>();
  if (found) return found;
  // Placeholder owner (like an Instagram page's stand-in): can't sign in; admins open the panel via "sign in as".
  const phone = "web:shop";
  await db.prepare("INSERT INTO users (phone, name, first_name, password_hash, created_at) VALUES (?, ?, ?, '!', ?) ON CONFLICT (phone) DO NOTHING").bind(phone, "خرید از سایت‌ها", "خرید از سایت‌ها", now()).run();
  const owner = (await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>())!;
  const shop = (await db
    .prepare(
      `INSERT INTO shops (owner_id, name, slug, description, status, post_enabled, post_fee, courier_enabled, is_platform, created_at)
       VALUES (?, ?, ?, ?, 'approved', 1, ?, 0, 1, ?) RETURNING *`,
    )
    .bind(
      owner.id,
      "خرید از سایت‌ها",
      `web-${randomSlug(4)}`,
      `محصولاتی که کاربران ${s.site_name} از فروشگاه‌های اینترنتی دیگر (دیجی‌کالا و…) به لیست آرزویشان اضافه کرده‌اند؛ تیم ${s.site_name} خرید و ارسالشان را انجام می‌دهد.`,
      Number(s.web_post_fee) || 0,
      now(),
    )
    .first<Shop>())!;
  await db.prepare("UPDATE users SET shop_id = ?, shop_role = 'admin' WHERE id = ?").bind(shop.id, owner.id).run();
  return shop;
}

/** Re-apply the commission and the post fee (after the settings change). */
export async function repriceWebShop(db: D1Database, s: Settings) {
  const shop = await webShop(db, s);
  const { results } = await db.prepare("SELECT id, source_price FROM products WHERE shop_id = ? AND source_price > 0").bind(shop.id).all<{ id: number; source_price: number }>();
  await db.batch([
    db.prepare("UPDATE shops SET post_enabled = 1, post_fee = ?, courier_enabled = 0 WHERE id = ?").bind(Number(s.web_post_fee) || 0, shop.id),
    ...results.map((p) => db.prepare("UPDATE products SET price = ?, awaiting_price = 0, updated_at = ? WHERE id = ?").bind(retailPrice(p.source_price, s), now(), p.id)),
  ]);
  return results.length;
}

/** Read the site again: price (with the commission) and whether it's still sold there. */
export async function refreshWebProduct(d: Deps, productId: number) {
  const p = await d.db
    .prepare("SELECT p.id, p.source_url FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = ? AND s.is_platform = 1 AND p.deleted_at IS NULL")
    .bind(productId)
    .first<{ id: number; source_url: string }>();
  if (!p?.source_url) return null;
  const item = await fetchWebItem(p.source_url);
  if (!item) {
    await d.db.prepare("UPDATE products SET source_checked_at = ? WHERE id = ?").bind(now(), p.id).run();
    return null;
  }
  if (item.price) {
    await d.db
      .prepare("UPDATE products SET source_price = ?, price = ?, awaiting_price = 0, is_active = ?, source_checked_at = ?, updated_at = ? WHERE id = ?")
      .bind(item.price, retailPrice(item.price, d.settings), item.available ? 1 : 0, now(), now(), p.id)
      .run();
  } else {
    await d.db.prepare("UPDATE products SET is_active = ?, source_checked_at = ? WHERE id = ?").bind(item.available ? 1 : 0, now(), p.id).run();
  }
  return item;
}

/** Older than this, a product's price is read again when someone looks at it. */
export const STALE_MS = 6 * 3600_000;
export const isStale = (checkedAt: string | null) => !checkedAt || Date.now() - new Date(checkedAt).getTime() > STALE_MS;

export type WebWishResult = { ok: true; productId: number; title: string; priced: boolean; site: string } | { ok: false; error: string };

/** Put a product from another site on a wishlist (the same link is the same product for everyone). */
export async function addWebWish(d: Deps, user: { id: number }, url: string, wishlistId: number, note = ""): Promise<WebWishResult> {
  const db = d.db;
  const shop = await webShop(db, d.settings);
  let product = await db.prepare("SELECT id, title, awaiting_price, source_checked_at FROM products WHERE shop_id = ? AND source_url = ? AND deleted_at IS NULL").bind(shop.id, url).first<{ id: number; title: string; awaiting_price: number; source_checked_at: string | null }>();
  if (product) {
    if (isStale(product.source_checked_at)) await refreshWebProduct(d, product.id);
  } else {
    const item = await fetchWebItem(url);
    if (!item) return { ok: false, error: "صفحه‌ی این محصول خوانده نشد؛ لینک مستقیم صفحه‌ی خود محصول را بفرستید." };
    if (!item.available) return { ok: false, error: `این کالا فعلاً در ${item.site} موجود نیست.` };
    let image = "";
    if (item.image) {
      const img = await downloadImage(item.image);
      if (img) {
        image = `p/${randomSlug(16)}.${img.type === "image/png" ? "png" : img.type === "image/webp" ? "webp" : "jpg"}`;
        await d.images.put(image, img.data, { httpMetadata: { contentType: img.type } });
      }
    }
    const t = now();
    product = (await db
      .prepare(
        `INSERT INTO products (shop_id, title, description, price, awaiting_price, image_key, is_active, created_at, updated_at, code, source_url, source_price, source_checked_at, added_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, title, awaiting_price, source_checked_at`,
      )
      .bind(
        shop.id,
        item.title.slice(0, 120),
        `این کالا را تیم ${d.settings.site_name} از ${item.site} برایتان می‌خرد و می‌فرستد.\n${url}`,
        item.price ? retailPrice(item.price, d.settings) : 1,
        item.price ? 0 : 1,
        image,
        item.available ? 1 : 0,
        t,
        t,
        productCode(shop.slug),
        url,
        item.price ?? 0,
        t,
        user.id,
      )
      .first<{ id: number; title: string; awaiting_price: number; source_checked_at: string | null }>())!;
    if (image) await db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, 0)").bind(product.id, image).run();
    if (!item.price) {
      await notifyAdmins(db, d.settings, `🛒 کالای تازه از ${item.site} بدون قیمت خوانده‌شده: «${item.title}»\n${url}\nقیمت را در پنل «خرید از سایت‌ها» بگذارید: ${d.siteUrl}/admin/web-shop`).catch(() => undefined);
    }
  }
  const fresh = (await db.prepare("SELECT title, awaiting_price, is_active FROM products WHERE id = ?").bind(product.id).first<{ title: string; awaiting_price: number; is_active: number }>())!;
  if (!fresh.is_active) return { ok: false, error: `این کالا فعلاً در ${siteName(url)} موجود نیست.` };
  await addItem(db, wishlistId, product.id, 1, note.slice(0, 200));
  return { ok: true, productId: product.id, title: fresh.title, priced: !fresh.awaiting_price, site: siteName(url) };
}
