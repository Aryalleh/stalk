import { variantLabel } from "./variants";
// Texts the bot sends about orders.
import type { InlineKeyboard } from "../bale/botapi";

export interface OrderInfo {
  id: number;
  product_title: string;
  size: string;
  color?: string;
  amount: number;
  item_price: number;
  package_name: string;
  package_price: number;
  delivery_method: string;
  delivery_fee: number;
  gift_message: string;
  giver_name: string;
  giver_phone: string;
  is_anonymous: number;
  ship_name: string;
  ship_phone: string;
  ship_city: string;
  ship_address: string;
  ship_postal_code: string;
}

const fa = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;
const lines = (...l: string[]) => l.filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
export const DELIVERY_LABEL: Record<string, string> = { courier: "پیک", post: "پست" };

function breakdown(o: OrderInfo) {
  return [
    `محصول: ${o.product_title}${variantLabel(o.size, o.color ?? "") ? ` (${variantLabel(o.size, o.color ?? "")})` : ""} — ${fa(o.item_price)}`,
    o.package_name ? `بسته‌بندی: ${o.package_name} — ${fa(o.package_price)}` : "",
    o.delivery_method ? `ارسال با ${DELIVERY_LABEL[o.delivery_method] ?? o.delivery_method} — ${fa(o.delivery_fee)}` : "",
    `جمع کل: ${fa(o.amount)}`,
  ];
}

/** Caption for the receipt photo sent to the shop. */
export function receiptCaption(o: OrderInfo) {
  return lines(
    `🧾 فیش واریز — سفارش کادویی #${o.id}`,
    ...breakdown(o),
    `خریدار: ${o.giver_name} — ${o.giver_phone}`,
    "",
    "اگر این مبلغ به حسابتان رسیده «تأیید» را بزنید؛ بعد از تأیید، آدرس گیرنده برایتان ارسال می‌شود.",
  );
}

/** Confirm / reject buttons under the receipt (plus a panel link when the site is on https). */
export function receiptButtons(orderId: number, siteUrl: string): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [
    [
      { text: "✅ تأیید واریز", callback_data: `pay:ok:${orderId}` },
      { text: "❌ رد واریز", callback_data: `pay:no:${orderId}` },
    ],
  ];
  if (siteUrl.startsWith("https://")) rows.push([{ text: "جزئیات در پنل", url: `${siteUrl}/panel/orders/${orderId}` }]);
  return { inline_keyboard: rows };
}

/** Sent after the shop confirms payment: what to send and where. */
export function shipMessage(o: OrderInfo, siteUrl: string) {
  return lines(
    `🎁 سفارش کادویی #${o.id} — پرداخت تأیید شد، لطفاً ارسال کنید`,
    ...breakdown(o),
    "",
    `گیرنده: ${o.ship_name}`,
    `تلفن: ${o.ship_phone}`,
    o.ship_city ? `شهر: ${o.ship_city}` : "",
    `آدرس: ${o.ship_address}`,
    `کد پستی: ${o.ship_postal_code}`,
    "",
    `از طرف: ${o.is_anonymous ? "ناشناس" : o.giver_name}`,
    o.gift_message ? `پیام روی کارت هدیه: ${o.gift_message}` : "",
    "",
    `ثبت کد رهگیری: ${siteUrl}/panel/orders/${o.id}`,
  );
}
