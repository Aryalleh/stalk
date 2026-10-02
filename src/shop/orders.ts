// Order actions shared by the shop panel and the bot's inline buttons.
import { sendPhotoToChats, sendToChats, type Chats } from "../bale/botapi";
import type { Settings } from "../settings";
import { confirmPayment, rejectPayment, type Order } from "./db";
import { receiptButtons, receiptCaption, shipMessage } from "./notify";

export interface Deps {
  db: D1Database;
  images: R2Bucket;
  settings: Settings;
  siteUrl: string;
}

/** The chats of the shop's owner (its connected Bale/Telegram accounts). */
export async function shopOwnerChats(db: D1Database, shopId: number) {
  return db
    .prepare("SELECT u.bale_chat_id, u.telegram_chat_id FROM shops s JOIN users u ON u.id = s.owner_id WHERE s.id = ?")
    .bind(shopId)
    .first<Chats>();
}

async function recordNotify(db: D1Database, orderId: number, error: string) {
  await db.prepare("UPDATE orders SET shop_notified = ?, notify_error = ? WHERE id = ?").bind(error ? 0 : 1, error, orderId).run();
}

/** Send the giver's receipt photo to the shop owner with confirm / reject buttons. */
export async function sendReceiptToShop(d: Deps, orderId: number) {
  const o = await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>();
  if (!o) return;
  const chats = await shopOwnerChats(d.db, o.shop_id);
  let error = "no connected chat";
  try {
    const obj = o.receipt_key ? await d.images.get(o.receipt_key) : null;
    if (chats && obj) {
      const photo = { data: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType ?? "image/jpeg", name: o.receipt_key.split("/").pop()! };
      error = await sendPhotoToChats(d.settings, chats, photo, receiptCaption(o), () => receiptButtons(o.id, d.siteUrl));
    }
  } catch (e) {
    error = String(e);
  }
  await recordNotify(d.db, o.id, error);
}

/** Shop confirmed the money arrived: mark paid and send the delivery details. Returns false if not awaiting. */
export async function confirmOrder(d: Deps, orderId: number, shopId: number) {
  if (!(await confirmPayment(d.db, orderId, shopId))) return false;
  const o = await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>();
  const chats = await shopOwnerChats(d.db, shopId);
  if (o && chats) await recordNotify(d.db, o.id, await sendToChats(d.settings, chats, shipMessage(o, d.siteUrl)).catch((e) => String(e)));
  return true;
}

export async function rejectOrder(d: Deps, orderId: number, shopId: number, reason: string) {
  return rejectPayment(d.db, orderId, shopId, reason);
}
