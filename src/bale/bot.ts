import { Hono } from "hono";
import { safeEqual } from "../../lib/auth";
import { normalizePhone } from "../../lib/normalize";
import type { Env } from "../env";
import { botToken, sendBotMessage, type BotKind } from "../shop/notify";
import { saveLink } from "./links";

// Webhook for the site's Bale/Telegram bots (registered from /admin/settings → "connect").
//  - Any message: reply with the chat id (shops paste it into their panel) and a "share my number" button.
//  - A shared contact (Bale): link that phone to this chat, so the CRM can message it for free.

export const bot = new Hono<Env>();

interface Update {
  message?: {
    chat?: { id?: number };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
    contact?: { phone_number?: string; user_id?: number; first_name?: string };
  };
}

const SHARE_KEYBOARD = {
  keyboard: [[{ text: "📱 اشتراک شماره من", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const REMOVE_KEYBOARD = { remove_keyboard: true };

export function startReply(chatId: number | string, siteName: string) {
  return [
    `سلام! به بات ${siteName} خوش آمدید.`,
    "",
    "برای دریافت پیام‌ها و اطلاع‌رسانی‌ها، با دکمه پایین شماره موبایلتان را به اشتراک بگذارید.",
    "",
    `شناسه چت شما: ${chatId}`,
    "(اگر فروشگاه هستید، این عدد را در «پنل فروشگاه ← تنظیمات» وارد کنید.)",
  ].join("\n");
}

bot.post("/bot/:kind{bale|telegram}/:secret", async (c) => {
  const kind = c.req.param("kind") as BotKind;
  const s = c.get("settings");
  if (!s.bot_webhook_secret || !safeEqual(c.req.param("secret"), s.bot_webhook_secret) || !botToken(s, kind)) {
    return c.text("forbidden", 403);
  }
  const msg = ((await c.req.json().catch(() => null)) as Update | null)?.message;
  const chatId = msg?.chat?.id;
  if (chatId === undefined) return c.json({ ok: true });

  const reply = (text: string, markup?: object) =>
    c.executionCtx.waitUntil(sendBotMessage(s, kind, String(chatId), text, markup).catch((e) => console.error(e)));

  const contact = msg?.contact;
  if (contact?.phone_number && kind === "bale") {
    // Only accept the sender's own number (shared via the button), never a forwarded contact.
    if (contact.user_id === undefined || contact.user_id !== msg?.from?.id) {
      reply("لطفاً فقط شماره خودتان را با دکمه «اشتراک شماره من» بفرستید.", SHARE_KEYBOARD);
      return c.json({ ok: true });
    }
    const phone = normalizePhone(contact.phone_number);
    if (!/^09\d{9}$/.test(phone)) {
      reply("این شماره پشتیبانی نمی‌شود.", REMOVE_KEYBOARD);
      return c.json({ ok: true });
    }
    const name = [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(" ");
    await saveLink(c.env.DB, {
      phone,
      chat_id: String(chatId),
      bale_user_id: String(contact.user_id),
      name,
      username: msg?.from?.username ?? "",
      linked_at: new Date().toISOString(),
    });
    reply(`✅ شماره ${phone} ثبت شد. از این به بعد پیام‌های ${s.site_name} را همین‌جا دریافت می‌کنید.`, REMOVE_KEYBOARD);
    return c.json({ ok: true });
  }

  reply(startReply(chatId, s.site_name), kind === "bale" ? SHARE_KEYBOARD : undefined);
  return c.json({ ok: true });
});
