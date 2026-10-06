// Posting to the shop's Telegram channel from the panel: a product (cover photo, title, price,
// description, buy / wishlist buttons) or the storefront (cover or logo, intro, "open the shop").
// The bot must be an admin of the channel with "Post messages" (it already is once the channel is
// connected). These posts carry no product tag, so the channel importer never turns them into products.
import { sendBotMessage, sendBotPhoto, type InlineKeyboard } from "../../bale/botapi";
import type { Settings } from "../../settings";
import { now, toman, type Product, type Shop } from "../db";
import { miniAppLink, postButtons } from "./channel";

interface Deps {
  db: D1Database;
  images: R2Bucket;
  settings: Settings;
  siteUrl: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Telegram's own error text, in a sentence the shop owner can act on. */
export function shareError(e: unknown) {
  const m = String((e as Error)?.message ?? e);
  if (/not enough rights|need administrator|CHAT_ADMIN_REQUIRED/i.test(m)) return "بات در کانال اجازه ارسال پست ندارد؛ آن را ادمین با دسترسی «Post messages» کنید.";
  if (/chat not found|bot is not a member|kicked/i.test(m)) return "بات عضو کانال نیست یا از آن حذف شده؛ دوباره ادمینش کنید.";
  if (/token is not configured/i.test(m)) return "بات تلگرام سایت تنظیم نشده است.";
  return `ارسال به کانال ناموفق بود: ${m.slice(0, 200)}`;
}

async function photoOf(images: R2Bucket, key: string) {
  if (!key) return null;
  const obj = await images.get(key);
  if (!obj) return null;
  return { data: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType ?? "image/jpeg", name: key.split("/").pop() ?? "photo.jpg" };
}

async function send(d: Deps, chatId: string, imageKey: string, caption: string, markup: InlineKeyboard) {
  const photo = await photoOf(d.images, imageKey).catch(() => null);
  return photo ? sendBotPhoto(d.settings, "telegram", chatId, photo, caption, markup) : sendBotMessage(d.settings, "telegram", chatId, caption.slice(0, 4096), markup);
}

/** The lowest price a buyer can pay: a size/colour's own price when one is set lower than the product's. */
async function lowestPrice(db: D1Database, p: Product) {
  const row = await db.prepare("SELECT MIN(price) AS m FROM product_stock WHERE product_id = ? AND price IS NOT NULL AND price > 0").bind(p.id).first<{ m: number | null }>();
  return row?.m && row.m < p.price ? { price: row.m, from: true } : { price: p.price, from: false };
}

export function productCaption(p: Product, shop: Shop, price: { price: number; from: boolean }, link: string) {
  const lines = [`🛍 ${p.title}`, ""];
  if (p.description.trim()) lines.push(clip(p.description.trim(), 600), "");
  lines.push(`💰 قیمت: ${price.from ? "از " : ""}${toman(price.price)}`);
  if (p.colors.trim()) lines.push(`🎨 رنگ‌ها: ${p.colors.split("\n").map((c) => c.trim()).filter(Boolean).join("، ")}`);
  lines.push("", `🏪 ${shop.name}`, `🔗 ${link}`);
  return clip(lines.join("\n"), 1024);
}

/** Post one product to the shop's channel; returns the new message id. */
export async function postProductToChannel(d: Deps, shop: Shop, p: Product) {
  if (!shop.tg_channel_id) throw new Error("کانال تلگرام وصل نیست.");
  const price = await lowestPrice(d.db, p);
  const caption = productCaption(p, shop, price, `${d.siteUrl}/p/${p.code || p.id}`);
  const msg = await send(d, shop.tg_channel_id, p.image_key, caption, postButtons(d.settings, d.siteUrl, p.id));
  await d.db
    .prepare("UPDATE products SET tg_shared_chat = ?, tg_shared_message = ?, tg_shared_at = ? WHERE id = ?")
    .bind(shop.tg_channel_id, msg?.message_id ?? null, now(), p.id)
    .run();
  return msg?.message_id ?? null;
}

export function shopCaption(shop: Shop, products: number, link: string) {
  const lines = [`🏪 ${shop.name}${shop.city ? ` · ${shop.city}` : ""}`, ""];
  if (shop.description?.trim()) lines.push(clip(shop.description.trim(), 600), "");
  if (products) lines.push(`🛍 ${products.toLocaleString("fa-IR")} محصول`, "");
  lines.push("👇 ویترین فروشگاه را باز کنید، محصول را ببینید و همان‌جا بخرید یا به لیست آرزویتان اضافه کنید.", "", `🔗 ${link}`);
  return clip(lines.join("\n"), 1024);
}

/** Post the storefront (cover or logo, intro, "open the shop" button) to the shop's channel. */
export async function postShopToChannel(d: Deps, shop: Shop) {
  if (!shop.tg_channel_id) throw new Error("کانال تلگرام وصل نیست.");
  const count = await d.db.prepare("SELECT COUNT(*) AS n FROM products WHERE shop_id = ? AND is_active = 1").bind(shop.id).first<{ n: number }>();
  const site = `${d.siteUrl}/s/${shop.slug}`;
  const inApp = miniAppLink(d.settings, `s_${shop.slug}`);
  const markup: InlineKeyboard = {
    inline_keyboard: inApp
      ? [[{ text: "🛍 ورود به ویترین", url: inApp }], [{ text: "🌐 مشاهده در سایت", url: site }]]
      : [[{ text: "🛍 ورود به ویترین", url: site }]],
  };
  const msg = await send(d, shop.tg_channel_id, shop.cover_key || shop.logo_key, shopCaption(shop, count?.n ?? 0, site), markup);
  await d.db.prepare("UPDATE shops SET tg_shop_post_at = ? WHERE id = ?").bind(now(), shop.id).run();
  return msg?.message_id ?? null;
}
