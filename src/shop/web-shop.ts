// "Buy from other sites": a wisher adds a product link from any online shop (Digikala, …). There's
// no API to buy through, so the site's admins do it: the item lives in a shop they run
// (is_platform); its price is the one read from the site plus the admins' commission (settings
// web_fee_fixed / web_fee_percent), and the post fee (web_post_fee) is charged as the shop's post.
// Buyers pay to the admins' card (this shop's card); the admins buy it there and send it.
import { notifyAdmins } from "../bale/botapi";
import { toLatinDigits } from "../../lib/normalize";
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
  method: string; // how it was read (shown in the admin's link test)
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
  "technolife.ir": "تکنولایف",
  "technolife.com": "تکنولایف",
  "meghdadit.com": "مقداد آی‌تی",
  "emalls.ir": "ایمالز",
  "shixon.com": "شیکسون",
  "lioncomputer.com": "لیون کامپیوتر",
  "zanbil.ir": "زنبیل",
  "khanoumi.com": "خانومی",
  "ketabrah.ir": "کتابراه",
  "30book.com": "سی‌بوک",
  "iranketab.ir": "ایران‌کتاب",
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

// Digikala and Digistyle (same company) share product ids: dkp-<id>.
const digikalaId = (url: string) => url.match(/(?:digikala|digistyle)\.com\/product\/dkp-(\d+)/i)?.[1] ?? null;

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
    method: "API دیجی‌کالا",
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

// ---------- reading a product page (any shop): what the big Iranian shops publish for search engines ----------

/** The value of the first key found in an object (keys tried in order). */
const pick = (o: Json | undefined, keys: string[]) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const imageOf = (x: unknown): string =>
  typeof x === "string" ? x : Array.isArray(x) ? imageOf(x[0]) : x && typeof x === "object" ? imageOf(pick(x as Json, ["url", "contentUrl", "src", "MEDIUM", "LARGE", "original"])) : "";
const sane = (toman: number | null) => (toman && toman >= 1000 && toman < 10_000_000_000 ? toman : null);

/** Next.js pages (many shops) carry the product as JSON: find an object that has a name and a price. */
function nextDataProduct(html: string): { title: string; price: number | null; image: string; available: boolean } | null {
  const raw = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const NAME = ["title_fa", "title", "name", "productName"];
  const PRICE = ["selling_price", "sellingPrice", "final_price", "finalPrice", "sale_price", "salePrice", "price"];
  const queue: unknown[] = [data];
  let seen = 0;
  while (queue.length && seen++ < 20000) {
    const x = queue.shift();
    if (Array.isArray(x)) queue.push(...x);
    else if (x && typeof x === "object") {
      const o = x as Json;
      const name = pick(o, NAME);
      let price = pick(o, PRICE);
      if (price && typeof price === "object") price = pick(price as Json, PRICE);
      if (typeof name === "string" && name.length > 2 && (typeof price === "number" || /^\d+$/.test(String(price ?? "")))) {
        // Shops' JSON is in rial unless it says toman.
        const currency = String(pick(o, ["currency", "priceCurrency"]) ?? "IRR");
        return {
          title: name,
          price: sane(toToman(price, currency)),
          image: imageOf(pick(o, ["image", "images", "photo", "thumbnail", "main_image"])),
          available: !/out_?of_?stock|unavailable|ناموجود/i.test(String(pick(o, ["status", "availability", "stock_status"]) ?? "")),
        };
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") queue.push(v);
    }
  }
  return null;
}

/**
 * The price as the shop shows it on the page (toman, often in Persian digits): Digikala's
 * <div data-theme-animation="price-container">۸۰۹,۹۰۰</div>. The first one is the product's own price.
 */
function shownPrice(html: string) {
  const m = html.match(/data-theme-animation=["']price-container["'][^>]*>([\s\S]{0,200}?)<\/(?:div|span)>/i);
  if (!m) return null;
  const digits = toLatinDigits(m[1].replace(/<[^>]+>/g, "")).replace(/[^\d]/g, "");
  return digits ? sane(Number(digits)) : null;
}

const h1Text = (m: RegExpMatchArray | null) => (m ? decode(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "");
/** The product's name as Digikala's page shows it: <h1 data-testid="pdp-title">. */
const shownTitle = (html: string) => h1Text(html.match(/<h1[^>]*data-testid=["']pdp-title["'][^>]*>([\s\S]{1,600}?)<\/h1>/i));
/** Any page's first <h1> (after og:title: on some shops it's the shop's own name). */
const firstH1 = (html: string) => h1Text(html.match(/<h1[^>]*>([\s\S]{1,600}?)<\/h1>/i));

/** The product's photo on the page: Digikala's product image (dkstatics…/digikala-products/…). */
function shownImage(html: string) {
  const m = html.match(/<img[^>]+src=["'](https:\/\/dkstatics-public\.digikala\.com\/digikala-products\/[^"']+)["']/i);
  return m ? decode(m[1]) : "";
}

/** "خرید و قیمت X | دیجی‌کالا" → "X". */
const cleanTitle = (t: string) =>
  t.replace(/^\s*(خرید\s+(?:و\s+)?(?:آنلاین\s+)?(?:قیمت\s+)?|قیمت\s+و\s+خرید\s+)/, "").replace(/\s*[|｜\-–]\s*[^|｜\-–]*(دیجی[‌\s]?کالا|digikala)[^|｜]*$/i, "").trim();

/** schema.org microdata: <… itemprop="price" content="…"> and itemprop="priceCurrency". */
function microdataPrice(html: string) {
  const attr = (prop: string) =>
    html.match(new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`content=["']([^"']+)["'][^>]*itemprop=["']${prop}["']`, "i"))?.[1];
  const amount = attr("price");
  return amount ? sane(toToman(amount, attr("priceCurrency"))) : null;
}

/**
 * A page that's only an app shell (the product is fetched by the browser later), like Digikala's
 * product pages now: no product in it, just the shop's own name.
 */
export function isAppShell(html: string) {
  return /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/routing\/?["']/i.test(html) || /"page"\s*:\s*"\/routing"/.test(html);
}

/** What a product page says about itself, in this order: JSON-LD, product meta tags, microdata, Next.js data. */
export function parseProductHtml(html: string, url: string): WebItem | null {
  if (isAppShell(html)) return null;
  const ld = jsonLdProduct(html);
  const offersRaw = ld?.offers;
  const offer = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as Json | undefined;
  const next = nextDataProduct(html);
  let method = "";
  let price: number | null = null;
  const tryPrice = (p: number | null, how: string) => {
    if (price === null && p !== null) {
      price = p;
      method = how;
    }
  };
  tryPrice(sane(toToman(pick(offer, ["price", "lowPrice", "highPrice"]), offer?.priceCurrency)), "JSON-LD");
  tryPrice(shownPrice(html), "تگ قیمت صفحه (price-container)");
  tryPrice(sane(toToman(meta(html, "product:price:amount") || meta(html, "og:price:amount"), meta(html, "product:price:currency") || meta(html, "og:price:currency"))), "meta product:price");
  tryPrice(microdataPrice(html), "microdata");
  tryPrice(next?.price ?? null, "__NEXT_DATA__");
  const title =
    String(ld?.name ?? "").trim() ||
    shownTitle(html) ||
    cleanTitle(meta(html, "og:title")) ||
    next?.title ||
    firstH1(html) ||
    cleanTitle(decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? ""));
  if (!title) return null;
  const availability = String(offer?.availability ?? meta(html, "product:availability") ?? "");
  // An offer priced 0 means nothing to sell right now (Digikala's out-of-stock products).
  const zeroOffer = offer !== undefined && Number(String(pick(offer, ["price", "lowPrice"]) ?? "").replace(/[^\d.]/g, "")) === 0 && price === null;
  return {
    title: title.slice(0, 200),
    image: imageOf(ld?.image) || meta(html, "og:image") || shownImage(html) || next?.image || "",
    price,
    available: !/OutOfStock|SoldOut|out of stock/i.test(availability) && !zeroOffer && (next?.available ?? true),
    site: siteName(url),
    method: method || "بدون قیمت (فقط نام و عکس)",
  };
}

// Who to ask as. A browser first; when that gets an empty app shell (or no price), the crawlers that
// shops render full pages for: search engines and messenger link previews (title, photo, price tags).
const AGENTS: [string, string][] = [
  [UA, ""],
  ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot"],
  ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Bingbot"],
  ["TelegramBot (like TwitterBot)", "TelegramBot"],
  ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "facebookexternalhit"],
];

async function fetchPage(url: string): Promise<WebItem | null> {
  let best: WebItem | null = null;
  for (const [agent, label] of AGENTS) {
    const res = await fetch(url, {
      headers: { "User-Agent": agent, Accept: "text/html,application/xhtml+xml", "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const item = parseProductHtml((await res.text()).slice(0, 2_000_000), url);
    if (!item) continue; // an app shell: try as the next crawler
    if (label) item.method = `${item.method} (صفحه برای ${label})`;
    if (item.price) return item;
    best ??= item; // a name and photo, still no price: maybe a crawler gets one
  }
  return best;
}

/** Read a product page: Digikala / Digistyle through their product API, any other shop from the page's data. */
export async function fetchWebItem(url: string): Promise<WebItem | null> {
  try {
    // Digikala / Digistyle: their product API; if that's out of reach, the page itself.
    const dk = digikalaId(url);
    if (dk) {
      // The API is where the product is (its pages are an empty app shell); the page only if it has a price.
      const viaApi = await fetchDigikala(dk).catch(() => null);
      if (viaApi?.price || viaApi?.available === false) return viaApi;
      const page = await fetchPage(url).catch(() => null);
      // (A page that says it's out of stock — Digikala shows "price": 0 then — is an answer too.)
      return page?.price || page?.available === false ? page : (viaApi ?? page);
    }
    return await fetchPage(url);
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
/** Keep a copy of a shop's product photo (R2 key, or "" if it can't be fetched). */
async function keepImage(d: Deps, url: string) {
  if (!url) return "";
  const img = await downloadImage(url);
  if (!img) return "";
  const key = `p/${randomSlug(16)}.${img.type === "image/png" ? "png" : img.type === "image/webp" ? "webp" : "jpg"}`;
  await d.images.put(key, img.data, { httpMetadata: { contentType: img.type } });
  return key;
}

/**
 * Read the site again: price (with the commission) and whether it's still sold there. An item added
 * without the page's data (the wisher typed its name) also gets the page's name and photo then.
 */
export async function refreshWebProduct(d: Deps, productId: number) {
  const p = await d.db
    .prepare("SELECT p.id, p.source_url, p.image_key FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = ? AND s.is_platform = 1 AND p.deleted_at IS NULL")
    .bind(productId)
    .first<{ id: number; source_url: string; image_key: string }>();
  if (!p?.source_url) return null;
  const item = await fetchWebItem(p.source_url);
  if (!item) {
    await d.db.prepare("UPDATE products SET source_checked_at = ? WHERE id = ?").bind(now(), p.id).run();
    return null;
  }
  const t = now();
  const updates: D1PreparedStatement[] = [
    item.price
      ? d.db
          .prepare("UPDATE products SET source_price = ?, price = ?, awaiting_price = 0, is_active = ?, source_checked_at = ?, updated_at = ? WHERE id = ?")
          .bind(item.price, retailPrice(item.price, d.settings), item.available ? 1 : 0, t, t, p.id)
      : d.db.prepare("UPDATE products SET is_active = ?, source_checked_at = ? WHERE id = ?").bind(item.available ? 1 : 0, t, p.id),
  ];
  if (!p.image_key) {
    // Added from a typed name: now the page's own name and photo.
    const image = await keepImage(d, item.image);
    updates.push(d.db.prepare("UPDATE products SET title = ?, image_key = ? WHERE id = ?").bind(item.title.slice(0, 120), image, p.id));
    if (image) updates.push(d.db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, 0)").bind(p.id, image));
  }
  await d.db.batch(updates);
  return item;
}

/** Older than this, a product's price is read again when someone looks at it. */
export const STALE_MS = 6 * 3600_000;
export const isStale = (checkedAt: string | null) => !checkedAt || Date.now() - new Date(checkedAt).getTime() > STALE_MS;

export type WebWishResult = { ok: true; productId: number; title: string; priced: boolean; site: string } | { ok: false; error: string; askTitle?: boolean };

/** Put a product from another site on a wishlist (the same link is the same product for everyone). */
export async function addWebWish(d: Deps, user: { id: number }, url: string, wishlistId: number, note = "", typedTitle = ""): Promise<WebWishResult> {
  const db = d.db;
  const shop = await webShop(db, d.settings);
  let product = await db.prepare("SELECT id, title, awaiting_price, source_checked_at FROM products WHERE shop_id = ? AND source_url = ? AND deleted_at IS NULL").bind(shop.id, url).first<{ id: number; title: string; awaiting_price: number; source_checked_at: string | null }>();
  if (product) {
    if (isStale(product.source_checked_at)) await refreshWebProduct(d, product.id);
  } else {
    // Some shops can't be read from here (Digikala answers only its own visitors): with the name the
    // wisher types, the item waits for the admins to price it from the link.
    const item =
      (await fetchWebItem(url)) ??
      (typedTitle.trim() ? { title: typedTitle.trim().slice(0, 120), image: "", price: null, available: true, site: siteName(url), method: "نام از کاربر" } : null);
    if (!item) return { ok: false, error: `اطلاعات این محصول از ${siteName(url) || "این سایت"} خوانده نشد؛ نام محصول را بنویسید تا اضافه شود و قیمتش را تیم ما از همان لینک ثبت کند.`, askTitle: true };
    if (!item.available) return { ok: false, error: `این کالا فعلاً در ${item.site} موجود نیست.` };
    const image = await keepImage(d, item.image);
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

/**
 * The product page's live price (it loads with the saved one): when that's older than STALE_MS, the
 * site is read again now. One reader at a time: the check time is claimed first.
 */
export async function livePrice(d: Deps, productId: number) {
  const row = await d.db
    .prepare("SELECT p.price, p.awaiting_price, p.is_active, p.source_checked_at FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = ? AND s.is_platform = 1 AND p.deleted_at IS NULL")
    .bind(productId)
    .first<{ price: number; awaiting_price: number; is_active: number; source_checked_at: string | null }>();
  if (!row) return null;
  if (isStale(row.source_checked_at)) {
    const claim = await d.db
      .prepare("UPDATE products SET source_checked_at = ? WHERE id = ? AND (source_checked_at IS NULL OR source_checked_at = ?)")
      .bind(now(), productId, row.source_checked_at)
      .run();
    if (claim.meta.changes) await refreshWebProduct(d, productId);
  }
  const fresh = (await d.db.prepare("SELECT price, awaiting_price, is_active FROM products WHERE id = ?").bind(productId).first<{ price: number; awaiting_price: number; is_active: number }>())!;
  return { price: fresh.price, awaiting: !!fresh.awaiting_price, available: !!fresh.is_active, changed: fresh.price !== row.price || fresh.is_active !== row.is_active || fresh.awaiting_price !== row.awaiting_price };
}
