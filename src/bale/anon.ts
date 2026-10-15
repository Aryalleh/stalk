// Anonymous messages through the site's bots (like the "anonymous message" bots):
//  1. each user has a link, ?start=a_<code> (a random code tied to the account, never the raw id);
//  2. opening it puts the opener's chat in a "writing to X" state;
//  3. their next message is copied (copyMessage, not forwarded, so no name shows) to X with
//     "answer / block / report" buttons;
//  4. every delivered message is remembered with where it landed, so an answer (the button, or a
//     plain reply to it) goes back the same way, still anonymous;
//  5. blocks between a pair of chats, a per-hour limit, and reports to the site's admins.
// It's anonymous between people only: the bot (and the admins, on a report) know the sender.
import type { Settings } from "../settings";
import { publicNameSql } from "../session";
import { randomSlug } from "../shop/db";
import { copyBotMessage, notifyAdmins, sendBotMessage, type BotKind } from "./botapi";

export const ANON_CODE = /^[a-z0-9]{10}$/;
/** The bots' /start payload for someone's anonymous link. */
export const anonStart = (code: string) => `a_${code}`;
const STATE_MS = 30 * 60_000;
export const ANON_HOURLY_LIMIT = 20;

/** The user's link code (made on first use; a new one stops the old links). */
export async function anonCode(db: D1Database, userId: number, renew = false) {
  if (!renew) {
    const row = await db.prepare("SELECT anon_code FROM users WHERE id = ?").bind(userId).first<{ anon_code: string | null }>();
    if (row?.anon_code) return row.anon_code;
  }
  for (;;) {
    const code = randomSlug(10);
    const r = await db.prepare("UPDATE users SET anon_code = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE anon_code = ?)").bind(code, userId, code).run();
    if (r.meta.changes) return code;
  }
}

export interface AnonCtx {
  db: D1Database;
  s: Settings;
  kind: BotKind;
  chatId: string;
}

export interface AnonMsg {
  message_id?: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number };
}

interface Row {
  id: number;
  from_kind: BotKind;
  from_chat: string;
  to_kind: BotKind;
  to_chat: string;
  to_user_id: number | null;
  body: string;
}

const CANCEL = { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "anon:x" }]] };
const received = (id: number) => ({
  inline_keyboard: [
    [
      { text: "↩️ پاسخ", callback_data: `anon:r:${id}` },
      { text: "🚫 بلاک", callback_data: `anon:b:${id}` },
      { text: "⚠️ گزارش", callback_data: `anon:p:${id}` },
    ],
  ],
});
const another = (id: number) => ({ inline_keyboard: [[{ text: "✍️ پیام دیگر", callback_data: `anon:m:${id}` }]] });

const say = (ctx: AnonCtx, text: string, markup?: object) => sendBotMessage(ctx.s, ctx.kind, ctx.chatId, text, markup).catch((e) => console.error("anon", e));

async function setState(ctx: AnonCtx, to: { kind: BotKind; chat: string; userId?: number | null; replyTo?: number | null }) {
  await ctx.db
    .prepare(
      `INSERT INTO anon_state (kind, chat_id, to_kind, to_chat, to_user_id, reply_to, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, chat_id) DO UPDATE SET to_kind = excluded.to_kind, to_chat = excluded.to_chat, to_user_id = excluded.to_user_id,
         reply_to = excluded.reply_to, expires_at = excluded.expires_at`,
    )
    .bind(ctx.kind, ctx.chatId, to.kind, to.chat, to.userId ?? null, to.replyTo ?? null, Date.now() + STATE_MS)
    .run();
}

const clearState = (ctx: AnonCtx) => ctx.db.prepare("DELETE FROM anon_state WHERE kind = ? AND chat_id = ?").bind(ctx.kind, ctx.chatId).run();

const blocked = (db: D1Database, blocker: { kind: string; chat: string }, other: { kind: string; chat: string }) =>
  db
    .prepare("SELECT 1 AS x FROM anon_blocks WHERE blocker_kind = ? AND blocker_chat = ? AND blocked_kind = ? AND blocked_chat = ?")
    .bind(blocker.kind, blocker.chat, other.kind, other.chat)
    .first()
    .then((r) => !!r);

/** Someone opened a user's link: they write to that user next. */
export async function startAnon(ctx: AnonCtx, code: string) {
  const user = ANON_CODE.test(code)
    ? await ctx.db
        .prepare(`SELECT id, ${publicNameSql("users")} AS name, bale_chat_id, telegram_chat_id, anon_enabled FROM users WHERE anon_code = ?`)
        .bind(code)
        .first<{ id: number; name: string; bale_chat_id: string; telegram_chat_id: string; anon_enabled: number }>()
    : null;
  if (!user || !user.anon_enabled) return say(ctx, "این لینک پیام ناشناس فعال نیست یا عوض شده است.");
  // Their chat on this messenger if they have one (a message can be copied as is), else the other.
  const same = ctx.kind === "bale" ? user.bale_chat_id : user.telegram_chat_id;
  const to = same
    ? { kind: ctx.kind, chat: same }
    : user.bale_chat_id
      ? { kind: "bale" as BotKind, chat: user.bale_chat_id }
      : user.telegram_chat_id
        ? { kind: "telegram" as BotKind, chat: user.telegram_chat_id }
        : null;
  if (!to) return say(ctx, "این کاربر هنوز پیام دریافت نمی‌کند.");
  if (to.kind === ctx.kind && to.chat === ctx.chatId) return say(ctx, "این لینک پیام ناشناس خودتان است؛ آن را برای دوستانتان بفرستید تا ناشناس برایتان بنویسند 🙂");
  if (await blocked(ctx.db, to, { kind: ctx.kind, chat: ctx.chatId })) return say(ctx, "امکان ارسال پیام به این کاربر را ندارید.");
  await setState(ctx, { ...to, userId: user.id });
  return say(
    ctx,
    `✍️ پیامت را برای ${user.name} بنویس و بفرست؛ بدون نام تو به دستش می‌رسد.` + (to.kind === ctx.kind ? " (متن، عکس، ویس، استیکر…)" : " (فقط متن)"),
    CANCEL,
  );
}

/** A message in a chat: the one being written (state), or a plain reply to a received anonymous message. */
export async function handleAnonMessage(ctx: AnonCtx, msg: AnonMsg): Promise<boolean> {
  if (msg.text?.startsWith("/")) {
    await clearState(ctx);
    return false;
  }
  const state = await ctx.db
    .prepare("SELECT to_kind, to_chat, to_user_id, reply_to FROM anon_state WHERE kind = ? AND chat_id = ? AND expires_at > ?")
    .bind(ctx.kind, ctx.chatId, Date.now())
    .first<{ to_kind: BotKind; to_chat: string; to_user_id: number | null; reply_to: number | null }>();
  if (state) {
    await clearState(ctx);
    await deliver(ctx, msg, { kind: state.to_kind, chat: state.to_chat, userId: state.to_user_id }, state.reply_to);
    return true;
  }
  const replied = msg.reply_to_message?.message_id;
  if (replied) {
    const row = await ctx.db
      .prepare("SELECT * FROM anon_messages WHERE to_kind = ? AND to_chat = ? AND to_msg_id = ?")
      .bind(ctx.kind, ctx.chatId, String(replied))
      .first<Row>();
    if (row) {
      await deliver(ctx, msg, { kind: row.from_kind, chat: row.from_chat, userId: null }, row.id);
      return true;
    }
  }
  return false;
}

async function deliver(ctx: AnonCtx, msg: AnonMsg, to: { kind: BotKind; chat: string; userId: number | null }, replyTo: number | null) {
  const me = { kind: ctx.kind, chat: ctx.chatId };
  if (!msg.message_id) return;
  if (await blocked(ctx.db, to, me)) return say(ctx, "امکان ارسال پیام به این کاربر را ندارید.");
  const recent = await ctx.db
    .prepare("SELECT COUNT(*) AS n FROM anon_messages WHERE from_kind = ? AND from_chat = ? AND created_at > ?")
    .bind(ctx.kind, ctx.chatId, Date.now() - 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= ANON_HOURLY_LIMIT) return say(ctx, "⏳ در این یک ساعت پیام زیادی فرستاده‌اید؛ کمی بعد دوباره امتحان کنید.");
  const body = (msg.text ?? msg.caption ?? "").slice(0, 1000);
  const row = (await ctx.db
    .prepare("INSERT INTO anon_messages (from_kind, from_chat, to_kind, to_chat, to_user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(ctx.kind, ctx.chatId, to.kind, to.chat, to.userId, body, Date.now())
    .first<{ id: number }>())!;
  try {
    await sendBotMessage(ctx.s, to.kind, to.chat, replyTo ? "↩️ پاسخ ناشناس به پیامت:" : "📩 یک پیام ناشناس داری:");
    let sent: { message_id: number };
    if (to.kind === ctx.kind) {
      // As the bot's own message: the sender's name doesn't show (a forward would show it).
      sent = await copyBotMessage(ctx.s, to.kind, to.chat, ctx.chatId, msg.message_id, received(row.id)).catch(async (e) => {
        if (!msg.text) throw e;
        return sendBotMessage(ctx.s, to.kind, to.chat, msg.text, received(row.id));
      });
    } else {
      // Across messengers only text can travel.
      if (!msg.text) throw new Error("not text");
      sent = await sendBotMessage(ctx.s, to.kind, to.chat, msg.text, received(row.id));
    }
    await ctx.db.prepare("UPDATE anon_messages SET to_msg_id = ? WHERE id = ?").bind(String(sent.message_id), row.id).run();
  } catch (e) {
    console.error("anon deliver", e);
    await ctx.db.prepare("DELETE FROM anon_messages WHERE id = ?").bind(row.id).run();
    return say(ctx, to.kind === ctx.kind ? "❌ پیام ارسال نشد؛ دوباره امتحان کنید." : "❌ به این کاربر فقط پیام متنی می‌رسد؛ متن بفرستید.", another(row.id));
  }
  return say(ctx, replyTo ? "✅ پاسخت ناشناس فرستاده شد." : "✅ پیامت ناشناس فرستاده شد.", replyTo ? undefined : another(row.id));
}

/** The buttons: anon:x cancel · r answer · m another message · b block · u unblock · p report. */
export async function handleAnonCallback(ctx: AnonCtx, data: string, answer: (text: string) => Promise<unknown>) {
  const [, action, idText] = data.split(":");
  if (action === "x") {
    await clearState(ctx);
    return answer("لغو شد");
  }
  const id = Number(idText);
  // Buttons on a message this chat received (answer, block, report) or sent ("another").
  const row = await ctx.db
    .prepare(
      action === "m"
        ? "SELECT * FROM anon_messages WHERE id = ? AND from_kind = ? AND from_chat = ?"
        : "SELECT * FROM anon_messages WHERE id = ? AND to_kind = ? AND to_chat = ?",
    )
    .bind(id, ctx.kind, ctx.chatId)
    .first<Row>();
  if (!row) return answer("این پیام پیدا نشد.");
  const other = { kind: row.from_kind, chat: row.from_chat };
  if (action === "r") {
    await setState(ctx, { ...other, replyTo: row.id });
    await answer("پاسخت را بنویس");
    return say(ctx, "✍️ پاسخت را بنویس و بفرست؛ ناشناس به فرستنده می‌رسد.", CANCEL);
  }
  if (action === "m") {
    await setState(ctx, { kind: row.to_kind, chat: row.to_chat, userId: row.to_user_id });
    await answer("بنویس");
    return say(ctx, "✍️ پیام بعدی‌ات را بنویس و بفرست.", CANCEL);
  }
  if (action === "b") {
    await ctx.db
      .prepare("INSERT OR IGNORE INTO anon_blocks (blocker_kind, blocker_chat, blocked_kind, blocked_chat, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ctx.kind, ctx.chatId, other.kind, other.chat, Date.now())
      .run();
    await answer("بلاک شد");
    return say(ctx, "🚫 فرستنده‌ی این پیام بلاک شد؛ دیگر پیامی از او نمی‌گیری.", { inline_keyboard: [[{ text: "رفع بلاک", callback_data: `anon:u:${row.id}` }]] });
  }
  if (action === "u") {
    await ctx.db
      .prepare("DELETE FROM anon_blocks WHERE blocker_kind = ? AND blocker_chat = ? AND blocked_kind = ? AND blocked_chat = ?")
      .bind(ctx.kind, ctx.chatId, other.kind, other.chat)
      .run();
    return answer("رفع بلاک شد");
  }
  if (action === "p") {
    await notifyAdmins(
      ctx.db,
      ctx.s,
      [
        `⚠️ گزارش پیام ناشناس #${row.id}`,
        `فرستنده: ${row.from_kind} ${row.from_chat}`,
        `گیرنده: ${ctx.kind} ${ctx.chatId}${row.to_user_id ? ` (کاربر ${row.to_user_id})` : ""}`,
        `متن: ${row.body || "(پیام غیرمتنی)"}`,
      ].join("\n"),
    );
    return answer("گزارش شد؛ مدیران سایت بررسی می‌کنند. می‌توانی بلاکش هم بکنی.");
  }
  return answer("؟");
}
