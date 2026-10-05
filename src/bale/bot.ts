import { Hono } from "hono";
import { safeEqual } from "../../lib/auth";
import { normalizePhone } from "../../lib/normalize";
import type { C, Env } from "../env";
import { confirmOrder, rejectOrder, shopOwnerChats } from "../shop/orders";
import { siteUrl } from "../shop/routes/helpers";
import { answerCallback, botToken, clearButtons, openAppMarkup, sendBotMessage, type BotKind } from "./botapi";
import { useConnectToken } from "./connect";
import { saveLink } from "./links";
import { handleChannelPost, type ChannelPost } from "../shop/telegram/channel";

// Webhook for the site's Bale/Telegram bots (registered from /admin/settings → "connect").
//  - "/start <token>": connect the chat to the site account that opened the bot from /connect.
//  - A shared contact (Bale): link that phone to the chat, so the CRM can message it for free.
//  - Receipt buttons (pay:ok:<id> / pay:no:<id>): the shop confirms or rejects a transfer.
//  - Channel posts (Telegram): a connected shop channel's tagged posts become products.

export const bot = new Hono<Env>();

interface Update {
  channel_post?: ChannelPost;
  edited_channel_post?: ChannelPost;
  message?: {
    chat?: { id?: number };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    contact?: { phone_number?: string; user_id?: number };
  };
  callback_query?: {
    id: string;
    from?: { id?: number };
    data?: string;
    message?: { message_id?: number; chat?: { id?: number } };
  };
}

const SHARE_KEYBOARD = {
  keyboard: [[{ text: "📱 اشتراک شماره من", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const REMOVE_KEYBOARD = { remove_keyboard: true };

bot.post("/bot/:kind{bale|telegram}/:secret", async (c) => {
  const kind = c.req.param("kind") as BotKind;
  const s = c.get("settings");
  if (!s.bot_webhook_secret || !safeEqual(c.req.param("secret"), s.bot_webhook_secret) || !botToken(s, kind)) {
    return c.text("forbidden", 403);
  }
  const update = (await c.req.json().catch(() => null)) as Update | null;
  const post = update?.channel_post ?? update?.edited_channel_post;
  if (post && kind === "telegram") {
    // A shop's channel: tagged posts become products (src/shop/telegram/channel.ts).
    const deps = { db: c.env.DB, images: c.env.IMAGES, settings: s, siteUrl: siteUrl(c) };
    c.executionCtx.waitUntil(handleChannelPost(deps, post, !update?.channel_post).catch((e) => console.error("channel post", e)));
    return c.json({ ok: true });
  }
  if (update?.callback_query) {
    await handleCallback(c, kind, update.callback_query);
    return c.json({ ok: true });
  }
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (chatId === undefined) return c.json({ ok: true });
  const reply = (text: string, markup?: object) =>
    c.executionCtx.waitUntil(sendBotMessage(s, kind, String(chatId), text, markup).catch((e) => console.error(e)));
  const shareMarkup = kind === "bale" ? SHARE_KEYBOARD : undefined;

  const contact = msg?.contact;
  if (contact?.phone_number) {
    // Only accept the sender's own number (shared via the button), never a forwarded contact.
    if (contact.user_id === undefined || contact.user_id !== msg?.from?.id) {
      reply("لطفاً فقط شماره خودتان را با دکمه «اشتراک شماره من» بفرستید.", shareMarkup);
      return c.json({ ok: true });
    }
    const phone = normalizePhone(contact.phone_number);
    if (kind === "bale" && /^09\d{9}$/.test(phone)) {
      await saveLink(c.env.DB, {
        phone,
        chat_id: String(chatId),
        bale_user_id: String(contact.user_id),
        name: [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(" "),
        username: msg?.from?.username ?? "",
        linked_at: new Date().toISOString(),
      });
    }
    reply(`✅ شماره ${phone} ثبت شد.`, REMOVE_KEYBOARD);
    return c.json({ ok: true });
  }

  const start = msg?.text?.match(/^\/start(?:@\w+)?\s+([\w-]{8,64})$/);
  if (start) {
    const user = await useConnectToken(c.env.DB, start[1], kind, String(chatId));
    if (user) {
      reply(
        `✅ حساب «${user.name}» در ${s.site_name} به این بات وصل شد. سفارش‌ها و اطلاع‌رسانی‌ها از این به بعد همین‌جا می‌آیند.` +
          (kind === "bale" ? "\n\nبرای دریافت پیام‌ها روی شماره‌تان، شماره را هم با دکمه زیر بفرستید." : ""),
        shareMarkup,
      );
      return c.json({ ok: true });
    }
    reply("این لینک اتصال منقضی شده؛ از صفحه سایت دوباره «اتصال» را بزنید.");
    return c.json({ ok: true });
  }

  const app = openAppMarkup(`${siteUrl(c)}/app`, `🎁 باز کردن ${s.site_name}`);
  reply(
    `سلام! به بات ${s.site_name} خوش آمدید.\n` +
      (app ? "با دکمه زیر سایت را همین‌جا باز کنید؛ ورود و اتصال حساب خودکار انجام می‌شود." : "برای اتصال حساب سایت، از صفحه «اتصال به بات» در سایت وارد شوید."),
    app ?? shareMarkup,
  );
  return c.json({ ok: true });
});

async function handleCallback(c: C, kind: BotKind, q: NonNullable<Update["callback_query"]>) {
  const s = c.get("settings");
  const m = q.data?.match(/^pay:(ok|no):(\d+)$/);
  const chatId = String(q.message?.chat?.id ?? "");
  const answer = (text: string) => answerCallback(s, kind, q.id, text).catch((e) => console.error(e));
  if (!m || !chatId) return answer("دستور نامعتبر");
  const orderId = Number(m[2]);
  const order = await c.env.DB.prepare("SELECT id, shop_id, status FROM orders WHERE id = ?").bind(orderId).first<{ id: number; shop_id: number; status: string }>();
  const owner = order ? await shopOwnerChats(c.env.DB, order.shop_id) : null;
  // Only the shop owner's own connected chat may decide.
  const ownerChat = owner ? (kind === "bale" ? owner.bale_chat_id : owner.telegram_chat_id) : "";
  if (!order || !ownerChat || ownerChat !== chatId) return answer("اجازه این کار را ندارید.");
  if (order.status !== "awaiting") {
    await answer("این سفارش قبلاً بررسی شده است.");
    if (q.message?.message_id) await clearButtons(s, kind, chatId, q.message.message_id);
    return;
  }
  const deps = { db: c.env.DB, images: c.env.IMAGES, settings: s, siteUrl: siteUrl(c) };
  if (m[1] === "ok") {
    await confirmOrder(deps, orderId, order.shop_id);
    await answer("✅ واریز تأیید شد");
  } else {
    await rejectOrder(deps, orderId, order.shop_id, "رد شده توسط فروشگاه");
    await answer("❌ واریز رد شد");
    await sendBotMessage(s, kind, chatId, `❌ واریز سفارش #${orderId} رد شد و آرزو دوباره قابل خرید است.`).catch(() => undefined);
  }
  if (q.message?.message_id) await clearButtons(s, kind, chatId, q.message.message_id);
}
