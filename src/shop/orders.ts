// Order actions shared by the shop panel and the bot's inline buttons.
import { sendPhotoToChats, sendToChats, type Chats } from "../bale/botapi";
import type { Settings } from "../settings";
import { addressPending, adjustStock, cancelOutOfStock, confirmPayment, now, rejectPayment, toman, type Order } from "./db";
import { variantLabel } from "./variants";
import { syncGiftBuyer } from "./crm/db";
import { receiptButtons, receiptCaption, shipMessage } from "./notify";
import { dmPage } from "./instagram-shops";
import { sendDm } from "./crm/instagram";

export interface Deps {
  db: D1Database;
  images: R2Bucket;
  settings: Settings;
  siteUrl: string;
}

/**
 * The chats of the shop's owner (its connected Bale/Telegram accounts). An Instagram page not on
 * the platform (an external shop) and the "buy from other sites" shop are run by the platform: their
 * orders go to the first admin with a connected bot, who also confirms them.
 */
export async function shopOwnerChats(db: D1Database, shopId: number) {
  return db
    .prepare(
      `SELECT u.bale_chat_id, u.telegram_chat_id FROM shops s JOIN users u ON u.id = CASE WHEN s.is_external = 1 OR s.is_platform = 1 THEN COALESCE(
         (SELECT a.id FROM users a WHERE a.is_admin = 1 AND (a.bale_chat_id <> '' OR a.telegram_chat_id <> '') ORDER BY a.id LIMIT 1), s.owner_id)
       ELSE s.owner_id END WHERE s.id = ?`,
    )
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
  // An Instagram page not on the site hears it in its DM with the site's Instagram account; if
  // that fails (it hasn't written in 24 hours), the admins get the receipt instead, to reach it.
  const external = await d.db.prepare("SELECT is_external FROM shops WHERE id = ?").bind(o.shop_id).first<{ is_external: number }>();
  if (external?.is_external) {
    const v = variantLabel(o.size, o.color);
    const text = [
      `💰 سفارش تازه #${o.id}: «${o.product_title}»${v ? ` (${v})` : ""}`,
      `خریدار ${toman(o.amount)} به کارت شما واریز کرده است.`,
      `پیگیری واریز: ${o.transfer_ref || "—"} — ۴ رقم آخر کارت خریدار: ${o.transfer_card_last4 || "—"}${o.transfer_at ? ` — ${o.transfer_at}` : ""}`,
      "",
      `اگر رسید: تایید ${o.id}`,
      `اگر نرسید: رد ${o.id} دلیل`,
    ].join("\n");
    if (await dmPage(d, o.shop_id, text)) {
      await recordNotify(d.db, o.id, "");
      return;
    }
  }
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

/**
 * Shop confirmed the money arrived: mark paid, then the recipient gives (no saved address) or confirms
 * the address first — within 24 hours, else the saved one is used. The shop sees the address only
 * then, so nothing goes to an old address. Returns false if not awaiting.
 */
export async function confirmOrder(d: Deps, orderId: number, shopId: number) {
  if (!(await confirmPayment(d.db, orderId, shopId))) return false;
  let o = await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>();
  if (o) await syncGiftBuyer(d.db, o).catch((e) => console.error("crm sync", e));
  if (!o) return true;
  const list = await d.db.prepare("SELECT is_direct FROM wishlists WHERE id = ?").bind(o.wishlist_id).first<{ is_direct: number }>();
  // A purchase for oneself carries the address just typed: nothing to confirm.
  const ask: AddressAsk = list?.is_direct ? "none" : o.ship_address.trim() ? "confirm" : "give";
  if (ask !== "none") {
    const t = now();
    await d.db
      .prepare("UPDATE orders SET address_asked_at = ?, address_due_at = ? WHERE id = ?")
      .bind(t, ask === "confirm" ? new Date(Date.now() + ADDRESS_HOURS * 3600_000).toISOString() : null, o.id)
      .run();
    o = { ...o, address_asked_at: t };
  }
  // (An Instagram page confirming from its DM gets the same in the reply there.)
  const external = await d.db.prepare("SELECT is_external FROM shops WHERE id = ?").bind(shopId).first<{ is_external: number }>();
  const chats = external?.is_external ? null : await shopOwnerChats(d.db, shopId);
  if (chats) {
    const text = ask === "none" ? shipMessage(o, d.siteUrl) : waitingAddressMessage(o, ask);
    await recordNotify(d.db, o.id, await sendToChats(d.settings, chats, text).catch((e) => String(e)));
  }
  await tellPaid(d, o, ask);
  return true;
}

type AddressAsk = "none" | "give" | "confirm";
/** How long a recipient has to confirm or change a saved address. */
export const ADDRESS_HOURS = 24;
const hoursFa = ADDRESS_HOURS.toLocaleString("fa-IR");

const waitingAddressMessage = (o: Order, ask: AddressAsk) =>
  `✅ پرداخت سفارش #${o.id} («${o.product_title}») تأیید شد.\n📍 ` +
  (ask === "give"
    ? "گیرنده آدرس ثابتی ثبت نکرده؛ از او آدرس فعلی‌اش را خواستیم و به‌محض ثبت، آدرس را برایتان می‌فرستیم."
    : `از گیرنده خواستیم آدرسش را تأیید یا به‌روز کند (حداکثر ${hoursFa} ساعت)؛ بعد آدرس را برایتان می‌فرستیم.`) +
  " تا آن موقع ارسال نکنید.";

/** The page where the recipient gives or confirms the address for a gift. */
export const addressLink = (d: Deps, o: { id: number }) => `${d.siteUrl}/me/gifts/${o.id}/address`;

/** Send the shop the delivery details (an Instagram page in its DM, else its owner's / the admins' bot). */
async function sendAddressToShop(d: Deps, o: Order, header: string) {
  const text = `${header}\n${shipMessage(o, d.siteUrl)}`;
  const external = await d.db.prepare("SELECT is_external FROM shops WHERE id = ?").bind(o.shop_id).first<{ is_external: number }>();
  if (external?.is_external && (await dmPage(d, o.shop_id, `${text}\n\nبعد از ارسال: ارسال ${o.id} کدرهگیری`))) {
    await recordNotify(d.db, o.id, "");
    return;
  }
  const chats = await shopOwnerChats(d.db, o.shop_id);
  await recordNotify(d.db, o.id, chats ? await sendToChats(d.settings, chats, text).catch((e) => String(e)) : "no connected chat");
}

/**
 * The recipient gave, confirmed or changed the address of a paid order: save it and send the shop the
 * delivery details. Returns false if it's too late (shipped).
 */
export async function setOrderAddress(d: Deps, orderId: number, a: { name: string; phone: string; city: string; address: string; postal_code: string }) {
  const before = await d.db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'paid'").bind(orderId).first<Order>();
  if (!before) return false;
  await d.db
    .prepare("UPDATE orders SET ship_name = ?, ship_phone = ?, ship_city = ?, ship_address = ?, ship_postal_code = ?, address_at = ? WHERE id = ? AND status = 'paid'")
    .bind(a.name, a.phone, a.city, a.address, a.postal_code, now(), orderId)
    .run();
  const o = (await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>())!;
  const same =
    before.ship_name === o.ship_name && before.ship_phone === o.ship_phone && before.ship_city === o.ship_city &&
    before.ship_address === o.ship_address && before.ship_postal_code === o.ship_postal_code;
  const header = before.address_at
    ? same ? "" : "🔄 گیرنده آدرس را تغییر داد؛ به این آدرس بفرستید:"
    : !before.ship_address.trim() ? "📍 گیرنده آدرسش را فرستاد." : same ? "📍 گیرنده آدرسش را تأیید کرد." : "📍 گیرنده آدرسش را به‌روز کرد.";
  if (before.address_at && same) return true; // nothing new for the shop
  await sendAddressToShop(d, o, header);
  if (!before.address_at) {
    const people = await orderPeople(d.db, o);
    await say(d, people.giver, `📍 گیرنده آدرسش را ثبت کرد و فروشگاه به‌زودی «${o.product_title}» را ارسال می‌کند.\nپیگیری سفارش: ${orderLink(d, o)}`);
  }
  return true;
}

/**
 * Saved addresses whose time to confirm ran out go to the shop as they are (hourly cron; also right
 * before a shop looks at the order). `orderId` limits it to one order.
 */
export async function releaseDueAddresses(d: Deps, orderId?: number) {
  const t = now();
  const { results } = await d.db
    .prepare(
      `UPDATE orders SET address_at = ?1
       WHERE status = 'paid' AND address_at IS NULL AND address_due_at IS NOT NULL AND address_due_at <= ?1 AND TRIM(ship_address) <> ''
         AND (?2 IS NULL OR id = ?2)
       RETURNING *`,
    )
    .bind(t, orderId ?? null)
    .all<Order>();
  for (const o of results) {
    await sendAddressToShop(d, o, `⏰ گیرنده در ${hoursFa} ساعت آدرس را تغییر نداد؛ آدرس ثبت‌شده‌ی او:`);
    const people = await orderPeople(d.db, o);
    await say(d, people.owner, `📦 آدرس ثبت‌شده‌تان برای ارسال «${o.product_title}» به فروشگاه فرستاده شد. اگر لازم است، تا قبل از ارسال هنوز می‌توانید عوضش کنید:\n${addressLink(d, o)}`);
  }
  return results.length;
}

/** Payment confirmed: the buyer hears it's on its way soon, the recipient that someone bought them a gift. */
async function tellPaid(d: Deps, o: Order, ask: AddressAsk) {
  const people = await orderPeople(d.db, o);
  await say(
    d,
    people.giver,
    ask === "none"
      ? `✅ فروشگاه پرداخت سفارش «${o.product_title}» را تأیید کرد و به‌زودی آن را ارسال می‌کند.\nپیگیری سفارش: ${orderLink(d, o)}`
      : `✅ فروشگاه پرداخت سفارش «${o.product_title}» را تأیید کرد. گیرنده آدرسش را ${ask === "give" ? "ثبت" : "تأیید"} می‌کند و بعد کادو ارسال می‌شود.\nپیگیری سفارش: ${orderLink(d, o)}`,
  );
  if (!people.isDirect) {
    const who = o.is_anonymous ? "یک دوست ناشناس" : await giverName(d.db, o);
    const head = `🎁 ${who} برایتان «${o.product_title}» را از لیست آرزویتان خرید و فروشگاه پرداخت را تأیید کرد!`;
    const text =
      ask === "give"
        ? `${head}\n📍 آدرس فعلی‌تان را بفرستید تا کادو ارسال شود:\n${addressLink(d, o)}`
        : `${head}\n📍 آدرس ثبت‌شده‌تان هنوز درست است؟ تا ${hoursFa} ساعت آینده تأییدش کنید یا آدرس فعلی‌تان را بدهید؛ وگرنه کادو به همان آدرس ثبت‌شده فرستاده می‌شود:\n${addressLink(d, o)}`;
    await say(d, people.owner, text);
    // Someone who adds wishes from Instagram may read it there first (only within Instagram's 24h window).
    if (people.ownerIg && d.settings.platform_ig_token) {
      await sendDm(d.settings.platform_ig_token, d.settings.platform_ig_account_id, people.ownerIg, text).catch(() => undefined);
    }
  }
}

/**
 * The shop marks the order shipped and/or sets or changes its tracking code. The buyer and the
 * recipient hear about the shipment and about every later tracking code change. Returns false if the
 * order can't be shipped.
 */
export async function shipOrder(d: Deps, orderId: number, shopId: number, tracking: string) {
  const before = await d.db.prepare("SELECT * FROM orders WHERE id = ? AND shop_id = ?").bind(orderId, shopId).first<Order>();
  if (!before || (before.status !== "paid" && before.status !== "shipped")) return false;
  if (addressPending(before) || !before.ship_address.trim()) return false; // the recipient gives / confirms the address first
  await d.db
    .prepare("UPDATE orders SET status = 'shipped', tracking_code = ?, shipped_at = COALESCE(shipped_at, ?) WHERE id = ?")
    .bind(tracking, now(), orderId)
    .run();
  const firstShip = before.status === "paid";
  if (!firstShip && tracking === before.tracking_code) return true; // nothing new to tell
  const o = { ...before, status: "shipped" as const, tracking_code: tracking };
  const code = tracking ? `\nکد رهگیری مرسوله: ${tracking}` : "";
  const people = await orderPeople(d.db, o);
  if (firstShip) {
    await say(d, people.giver, `📦 سفارش «${o.product_title}» ارسال شد.${code}\nپیگیری سفارش: ${orderLink(d, o)}`);
    if (!people.isDirect) await say(d, people.owner, `📦 کادوی «${o.product_title}» برایتان ارسال شد و به‌زودی به دستتان می‌رسد.${code}`);
  } else {
    const text = tracking ? `🔄 کد رهگیری سفارش «${o.product_title}» به‌روز شد: ${tracking}` : `🔄 کد رهگیری سفارش «${o.product_title}» برداشته شد.`;
    await say(d, people.giver, `${text}\nپیگیری سفارش: ${orderLink(d, o)}`);
    if (!people.isDirect) await say(d, people.owner, text);
  }
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
  const owner = await db
    .prepare("SELECT w.user_id, w.is_direct, u.ig_user_id FROM wishlists w JOIN users u ON u.id = w.user_id WHERE w.id = ?")
    .bind(o.wishlist_id)
    .first<{ user_id: number; is_direct: number; ig_user_id: string | null }>();
  return {
    isDirect: !!owner?.is_direct,
    ownerIg: owner?.ig_user_id ?? "",
    owner: owner ? await userChats(db, "id = ?", owner.user_id) : null,
    giver: o.giver_phone ? await userChats(db, "phone = ?", o.giver_phone) : null,
  };
}

const orderLink = (d: Deps, o: Order) => `${d.siteUrl}/order/${o.token}`;

/** The buyer's public name: their account nickname, else the name they typed at checkout. */
async function giverName(db: D1Database, o: Order) {
  const u = o.giver_phone ? await db.prepare("SELECT nickname FROM users WHERE phone = ?").bind(o.giver_phone).first<{ nickname: string }>() : null;
  return u?.nickname || o.giver_name || "یک دوست";
}

const say = (d: Deps, to: Chats | null, text: string) => (to ? sendToChats(d.settings, to, text).catch((e) => String(e)) : Promise.resolve(""));

/** The shop cancels because it can't supply the item. Returns false if the order can't be canceled. */
export async function cancelForStock(d: Deps, orderId: number, shopId: number, reason: string, refundNote: string) {
  if (!(await cancelOutOfStock(d.db, orderId, shopId, reason, refundNote))) return false;
  const o = (await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>())!;
  if (o.paid_at) await syncGiftBuyer(d.db, o).catch((e) => console.error("crm sync", e));
  const people = await orderPeople(d.db, o);
  const refund = o.paid_at ? `\nمبلغ ${toman(o.amount)} به خریدار برگردانده می‌شود${refundNote ? ` (${refundNote})` : ""}.` : "";
  await say(d, people.giver, `⚠️ سفارش «${o.product_title}» به‌علت ناموجود شدن کالا لغو شد.${reason ? `\n${reason}` : ""}${refund}\n${d.siteUrl}/order/${o.token}`);
  if (!people.isDirect) await say(d, people.owner, `⚠️ کادوی «${o.product_title}» که برایتان خریده شده بود ناموجود شد و فروشگاه آن را لغو کرد؛ این آرزو دوباره در لیست شما فعال است.`);
  return true;
}

/**
 * The shop proposes another size and/or color instead (size/color "" = keep the ordered one); the
 * recipient answers at /me/changes/<id>.
 */
export async function requestChange(d: Deps, orderId: number, shopId: number, message: string, size: string, color: string) {
  const r = await d.db
    .prepare(
      `UPDATE orders SET change_status = 'pending', change_message = ?3, change_size = ?4, change_color = ?5, change_reply = ''
       WHERE id = ?1 AND shop_id = ?2 AND status IN ('awaiting', 'paid') AND change_status <> 'pending'`,
    )
    .bind(orderId, shopId, message, size, color)
    .run();
  if (r.meta.changes !== 1) return false;
  const o = (await d.db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>())!;
  // Proposing a change means the ordered size/color ran out: mark it sold out if stock is tracked.
  await d.db.prepare("UPDATE product_stock SET quantity = 0 WHERE product_id = ? AND size = ? AND color = ?").bind(o.product_id, o.size, o.color).run();
  const people = await orderPeople(d.db, o);
  const proposal = [variantLabel(size, color), message].filter(Boolean).join(" — ");
  const ordered = variantLabel(o.size, o.color);
  await say(
    d,
    people.owner,
    `🔁 «${o.product_title}»${ordered ? ` (${ordered})` : ""} تمام شده. فروشگاه پیشنهاد می‌دهد: ${proposal}\nقبول یا رد: ${d.siteUrl}/me/changes/${o.id}`,
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
  const newColor = o.change_color || o.color;
  const r = await d.db
    .prepare("UPDATE orders SET change_status = 'accepted', change_reply = ?2, size = ?3, color = ?4 WHERE id = ?1 AND change_status = 'pending'")
    .bind(o.id, reply, newSize, newColor)
    .run();
  if (r.meta.changes !== 1) return false;
  // A confirmed order already took a unit off the stock; the new size now gives one up too
  // (the old size was declared sold out when the shop made the proposal).
  if (o.paid_at && (newSize !== o.size || newColor !== o.color)) await adjustStock(d.db, o.product_id, newSize, newColor, -1);
  const chosen = variantLabel(newSize, newColor);
  await say(d, shop, `✅ گیرنده پیشنهاد سفارش #${o.id} را پذیرفت${chosen ? ` (${chosen})` : ""}${reply ? `: ${reply}` : ""}.\n${d.siteUrl}/panel/orders/${o.id}`);
  return true;
}
