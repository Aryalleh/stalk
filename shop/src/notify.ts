import type { Bindings } from "./env";

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

export interface PaidOrderInfo {
  id: number;
  product_title: string;
  amount: number;
  gift_message: string;
  giver_name: string;
  is_anonymous: number;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_postal_code: string;
}

export function orderMessage(o: PaidOrderInfo, siteUrl: string) {
  return [
    `🎁 سفارش کادویی جدید #${o.id}`,
    `محصول: ${o.product_title}`,
    `مبلغ پرداخت‌شده: ${o.amount.toLocaleString("fa-IR")} تومان`,
    "",
    "لطفاً برای این گیرنده ارسال کنید:",
    `گیرنده: ${o.ship_name}`,
    `تلفن: ${o.ship_phone}`,
    `آدرس: ${o.ship_address}`,
    `کد پستی: ${o.ship_postal_code}`,
    "",
    `از طرف: ${o.is_anonymous ? "ناشناس" : o.giver_name}`,
    o.gift_message ? `پیام روی کارت هدیه: ${o.gift_message}` : "",
    "",
    `جزئیات و ثبت کد رهگیری: ${siteUrl}/panel/orders/${o.id}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
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
