import type { Bindings } from "../env";

// Bale's bot API is Telegram-compatible; only the host differs.
const BOT_API = {
  bale: "https://tapi.bale.ai/bot",
  telegram: "https://api.telegram.org/bot",
} as const;
export type BotKind = keyof typeof BOT_API;

export function botToken(env: Bindings, kind: BotKind) {
  return kind === "bale" ? env.BALE_BOT_TOKEN : env.TELEGRAM_BOT_TOKEN;
}

export async function sendBotMessage(env: Bindings, kind: BotKind, chatId: string, text: string) {
  const token = botToken(env, kind);
  if (!token) throw new Error(`${kind} bot token is not configured`);
  const res = await fetch(`${BOT_API[kind]}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`${kind} sendMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export interface OrderInfo {
  id: number;
  product_title: string;
  amount: number;
  gift_message: string;
  giver_name: string;
  giver_phone: string;
  is_anonymous: number;
  transfer_ref: string;
  transfer_card_last4: string;
  transfer_at: string;
  receipt_key: string;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_postal_code: string;
}

const fa = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;
const lines = (...l: string[]) => l.filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();

/** Sent when a giver reports a card-to-card transfer: the shop must check its account and confirm. */
export function transferMessage(o: OrderInfo, siteUrl: string) {
  return lines(
    `💳 اعلام واریز کارت به کارت — سفارش کادویی #${o.id}`,
    `محصول: ${o.product_title}`,
    `مبلغ: ${fa(o.amount)}`,
    `شماره پیگیری: ${o.transfer_ref}`,
    `۴ رقم آخر کارت مبدأ: ${o.transfer_card_last4}`,
    o.transfer_at ? `زمان واریز (طبق اعلام خریدار): ${o.transfer_at}` : "",
    o.receipt_key ? "رسید واریز پیوست شده (در پنل)." : "",
    `خریدار: ${o.giver_name} — ${o.giver_phone}`,
    "",
    "لطفاً حساب خود را بررسی کنید و در پنل «تأیید واریز» یا «رد» را بزنید. بعد از تأیید، آدرس گیرنده نمایش داده می‌شود:",
    `${siteUrl}/panel/orders/${o.id}`,
  );
}

/** Sent after the shop confirms payment: what to send and where. */
export function shipMessage(o: OrderInfo, siteUrl: string) {
  return lines(
    `🎁 سفارش کادویی #${o.id} — پرداخت تأیید شد، لطفاً ارسال کنید`,
    `محصول: ${o.product_title}`,
    "",
    `گیرنده: ${o.ship_name}`,
    `تلفن: ${o.ship_phone}`,
    `آدرس: ${o.ship_address}`,
    `کد پستی: ${o.ship_postal_code}`,
    "",
    `از طرف: ${o.is_anonymous ? "ناشناس" : o.giver_name}`,
    o.gift_message ? `پیام روی کارت هدیه: ${o.gift_message}` : "",
    "",
    `ثبت کد رهگیری: ${siteUrl}/panel/orders/${o.id}`,
  );
}

/** Send to every channel the shop configured. Returns an error summary ("" if all succeeded). */
export async function notifyShop(env: Bindings, shop: { bale_chat_id: string; telegram_chat_id: string }, text: string) {
  const targets: [BotKind, string][] = [];
  if (shop.bale_chat_id) targets.push(["bale", shop.bale_chat_id]);
  if (shop.telegram_chat_id) targets.push(["telegram", shop.telegram_chat_id]);
  if (!targets.length) return "no channel configured";
  const results = await Promise.allSettled(targets.map(([k, id]) => sendBotMessage(env, k, id, text)));
  return results
    .map((r, i) => (r.status === "rejected" ? `${targets[i][0]}: ${(r.reason as Error).message}` : ""))
    .filter(Boolean)
    .join("; ");
}
