import { Hono } from "hono";
import { safeEqual } from "../../lib/auth";
import { normalizePhone } from "../../lib/normalize";
import type { C, Env } from "../env";
import { confirmOrder, rejectOrder, shopOwnerChats } from "../shop/orders";
import { siteUrl } from "../shop/routes/helpers";
import { answerCallback, botLink, botToken, clearButtons, notifyAdmins, openAppMarkup, sendBotMessage, sendBotPhoto, type BotKind } from "./botapi";
import { useConnectToken } from "./connect";
import { accountFromContact } from "./chatlink";
import { handleAnonCallback, handleAnonMessage, sendAnonLinks, startAnon, type AnonCtx } from "./anon";
import { logIncoming } from "../crm/db";
import { assignUsername } from "../session";
import { upsertCustomer } from "../crm/sync";
import { saveLink } from "./links";
import { handleChannelPost, type ChannelPost } from "../shop/telegram/channel";
import { cardProduct, inlineKeyboard as chatButtons, rememberCard, runShopChat, type ChatReply } from "../shop/commands";
import type { Shop } from "../shop/db";
import { befriend, inviterByCode, tellInviter } from "../shop/friends";
import { attributeReferral } from "../shop/points";

// Webhook for the site's Bale/Telegram bots (registered from /admin/settings → "connect").
//  - "/start <token>": connect the chat to the site account that opened the bot from /connect.
//  - A shared contact (Bale): link that phone to the chat, so the CRM can message it for free.
//  - Receipt buttons (pay:ok:<id> / pay:no:<id>): the shop confirms or rejects a transfer.
//  - Channel posts (Telegram and Bale): a connected shop channel's tagged posts become products.
//  - Any other text from a shop's admin: a shop command (orders, prices, tracking…), see commands.ts.

export const bot = new Hono<Env>();

interface Update {
  channel_post?: ChannelPost;
  edited_channel_post?: ChannelPost;
  edited_message?: ChannelPost;
  message?: {
    message_id?: number;
    caption?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    contact?: { phone_number?: string; user_id?: number };
    reply_to_message?: { message_id?: number };
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
  // A shop's channel: tagged posts become products (src/shop/telegram/channel.ts). Telegram sends
  // channel_post; Bale may also send a channel's posts as message / edited_message from a "channel" chat.
  const asChannel = (m: unknown) => (m && (m as ChannelPost).chat?.type === "channel" ? (m as ChannelPost) : undefined);
  const fresh = update?.channel_post ?? asChannel(update?.message);
  const post = fresh ?? update?.edited_channel_post ?? asChannel(update?.edited_message);
  if (post) {
    const deps = { db: c.env.DB, images: c.env.IMAGES, settings: s, siteUrl: siteUrl(c) };
    c.executionCtx.waitUntil(handleChannelPost(deps, post, !fresh, kind).catch((e) => console.error(`${kind} channel post`, e)));
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
    if (!/^09\d{9}$/.test(phone)) {
      reply("فعلاً فقط شماره موبایل ایران (۰۹…) پذیرفته می‌شود.", REMOVE_KEYBOARD);
      return c.json({ ok: true });
    }
    // The messenger vouches for the number: sign the chat up (or tie it to the account with it), so the
    // mini app signs in without an SMS code.
    const acct = await accountFromContact(c.env.DB, kind, String(chatId), phone, { first: msg?.from?.first_name ?? "", last: msg?.from?.last_name ?? "" });
    if (acct.created) {
      await assignUsername(c.env.DB, acct.id);
      const name = [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(" ");
      c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: name || phone, phone, source: `ثبت‌نام با ${kind === "bale" ? "بله" : "تلگرام"}` }).catch(() => undefined));
    }
    reply(`✅ شماره ${phone} ثبت شد. به ${s.site_name} برگردید؛ ورودتان انجام شده است.`, REMOVE_KEYBOARD);
    const app = openAppMarkup(`${siteUrl(c)}/app`, `🎁 باز کردن ${s.site_name}`);
    if (app) reply("👇", app);
    return c.json({ ok: true });
  }

  // From the mini app's "share my number" fallback: ask for it with the contact button.
  if (/^\/start(?:@\w+)?\s+phone$/.test(msg?.text?.trim() ?? "")) {
    reply(`برای ورود به ${s.site_name}، دکمه «📱 اشتراک شماره من» پایین صفحه را بزنید.`, SHARE_KEYBOARD);
    return c.json({ ok: true });
  }

  const anon: AnonCtx = { db: c.env.DB, s, kind, chatId: String(chatId) };
  // Someone's anonymous-message link: "?start=a_<code>" (anon.ts).
  const anonLink = msg?.text?.match(/^\/start(?:@\w+)?\s+a_([a-z0-9]{10})$/);
  if (anonLink) {
    c.executionCtx.waitUntil(startAnon(anon, anonLink[1]));
    return c.json({ ok: true });
  }

  // A friend invite: "?start=f_<code>" (friends.ts).
  const invite = msg?.text?.match(/^\/start(?:@\w+)?\s+f_([a-z0-9]{10})$/);
  if (invite) {
    const inviter = await inviterByCode(c.env.DB, invite[1]);
    if (!inviter) {
      reply("این لینک دعوت معتبر نیست یا عوض شده است؛ از دوستتان لینک تازه بخواهید.");
      return c.json({ ok: true });
    }
    const col = kind === "bale" ? "bale_chat_id" : "telegram_chat_id";
    const me = await c.env.DB.prepare(`SELECT id, name, nickname FROM users WHERE ${col} = ? LIMIT 1`).bind(String(chatId)).first<{ id: number; name: string; nickname: string }>();
    if (me) {
      const r = await befriend(c.env.DB, me.id, inviter.id);
      if (r === "ok") await attributeReferral(c.env.DB, me.id, inviter.id);
      if (r === "ok") c.executionCtx.waitUntil(tellInviter(c.env.DB, s, siteUrl(c), inviter.id, { name: me.nickname || me.name }));
      const app = openAppMarkup(`${siteUrl(c)}/app?next=${encodeURIComponent("/me/friends")}`, "👫 دوستان من");
      reply(
        r === "self"
          ? "این لینک دعوت خودتان است؛ آن را برای دوستانتان بفرستید 🙂"
          : `${r === "ok" ? "🎉 حالا" : "✅"} شما و ${inviter.name} ${r === "ok" ? "دوست هستید" : "از قبل دوست بودید"}. تولد و لیست آرزوهای دوستانتان: ${siteUrl(c)}/me/friends`,
        app,
      );
      return c.json({ ok: true });
    }
    // Not connected to an account yet: open the site (signs in / up), then accept there.
    const app = openAppMarkup(`${siteUrl(c)}/app?next=${encodeURIComponent(`/f/${invite[1]}`)}`, "🎁 قبول دعوت");
    reply(`👋 ${inviter.name} شما را به دوستی در ${s.site_name} دعوت کرده؛ تولد و لیست آرزوهای هم را می‌بینید.\n${app ? "دکمه زیر را بزنید:" : `${siteUrl(c)}/f/${invite[1]}`}`, app);
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

  // An anonymous message being written, or a reply to a received one.
  if (msg && (await handleAnonMessage(anon, msg))) return c.json({ ok: true });

  // "/anon" or "پیام ناشناس": the user's own anonymous-message links (anon.ts).
  if (/^(\/anon(@\w+)?|\/link(@\w+)?|پیام ناشناس|لینک ناشناس|لینک پیام ناشناس)$/.test(msg?.text?.trim() ?? "")) {
    c.executionCtx.waitUntil(sendAnonLinks(anon, siteUrl(c), (k, payload) => botLink(s, k, payload)).catch((e) => console.error(e)));
    return c.json({ ok: true });
  }

  // A shop's admin can run the shop from here with buttons and text commands (src/shop/commands.ts).
  const text = msg?.text?.trim();
  if (text && !/^\/start(@\w+)?$/.test(text)) {
    const shop = await shopForChat(c, kind, String(chatId));
    if (shop) {
      const replyTo = await cardProduct(c.env.DB, kind, String(chatId), msg?.reply_to_message?.message_id ? String(msg.reply_to_message.message_id) : undefined);
      const r = await runShopChat(shopDeps(c), shop, { text, replyTo });
      c.executionCtx.waitUntil(sendChatReply(c, kind, String(chatId), r).catch((e) => console.error(e)));
      return c.json({ ok: true });
    }
  }

  // A CRM customer (their number shared with the Bale bot) writing to us: kept in their chat history.
  if (kind === "bale" && text && !text.startsWith("/")) {
    const link = await c.env.DB.prepare("SELECT phone FROM bale_links WHERE chat_id = ?").bind(String(chatId)).first<{ phone: string }>();
    const contacts = link ? await logIncoming(c.env.DB, link.phone, text) : [];
    if (contacts.length) {
      reply("✅ پیامتان رسید؛ به‌زودی پاسخ می‌دهیم.");
      const who = `${contacts[0].first_name} ${contacts[0].last_name}`.trim() || link!.phone;
      c.executionCtx.waitUntil(
        notifyAdmins(c.env.DB, s, `💬 پیام تازه از ${who} در بات بله:\n${text.slice(0, 500)}\n\n${siteUrl(c)}/crm/contacts/${contacts[0].id}#messages`).catch(() => undefined),
      );
      return c.json({ ok: true });
    }
  }

  const app = openAppMarkup(`${siteUrl(c)}/app`, `🎁 باز کردن ${s.site_name}`);
  reply(
    `سلام! به بات ${s.site_name} خوش آمدید.\n🤫 لینک پیام ناشناس خودتان: /anon\n` +
      (app ? "با دکمه زیر سایت را همین‌جا باز کنید؛ ورود و اتصال حساب خودکار انجام می‌شود." : "برای اتصال حساب سایت، از صفحه «اتصال به بات» در سایت وارد شوید."),
    app ?? shareMarkup,
  );
  return c.json({ ok: true });
});

const shopDeps = (c: C) => ({ db: c.env.DB, images: c.env.IMAGES, settings: c.get("settings"), siteUrl: siteUrl(c) });

/** The shop whose admin this chat belongs to (they run it from here). */
function shopForChat(c: C, kind: BotKind, chatId: string) {
  const col = kind === "bale" ? "bale_chat_id" : "telegram_chat_id";
  return c.env.DB.prepare(
    `SELECT s.* FROM users u JOIN shops s ON s.id = u.shop_id
     WHERE u.${col} = ? AND (u.shop_role = 'admin' OR s.owner_id = u.id) AND s.is_external = 0 LIMIT 1`,
  )
    .bind(chatId)
    .first<Shop>();
}

/** A shop chat reply: the text, then each product card (photo + caption; a reply to it sets the price). */
async function sendChatReply(c: C, kind: BotKind, chatId: string, r: ChatReply) {
  const s = c.get("settings");
  const cards = r.cards ?? [];
  await sendBotMessage(s, kind, chatId, r.text.slice(0, 4000), cards.length ? undefined : chatButtons(r.buttons));
  for (const [i, card] of cards.entries()) {
    const markup = i === cards.length - 1 ? chatButtons(r.buttons) : undefined;
    const obj = card.image_key ? await c.env.IMAGES.get(card.image_key) : null;
    const sent = obj
      ? await sendBotPhoto(s, kind, chatId, { data: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType ?? "image/jpeg", name: card.image_key.split("/").pop()! }, card.caption, markup)
      : await sendBotMessage(s, kind, chatId, card.caption, markup);
    if (sent?.message_id) await rememberCard(c.env.DB, kind, chatId, String(sent.message_id), card.id);
  }
}

async function handleCallback(c: C, kind: BotKind, q: NonNullable<Update["callback_query"]>) {
  const s = c.get("settings");
  const chatId = String(q.message?.chat?.id ?? "");
  const answer = (text: string) => answerCallback(s, kind, q.id, text).catch((e) => console.error(e));
  if (q.data?.startsWith("anon:") && chatId) {
    await handleAnonCallback({ db: c.env.DB, s, kind, chatId }, q.data, answer);
    return;
  }
  // A shop chat button.
  const btn = q.data?.match(/^c:(.{1,62})$/);
  if (btn && chatId) {
    const shop = await shopForChat(c, kind, chatId);
    if (!shop) return answer("اجازه این کار را ندارید.");
    const r = await runShopChat(shopDeps(c), shop, { payload: btn[1] });
    await answer("✓");
    await sendChatReply(c, kind, chatId, r).catch((e) => console.error(e));
    return;
  }
  const m = q.data?.match(/^pay:(ok|no):(\d+)$/);
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
