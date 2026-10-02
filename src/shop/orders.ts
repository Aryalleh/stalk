// Order actions shared by the shop panel and the bot's inline buttons.
import { sendPhotoToChats, sendToChats, type Chats } from "../bale/botapi";
import type { Settings } from "../settings";
import { adjustStock, cancelOutOfStock, confirmPayment, rejectPayment, toman, type Order } from "./db";
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

// ---------- out of stock: cancel, or ask the recipient to accept another size / color ----------

const userChats = (db: D1Database, where: string, value: string | number) =>
  db.prepare(`SELECT bale_chat_id, telegram_chat_id FROM users WHERE ${where} LIMIT 1`).bind(value).first<Chats>();

/** Who to tell about an order: the wishlist owner (recipient) and the buyer, if they have an account. */
async function orderPeople(db: D1Database, o: Order) {
  const owner = await db.prepare("SELECT user_id, is_direct FROM wishlists WHERE id = ?").bind(o.wishlist_id).first<{ user_id: number; is_direct: number }>();
  return {
    isDirect: !!owner?.is_direct,
    owner: owner ? await userChats(db, "id = ?", owner.user_id) : null,
    giver: o.giver_phone ? await userChats(db, "phone = ?", o.giver_phone) : null,
  };
}

const say = (d: Deps, to: Chats | null, text: string) => (to ? sendToChats(d.settings, to, text).catch((e) => String(e)) : Promise.resolve(""));

/** The shop cancels because it can't supply the item. Returns false if the order can't be canceled. */
export async function cancelForStock(d: Deps, orderId: number, shopId: number, reason: string, refundNote: string) {
  if (!(await cancelOutOfStock(d.db, orderId, shopId, reason, refundNote))) return false;
  const o = (await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>())!;
  const people = await orderPeople(d.db, o);
  const refund = o.paid_at ? `\nمبلغ ${toman(o.amount)} به خریدار برگردانده می‌شود${refundNote ? ` (${refundNote})` : ""}.` : "";
  await say(d, people.giver, `⚠️ سفارش «${o.product_title}» به‌علت ناموجود شدن کالا لغو شد.${reason ? `\n${reason}` : ""}${refund}\n${d.siteUrl}/order/${o.token}`);
  if (!people.isDirect) await say(d, people.owner, `⚠️ کادوی «${o.product_title}» که برایتان خریده شده بود ناموجود شد و فروشگاه آن را لغو کرد؛ این آرزو دوباره در لیست شما فعال است.`);
  return true;
}

/** The shop proposes another size and/or color instead; the recipient answers at /me/changes/<id>. */
export async function requestChange(d: Deps, orderId: number, shopId: number, message: string, size: string) {
  const r = await d.db
    .prepare(
      `UPDATE orders SET change_status = 'pending', change_message = ?3, change_size = ?4, change_reply = ''
       WHERE id = ?1 AND shop_id = ?2 AND status IN ('awaiting', 'paid') AND change_status <> 'pending'`,
    )
    .bind(orderId, shopId, message, size)
    .run();
  if (r.meta.changes !== 1) return false;
  const o = (await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>())!;
  // Proposing a change means the ordered size/color ran out: mark it sold out if stock is tracked.
  await d.db.prepare("UPDATE product_stock SET quantity = 0 WHERE product_id = ? AND size = ?").bind(o.product_id, o.size).run();
  const people = await orderPeople(d.db, o);
  const proposal = `${size ? `سایز ${size}` : ""}${size && message ? " — " : ""}${message}`;
  await say(
    d,
    people.owner,
    `🔁 «${o.product_title}»${o.size ? ` در سایز ${o.size}` : ""} تمام شده. فروشگاه پیشنهاد می‌دهد: ${proposal}\nقبول یا رد: ${d.siteUrl}/me/changes/${o.id}`,
  );
  if (!people.isDirect) await say(d, people.giver, `🔁 برای سفارش «${o.product_title}» فروشگاه به گیرنده پیشنهاد تغییر داده و منتظر پاسخ اوست.\n${d.siteUrl}/order/${o.token}`);
  return true;
}

/** The recipient accepts (the order switches to the proposed size) or declines (the order is canceled). */
export async function answerChange(d: Deps, orderId: number, userId: number, accept: boolean, reply: string) {
  const o = await d.db
    .prepare("SELECT o.* FROM orders o JOIN wishlists w ON w.id = o.wishlist_id WHERE o.id = ? AND w.user_id = ? AND o.change_status = 'pending'")
    .bind(orderId, userId)
    .first<Order>();
  if (!o) return false;
  const shop = await shopOwnerChats(d.db, o.shop_id);
  if (!accept) {
    await d.db.prepare("UPDATE orders SET change_status = 'declined', change_reply = ? WHERE id = ?").bind(reply, o.id).run();
    await cancelForStock(d, o.id, o.shop_id, "گیرنده پیشنهاد تغییر را نپذیرفت.", "");
    await say(d, shop, `❌ گیرنده پیشنهاد تغییر سفارش #${o.id} را نپذیرفت؛ سفارش لغو شد.${o.paid_at ? `\nلطفاً ${toman(o.amount)} را به خریدار (${o.giver_phone}) برگردانید و در پنل ثبت کنید.` : ""}`);
    return true;
  }
  const newSize = o.change_size || o.size;
  const r = await d.db
    .prepare("UPDATE orders SET change_status = 'accepted', change_reply = ?2, size = ?3 WHERE id = ?1 AND change_status = 'pending'")
    .bind(o.id, reply, newSize)
    .run();
  if (r.meta.changes !== 1) return false;
  // A confirmed order already took a unit off the stock; the new size now gives one up too
  // (the old size was declared sold out when the shop made the proposal).
  if (o.paid_at && newSize !== o.size) await adjustStock(d.db, o.product_id, newSize, -1);
  await say(d, shop, `✅ گیرنده پیشنهاد سفارش #${o.id} را پذیرفت${newSize ? ` (سایز ${newSize})` : ""}${reply ? `: ${reply}` : ""}.\n${d.siteUrl}/panel/orders/${o.id}`);
  return true;
}
