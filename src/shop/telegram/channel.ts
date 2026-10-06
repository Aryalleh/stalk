// A shop's Telegram channel, connected to the site's single Telegram bot:
//  - the shop makes the bot an admin of its channel and posts its connect code there once;
//  - every photo post carrying the shop's tag (#محصول) and a price becomes a product, and edits to
//    the post update it (removing the tag deactivates it — Telegram doesn't tell bots about deletions);
//  - the bot puts "buy" and "add to wishlist" buttons under the post, opening the mini app.
import { botUsername, deleteBotMessage, downloadBotFile, sendToChats, setButtons, type InlineKeyboard } from "../../bale/botapi";
import type { Settings } from "../../settings";
import { now, productCode, randomSlug, type Shop } from "../db";
import { shopOwnerChats } from "../orders";
import { parsePost } from "./parse";

export interface ChannelPost {
  message_id: number;
  chat: { id: number; type?: string; title?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_unique_id: string; width?: number; height?: number; file_size?: number }[];
  media_group_id?: string;
  reply_markup?: InlineKeyboard;
}

interface Deps {
  db: D1Database;
  images: R2Bucket;
  settings: Settings;
  siteUrl: string;
}

const MAX_PHOTO = 8 * 1024 * 1024;

/** A fresh connect code for the panel: "KD-7F3A9C". */
export const newLinkCode = () => `KD-${randomSlug(6).toUpperCase()}`;

/** t.me link that opens the mini app at a start parameter (Main Mini App set in BotFather). */
export function miniAppLink(s: Settings, startParam: string) {
  const u = botUsername(s, "telegram");
  return u ? `https://t.me/${u}?startapp=${startParam}` : "";
}

export function postButtons(s: Settings, siteUrl: string, productId: number): InlineKeyboard {
  const buy = miniAppLink(s, `b_${productId}`) || `${siteUrl}/p/${productId}/buy`;
  const wish = miniAppLink(s, `h_${productId}`) || `${siteUrl}/p/${productId}#wish`;
  return { inline_keyboard: [[{ text: "🛒 خرید", url: buy }, { text: "❤️ افزودن به لیست آرزو", url: wish }]] };
}

const hasOurButtons = (post: ChannelPost, productId: number) =>
  !!post.reply_markup?.inline_keyboard?.some((row) => row.some((b) => (b.url ?? "").includes(`b_${productId}`) || (b.url ?? "").includes(`/p/${productId}/`)));

async function storePhoto(d: Deps, fileId: string) {
  const { data, path } = await downloadBotFile(d.settings, "telegram", fileId);
  if (data.byteLength > MAX_PHOTO) throw new Error("عکس بزرگ‌تر از ۸ مگابایت است");
  const ext = /\.png$/i.test(path) ? "png" : /\.webp$/i.test(path) ? "webp" : "jpg";
  const key = `p/tg/${randomSlug(16)}.${ext}`;
  await d.images.put(key, data, { httpMetadata: { contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}` } });
  return key;
}

const largest = (post: ChannelPost) => (post.photo?.length ? post.photo[post.photo.length - 1] : null);

async function notifyOwner(d: Deps, shopId: number, text: string) {
  const chats = await shopOwnerChats(d.db, shopId);
  if (chats) await sendToChats(d.settings, chats, text).catch(() => undefined);
}

/** One channel_post / edited_channel_post update from the Telegram bot. */
export async function handleChannelPost(d: Deps, post: ChannelPost, edited: boolean) {
  if (post.chat?.type !== "channel") return;
  const chatId = String(post.chat.id);
  const body = post.caption ?? post.text ?? "";

  // Connecting: the shop posts its code from the panel in the channel.
  const code = body.match(/\bKD-[A-Z0-9]{6}\b/)?.[0];
  if (code && !edited) {
    const shop = await d.db.prepare("SELECT * FROM shops WHERE tg_link_code = ?").bind(code).first<Shop>();
    if (shop) {
      await d.db.batch([
        d.db.prepare("UPDATE shops SET tg_channel_id = '', tg_channel_title = '', tg_channel_username = '' WHERE tg_channel_id = ? AND id <> ?").bind(chatId, shop.id),
        d.db
          .prepare("UPDATE shops SET tg_channel_id = ?, tg_channel_title = ?, tg_channel_username = ?, tg_link_code = '', tg_last_error = '' WHERE id = ?")
          .bind(chatId, post.chat.title ?? "", post.chat.username ?? "", shop.id),
      ]);
      await deleteBotMessage(d.settings, "telegram", chatId, post.message_id).catch(() => undefined);
      await notifyOwner(d, shop.id, `✅ کانال «${post.chat.title ?? ""}» به فروشگاه «${shop.name}» وصل شد. از این به بعد پست‌های دارای ${shop.tg_tag} با عکس و قیمت، خودکار محصول می‌شوند.`);
      return;
    }
  }

  const shop = await d.db.prepare("SELECT * FROM shops WHERE tg_channel_id = ?").bind(chatId).first<Shop>();
  if (!shop) return;
  const photo = largest(post);

  // An album: Telegram sends each photo as its own post; the caption rides on one of them.
  if (post.media_group_id && photo && !body.trim()) {
    const product = await d.db
      .prepare("SELECT id FROM products WHERE tg_chat_id = ? AND tg_media_group = ? AND shop_id = ?")
      .bind(chatId, post.media_group_id, shop.id)
      .first<{ id: number }>();
    if (product) {
      const exists = await d.db.prepare("SELECT 1 AS x FROM tg_album_photos WHERE chat_id = ? AND message_id = ?").bind(chatId, post.message_id).first();
      if (!exists) {
        const key = await storePhoto(d, photo.file_id);
        await d.db.batch([
          d.db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM product_images WHERE product_id = ?))").bind(product.id, key, product.id),
          d.db.prepare("INSERT OR IGNORE INTO tg_album_photos (chat_id, media_group, message_id, file_id, created_at) VALUES (?, ?, ?, '', ?)").bind(chatId, post.media_group_id, post.message_id, now()),
        ]);
      }
    } else {
      await d.db
        .prepare("INSERT OR IGNORE INTO tg_album_photos (chat_id, media_group, message_id, file_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(chatId, post.media_group_id, post.message_id, photo.file_id, now())
        .run();
    }
    return;
  }

  const existing = await d.db
    .prepare("SELECT id, tg_photo_uid, is_active FROM products WHERE tg_chat_id = ? AND tg_message_id = ? AND shop_id = ?")
    .bind(chatId, post.message_id, shop.id)
    .first<{ id: number; tg_photo_uid: string; is_active: number }>();
  const parsed = parsePost(body, shop.tg_tag || "#محصول");

  if (!parsed) {
    // The tag was removed (or the price) in an edit: take the product off the site.
    if (existing && existing.is_active) {
      await d.db.prepare("UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?").bind(now(), existing.id).run();
    } else if (!existing && body.includes((shop.tg_tag || "#محصول").replace(/^#?/, "#")) && photo) {
      const msg = "پست برچسب محصول دارد ولی قیمتش پیدا نشد؛ یک خط «قیمت: ۴۵۰ هزار تومان» بنویسید و پست را ویرایش کنید.";
      await d.db.prepare("UPDATE shops SET tg_last_error = ? WHERE id = ?").bind(msg, shop.id).run();
      await notifyOwner(d, shop.id, `⚠️ ${msg}`);
    }
    return;
  }

  if (existing) {
    let cover: string | null = null;
    if (photo && photo.file_unique_id !== existing.tg_photo_uid) cover = await storePhoto(d, photo.file_id);
    const stmts = [
      d.db
        .prepare("UPDATE products SET title = ?, price = ?, description = ?, colors = ?, is_active = 1, updated_at = ? WHERE id = ?")
        .bind(parsed.title, parsed.price, parsed.description, parsed.colors.join("\n"), now(), existing.id),
    ];
    if (cover) {
      stmts.push(
        d.db.prepare("UPDATE products SET image_key = ?, tg_photo_uid = ? WHERE id = ?").bind(cover, photo!.file_unique_id, existing.id),
        d.db.prepare("UPDATE product_images SET image_key = ? WHERE product_id = ? AND sort = 0").bind(cover, existing.id),
      );
    }
    await d.db.batch(stmts);
    if (shop.tg_buttons && !hasOurButtons(post, existing.id)) {
      await setButtons(d.settings, "telegram", chatId, post.message_id, postButtons(d.settings, d.siteUrl, existing.id)).catch(() => undefined);
    }
    return;
  }

  if (!photo || edited) return; // a new product needs a photo; an edit of an older untagged post is left alone
  const cover = await storePhoto(d, photo.file_id);
  const t = now();
  const row = await d.db
    .prepare(
      `INSERT INTO products (shop_id, title, description, price, image_key, colors, is_active, tg_chat_id, tg_message_id, tg_media_group, tg_photo_uid, created_at, updated_at, code)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tg_chat_id, tg_message_id) WHERE tg_chat_id IS NOT NULL DO NOTHING RETURNING id`,
    )
    .bind(shop.id, parsed.title, parsed.description, parsed.price, cover, parsed.colors.join("\n"), chatId, post.message_id, post.media_group_id ?? null, photo.file_unique_id, t, t, productCode(shop.slug))
    .first<{ id: number }>();
  if (!row) return; // the same post delivered twice
  await d.db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, 0)").bind(row.id, cover).run();
  if (post.media_group_id) {
    // Album photos that came in before this caption.
    const { results } = await d.db
      .prepare("SELECT message_id, file_id FROM tg_album_photos WHERE chat_id = ? AND media_group = ? AND file_id <> '' ORDER BY message_id")
      .bind(chatId, post.media_group_id)
      .all<{ message_id: number; file_id: string }>();
    for (const [i, p] of results.slice(0, 7).entries()) {
      const key = await storePhoto(d, p.file_id).catch(() => null);
      if (key) await d.db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, ?)").bind(row.id, key, i + 1).run();
    }
    await d.db.prepare("UPDATE tg_album_photos SET file_id = '' WHERE chat_id = ? AND media_group = ?").bind(chatId, post.media_group_id).run();
  }
  await d.db.prepare("UPDATE shops SET tg_last_error = '' WHERE id = ?").bind(shop.id).run();
  if (shop.tg_buttons) {
    await setButtons(d.settings, "telegram", chatId, post.message_id, postButtons(d.settings, d.siteUrl, row.id)).catch(async (e) => {
      await d.db.prepare("UPDATE shops SET tg_last_error = ? WHERE id = ?").bind(`دکمه‌ها اضافه نشد: ${(e as Error).message}`.slice(0, 300), shop.id).run();
    });
  }
}
