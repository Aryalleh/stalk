// Anonymous messages (like the "anonymous message" bots), across Bale, Telegram and the site:
//  1. each user has a link, ?start=a_<code> (a random code tied to the account, never the raw id),
//     and a "send an anonymous message" box on their profile (/u/<username>, signed-in senders);
//  2. opening the link puts the opener's chat in a "writing to X" state; their next message goes to
//     X without their name — copied (copyMessage, not forwarded) in the same messenger, as text in
//     the other one — to every chat X connected, and to X's inbox on the site (/me/anon);
//  3. every delivered copy is remembered (anon_landings), so an answer from any chat (the button, or
//     a plain reply to it) or from the site goes back to every chat of the sender, still anonymous;
//     in the chat the sender wrote from, it lands as a reply to their message;
//  4. blocks (by account when there is one), a per-hour limit, and reports to the site's admins.
// It's anonymous between people only: the site's admins see who wrote what (/admin/anon).
import type { Settings } from "../settings";
import { publicNameSql } from "../session";
import { randomSlug } from "../shop/db";
import { chatTargets, copyBotMessage, notifyAdmins, sendBotMessage, type BotKind, type Chats } from "./botapi";

export const ANON_CODE = /^[a-z0-9]{10}$/;
/** The bots' /start payload for someone's anonymous link. */
export const anonStart = (code: string) => `a_${code}`;
const STATE_MS = 30 * 60_000;
export const ANON_HOURLY_LIMIT = 20;
export const ANON_MAX = 1000;

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

export type Side = BotKind | "web";

/** One end of a conversation: an account (all its chats and its inbox), or just a chat (no account). */
export interface Party {
  userId: number | null;
  kind: Side; // where it wrote from ("web": the site, chat = the user id)
  chat: string;
}

export interface AnonRow {
  id: number;
  from_kind: Side;
  from_chat: string;
  to_kind: Side;
  to_chat: string;
  to_user_id: number | null; // the link's owner, for a first message
  from_user_id: number | null;
  recipient_id: number | null;
  reply_to: number | null;
  root_id: number;
  body: string;
  from_msg_id: string; // the sender's own message (an answer lands as a reply to it)
  created_at: number;
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
const KIND_FA: Record<BotKind, string> = { bale: "بله", telegram: "تلگرام" };

const say = (ctx: AnonCtx, text: string, markup?: object) => sendBotMessage(ctx.s, ctx.kind, ctx.chatId, text, markup).catch((e) => console.error("anon", e));

/** The account connected to a chat, if any. */
export async function chatUser(db: D1Database, kind: BotKind, chat: string) {
  const col = kind === "bale" ? "bale_chat_id" : "telegram_chat_id";
  const row = await db.prepare(`SELECT id FROM users WHERE ${col} = ? LIMIT 1`).bind(chat).first<{ id: number }>();
  return row?.id ?? null;
}

const chatParty = async (ctx: AnonCtx): Promise<Party> => ({ userId: await chatUser(ctx.db, ctx.kind, ctx.chatId), kind: ctx.kind, chat: ctx.chatId });
export const userParty = (userId: number): Party => ({ userId, kind: "web", chat: String(userId) });
export const senderOf = (r: AnonRow): Party => ({ userId: r.from_user_id, kind: r.from_kind, chat: r.from_chat });
const recipientOf = (r: AnonRow): Party => ({ userId: r.recipient_id, kind: r.to_kind, chat: r.to_chat });

/** Where a party is reached: every chat of the account, or the one chat. */
async function partyChats(db: D1Database, s: Settings, p: Party): Promise<[BotKind, string][]> {
  if (p.userId) {
    const row = await db.prepare("SELECT bale_chat_id, telegram_chat_id FROM users WHERE id = ?").bind(p.userId).first<Chats>();
    return row ? chatTargets(s, row) : [];
  }
  return p.kind === "web" ? [] : chatTargets(s, { bale_chat_id: p.kind === "bale" ? p.chat : "", telegram_chat_id: p.kind === "telegram" ? p.chat : "" });
}

/** Identities a block can be stored under: the account and its chats, or the chat. */
async function blockKeys(db: D1Database, p: Party): Promise<[string, string][]> {
  if (!p.userId) return [[p.kind, p.chat]];
  const row = await db.prepare("SELECT bale_chat_id, telegram_chat_id FROM users WHERE id = ?").bind(p.userId).first<Chats>();
  const keys: [string, string][] = [["user", String(p.userId)]];
  if (row?.bale_chat_id) keys.push(["bale", row.bale_chat_id]);
  if (row?.telegram_chat_id) keys.push(["telegram", row.telegram_chat_id]);
  return keys;
}
const mainKey = (p: Party): [string, string] => (p.userId ? ["user", String(p.userId)] : [p.kind, p.chat]);

export async function isBlocked(db: D1Database, blocker: Party, other: Party) {
  const [a, b] = await Promise.all([blockKeys(db, blocker), blockKeys(db, other)]);
  const values = (k: [string, string][]) => k.map(() => "(?, ?)").join(", ");
  const row = await db
    .prepare(`SELECT 1 AS x FROM anon_blocks WHERE (blocker_kind, blocker_chat) IN (VALUES ${values(a)}) AND (blocked_kind, blocked_chat) IN (VALUES ${values(b)}) LIMIT 1`)
    .bind(...a.flat(), ...b.flat())
    .first();
  return !!row;
}

export async function setBlock(db: D1Database, blocker: Party, other: Party, on: boolean) {
  if (on) {
    await db
      .prepare("INSERT OR IGNORE INTO anon_blocks (blocker_kind, blocker_chat, blocked_kind, blocked_chat, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(...mainKey(blocker), ...mainKey(other), Date.now())
      .run();
    return;
  }
  const [a, b] = await Promise.all([blockKeys(db, blocker), blockKeys(db, other)]);
  const values = (k: [string, string][]) => k.map(() => "(?, ?)").join(", ");
  await db
    .prepare(`DELETE FROM anon_blocks WHERE (blocker_kind, blocker_chat) IN (VALUES ${values(a)}) AND (blocked_kind, blocked_chat) IN (VALUES ${values(b)})`)
    .bind(...a.flat(), ...b.flat())
    .run();
}

async function setState(ctx: AnonCtx, to: { kind: Side; chat: string; userId?: number | null; replyTo?: number | null }) {
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

/** Someone the link / profile belongs to, if they take anonymous messages. */
export async function anonTarget(db: D1Database, by: { code?: string; id?: number }) {
  const where = by.code ? "anon_code = ?" : "id = ?";
  const key = by.code ?? by.id;
  if (by.code && !ANON_CODE.test(by.code)) return null;
  return db
    .prepare(`SELECT id, ${publicNameSql("users")} AS name, anon_enabled FROM users WHERE ${where}`)
    .bind(key)
    .first<{ id: number; name: string; anon_enabled: number }>();
}

/** Someone opened a user's link: they write to that user next. */
export async function startAnon(ctx: AnonCtx, code: string) {
  const user = await anonTarget(ctx.db, { code });
  if (!user || !user.anon_enabled) return say(ctx, "این لینک پیام ناشناس فعال نیست یا عوض شده است.");
  const me = await chatParty(ctx);
  if (me.userId === user.id) return say(ctx, "این لینک پیام ناشناس خودتان است؛ آن را برای دوستانتان بفرستید تا ناشناس برایتان بنویسند 🙂");
  const to = userParty(user.id);
  if (await isBlocked(ctx.db, to, me)) return say(ctx, "امکان ارسال پیام به این کاربر را ندارید.");
  await setState(ctx, { ...to, userId: user.id });
  return say(ctx, `✍️ پیامت را برای ${user.name} بنویس و بفرست؛ بدون نام تو به دستش می‌رسد. (متن، عکس، ویس، استیکر…)`, CANCEL);
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
    .first<{ to_kind: Side; to_chat: string; to_user_id: number | null; reply_to: number | null }>();
  let to: Party | null = null;
  let answered: AnonRow | null = null;
  if (state) {
    await clearState(ctx);
    answered = state.reply_to ? await ctx.db.prepare("SELECT * FROM anon_messages WHERE id = ?").bind(state.reply_to).first<AnonRow>() : null;
    to = answered ? senderOf(answered) : { userId: state.to_user_id, kind: state.to_kind, chat: state.to_chat };
  } else if (msg.reply_to_message?.message_id) {
    answered = await ctx.db
      .prepare("SELECT m.* FROM anon_messages m JOIN anon_landings l ON l.message_id = m.id WHERE l.kind = ? AND l.chat = ? AND l.msg_id = ?")
      .bind(ctx.kind, ctx.chatId, String(msg.reply_to_message.message_id))
      .first<AnonRow>();
    if (answered) to = senderOf(answered);
  }
  if (!to || !msg.message_id) return false;
  const r = await deliver(ctx.db, ctx.s, await chatParty(ctx), { text: msg.text ?? "", caption: msg.caption, copy: { kind: ctx.kind, chat: ctx.chatId, messageId: msg.message_id } }, to, answered);
  if (!r.ok) await say(ctx, r.error, r.id ? another(r.id) : undefined);
  else await say(ctx, answered ? "✅ پاسخت ناشناس فرستاده شد." : "✅ پیامت ناشناس فرستاده شد.", answered ? undefined : another(r.id));
  return true;
}

export type Delivered = { ok: true; id: number; root: number } | { ok: false; error: string; id?: number };

/**
 * Send a message to a party: every chat they connected (copied in the messenger it was written in,
 * as text in the other) and, for an account, their inbox on the site. `answered` threads it.
 */
export async function deliver(
  db: D1Database,
  s: Settings,
  from: Party,
  out: { text: string; caption?: string; copy?: { kind: BotKind; chat: string; messageId: number } },
  to: Party,
  answered: AnonRow | null,
  rootId?: number,
): Promise<Delivered> {
  if (await isBlocked(db, to, from)) return { ok: false, error: "امکان ارسال پیام به این کاربر را ندارید." };
  const recent = await db
    .prepare(
      from.userId
        ? "SELECT COUNT(*) AS n FROM anon_messages WHERE from_user_id = ? AND created_at > ?"
        : "SELECT COUNT(*) AS n FROM anon_messages WHERE from_kind = ? AND from_chat = ? AND created_at > ?",
    )
    .bind(...(from.userId ? [from.userId] : [from.kind, from.chat]), Date.now() - 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= ANON_HOURLY_LIMIT) return { ok: false, error: "⏳ در این یک ساعت پیام زیادی فرستاده‌اید؛ کمی بعد دوباره امتحان کنید." };
  const text = out.text.trim().slice(0, ANON_MAX);
  const chats = await partyChats(db, s, to);
  // Non-text (a photo, a voice…) can only be copied within the messenger it was sent in.
  if (!text && !(out.copy && chats.some(([k]) => k === out.copy!.kind)))
    return { ok: false, error: chats.length ? "❌ به این کاربر فقط پیام متنی می‌رسد؛ متن بفرستید." : "این کاربر هنوز پیام دریافت نمی‌کند." };
  if (!chats.length && !to.userId) return { ok: false, error: "این کاربر هنوز پیام دریافت نمی‌کند." };

  const body = text || (out.caption ?? "").slice(0, ANON_MAX);
  const row = (await db
    .prepare(
      `INSERT INTO anon_messages (from_kind, from_chat, from_user_id, to_kind, to_chat, to_user_id, recipient_id, reply_to, root_id, body, from_msg_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      from.kind,
      from.chat,
      from.userId,
      chats[0]?.[0] ?? "web",
      chats[0]?.[1] ?? String(to.userId),
      answered ? null : to.userId,
      to.userId,
      answered?.id ?? null,
      answered?.root_id ?? rootId ?? null,
      body,
      out.copy ? String(out.copy.messageId) : "",
      Date.now(),
    )
    .first<{ id: number }>())!;
  const root = answered?.root_id ?? rootId ?? row.id;
  if (root === row.id) await db.prepare("UPDATE anon_messages SET root_id = id WHERE id = ?").bind(row.id).run();

  const quote = answered?.body ? ` «${answered.body.length > 40 ? answered.body.slice(0, 40) + "…" : answered.body}»` : "";
  const results = await Promise.allSettled(
    chats.map(async ([kind, chat]) => {
      // In the chat the answered message was written in, the answer is a reply to it.
      const threadTo = answered && answered.from_kind === kind && answered.from_chat === chat ? Number(answered.from_msg_id) || undefined : undefined;
      if (!threadTo) await sendBotMessage(s, kind, chat, answered ? `↩️ پاسخ ناشناس به پیامت${quote}:` : "📩 یک پیام ناشناس داری:");
      let sent: { message_id: number };
      if (out.copy && out.copy.kind === kind) {
        // As the bot's own message: the sender's name doesn't show (a forward would show it).
        sent = await copyBotMessage(s, kind, chat, out.copy.chat, out.copy.messageId, received(row.id), threadTo).catch(async (e) => {
          if (!text) throw e;
          return sendBotMessage(s, kind, chat, text, received(row.id), threadTo);
        });
      } else if (text) {
        sent = await sendBotMessage(s, kind, chat, text, received(row.id), threadTo);
      } else {
        sent = await sendBotMessage(s, kind, chat, `(یک پیام غیرمتنی؛ در ${KIND_FA[out.copy!.kind]} ببینید${body ? `: ${body}` : ""})`, received(row.id), threadTo);
      }
      await db.prepare("INSERT OR IGNORE INTO anon_landings (message_id, kind, chat, msg_id) VALUES (?, ?, ?, ?)").bind(row.id, kind, chat, String(sent.message_id)).run();
      return kind;
    }),
  );
  const landed = results.filter((r) => r.status === "fulfilled").length;
  for (const r of results) if (r.status === "rejected") console.error("anon deliver", r.reason);
  // An account still has it in its inbox on the site (text only).
  if (!landed && !(to.userId && text)) {
    await db.prepare("DELETE FROM anon_messages WHERE id = ?").bind(row.id).run();
    return { ok: false, error: "❌ پیام ارسال نشد؛ دوباره امتحان کنید." };
  }
  if (landed) await db.prepare("UPDATE anon_messages SET to_msg_id = (SELECT msg_id FROM anon_landings WHERE message_id = ?1 LIMIT 1) WHERE id = ?1").bind(row.id).run();
  return { ok: true, id: row.id, root };
}

/** Tell the site's admins about a reported message. */
export async function reportAnon(db: D1Database, s: Settings, row: AnonRow, by: string, site: string) {
  const who = async (userId: number | null, kind: string, chat: string) => {
    const u = userId ? await db.prepare("SELECT name, phone FROM users WHERE id = ?").bind(userId).first<{ name: string; phone: string }>() : null;
    return u ? `${u.name} (${u.phone}, کاربر ${userId})` : `${kind} ${chat}`;
  };
  await notifyAdmins(
    db,
    s,
    [
      `⚠️ گزارش پیام ناشناس #${row.id}`,
      `فرستنده: ${await who(row.from_user_id, row.from_kind, row.from_chat)}`,
      `گیرنده: ${await who(row.recipient_id, row.to_kind, row.to_chat)}`,
      `گزارش از: ${by}`,
      `متن: ${row.body || "(پیام غیرمتنی)"}`,
      site ? `گفتگو: ${site}/admin/anon/${row.root_id}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** The buttons: anon:x cancel · r answer · m another message · b block · u unblock · p report. */
export async function handleAnonCallback(ctx: AnonCtx, data: string, answer: (text: string) => Promise<unknown>, site = "") {
  const [, action, idText] = data.split(":");
  if (action === "x") {
    await clearState(ctx);
    return answer("لغو شد");
  }
  const id = Number(idText);
  const me = await chatParty(ctx);
  // Buttons on a message that landed in this chat (answer, block, report) or this chat / account sent ("another").
  const row =
    action === "m"
      ? await ctx.db
          .prepare("SELECT * FROM anon_messages WHERE id = ? AND ((from_kind = ? AND from_chat = ?) OR (from_user_id IS NOT NULL AND from_user_id = ?))")
          .bind(id, ctx.kind, ctx.chatId, me.userId ?? -1)
          .first<AnonRow>()
      : await ctx.db
          .prepare(
            `SELECT m.* FROM anon_messages m WHERE m.id = ? AND (EXISTS (SELECT 1 FROM anon_landings l WHERE l.message_id = m.id AND l.kind = ? AND l.chat = ?)
               OR (m.to_kind = ? AND m.to_chat = ?) OR (m.recipient_id IS NOT NULL AND m.recipient_id = ?))`,
          )
          .bind(id, ctx.kind, ctx.chatId, ctx.kind, ctx.chatId, me.userId ?? -1)
          .first<AnonRow>();
  if (!row) return answer("این پیام پیدا نشد.");
  const other = senderOf(row);
  if (action === "r") {
    await setState(ctx, { kind: row.from_kind, chat: row.from_chat, userId: row.from_user_id, replyTo: row.id });
    await answer("پاسخت را بنویس");
    return say(ctx, "✍️ پاسخت را بنویس و بفرست؛ ناشناس به فرستنده می‌رسد.", CANCEL);
  }
  if (action === "m") {
    const to = recipientOf(row);
    await setState(ctx, { kind: to.kind, chat: to.chat, userId: to.userId });
    await answer("بنویس");
    return say(ctx, "✍️ پیام بعدی‌ات را بنویس و بفرست.", CANCEL);
  }
  if (action === "b") {
    await setBlock(ctx.db, me, other, true);
    await answer("بلاک شد");
    return say(ctx, "🚫 فرستنده‌ی این پیام بلاک شد؛ دیگر پیامی از او نمی‌گیری.", { inline_keyboard: [[{ text: "رفع بلاک", callback_data: `anon:u:${row.id}` }]] });
  }
  if (action === "u") {
    await setBlock(ctx.db, me, other, false);
    return answer("رفع بلاک شد");
  }
  if (action === "p") {
    await reportAnon(ctx.db, ctx.s, row, `${ctx.kind} ${ctx.chatId}`, site);
    return answer("گزارش شد؛ مدیران سایت بررسی می‌کنند. می‌توانی بلاکش هم بکنی.");
  }
  return answer("؟");
}

// ---------- the site: the profile's box and the inbox (/me/anon) ----------

export interface ThreadMsg {
  id: number;
  mine: boolean;
  body: string;
  created_at: number;
}

export interface Thread {
  root: number;
  started: boolean; // I wrote the first message (I know who it's to)
  with: string; // their name when I started it, else "ناشناس"
  username: string | null;
  messages: ThreadMsg[];
  last: number;
  blocked: boolean;
}

/** A user's conversations: the ones they started (to someone) and the ones they got (from "anonymous"). */
export async function inbox(db: D1Database, userId: number, onlyRoot?: number): Promise<Thread[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.root_id, m.body, m.created_at, m.from_user_id, m.from_kind, m.from_chat, m.recipient_id, m.to_kind, m.to_chat
       FROM anon_messages m
       WHERE m.root_id IN (SELECT root_id FROM anon_messages WHERE (recipient_id = ?1 OR from_user_id = ?1) ${onlyRoot ? "AND root_id = ?2" : ""}
                           GROUP BY root_id ORDER BY MAX(created_at) DESC LIMIT 50)
       ORDER BY m.id`,
    )
    .bind(...(onlyRoot ? [userId, onlyRoot] : [userId]))
    .all<AnonRow>();
  const byRoot = new Map<number, AnonRow[]>();
  for (const r of results) byRoot.set(r.root_id, [...(byRoot.get(r.root_id) ?? []), r]);
  const threads: Thread[] = [];
  for (const [root, rows] of byRoot) {
    const first = rows[0];
    const started = first.from_user_id === userId;
    let name = "ناشناس";
    let username: string | null = null;
    if (started && first.recipient_id) {
      const u = await db.prepare(`SELECT ${publicNameSql("users")} AS name, username FROM users WHERE id = ?`).bind(first.recipient_id).first<{ name: string; username: string | null }>();
      if (u) [name, username] = [u.name, u.username];
    }
    // The other side is whoever isn't me in the first message.
    const other = started ? recipientOf(first) : senderOf(first);
    threads.push({
      root,
      started,
      with: name,
      username,
      messages: rows.map((r) => ({ id: r.id, mine: r.from_user_id === userId, body: r.body, created_at: r.created_at })),
      last: rows[rows.length - 1].created_at,
      blocked: started ? false : await isBlocked(db, userParty(userId), other),
    });
  }
  return threads.sort((a, b) => b.last - a.last);
}

/** The other side of one of my conversations, and the message to answer (the last one I got). */
async function threadEnds(db: D1Database, userId: number, root: number) {
  const { results } = await db
    .prepare("SELECT * FROM anon_messages WHERE root_id = ? ORDER BY id")
    .bind(root)
    .all<AnonRow>();
  if (!results.length || !results.some((r) => r.from_user_id === userId || r.recipient_id === userId)) return null;
  const first = results[0];
  const started = first.from_user_id === userId;
  const lastIn = [...results].reverse().find((r) => r.recipient_id === userId && r.from_user_id !== userId) ?? null;
  return { first, started, lastIn, other: started ? recipientOf(first) : senderOf(first) };
}

/** Write in one of my conversations from the site (an answer to the last message I got, or another one). */
export async function webReply(db: D1Database, s: Settings, userId: number, root: number, text: string): Promise<Delivered> {
  const t = await threadEnds(db, userId, root);
  if (!t) return { ok: false, error: "این گفتگو پیدا نشد." };
  if (t.lastIn) return deliver(db, s, userParty(userId), { text }, senderOf(t.lastIn), t.lastIn);
  return deliver(db, s, userParty(userId), { text }, t.other, null, root);
}

export async function webBlock(db: D1Database, userId: number, root: number, on: boolean) {
  const t = await threadEnds(db, userId, root);
  if (!t || t.started) return false;
  await setBlock(db, userParty(userId), t.other, on);
  return true;
}

export async function webReport(db: D1Database, s: Settings, userId: number, root: number, site: string) {
  const t = await threadEnds(db, userId, root);
  if (!t || !t.lastIn) return false;
  await reportAnon(db, s, t.lastIn, `سایت (کاربر ${userId})`, site);
  return true;
}

/** "/anon" (or "پیام ناشناس") in the bot: the user's own anonymous links, to share. */
export async function sendAnonLinks(ctx: AnonCtx, site: string, botLink: (kind: BotKind, payload: string) => string) {
  const col = ctx.kind === "bale" ? "bale_chat_id" : "telegram_chat_id";
  const user = await ctx.db
    .prepare(`SELECT id, username, anon_enabled FROM users WHERE ${col} = ? LIMIT 1`)
    .bind(ctx.chatId)
    .first<{ id: number; username: string | null; anon_enabled: number }>();
  if (!user) return say(ctx, `برای گرفتن لینک پیام ناشناس، اول حساب ${ctx.s.site_name} را به این بات وصل کنید: ${site}/connect`);
  if (!user.anon_enabled) return say(ctx, `دریافت پیام ناشناس برایتان خاموش است؛ از صفحه‌ی «دوستان» روشنش کنید: ${site}/me/friends#anon`);
  const code = await anonCode(ctx.db, user.id);
  const links = (["telegram", "bale"] as BotKind[]).map((k) => [k, botLink(k, anonStart(code))] as const).filter(([, l]) => l);
  const mine = links.find(([k]) => k === ctx.kind)?.[1] ?? links[0]?.[1] ?? "";
  await say(
    ctx,
    [
      "🤫 لینک پیام ناشناس شما:",
      ...links.map(([k, l]) => `${KIND_FA[k]}: ${l}`),
      ...(user.username ? [`سایت: ${site}/u/${user.username}#anon`] : []),
      "",
      "این لینک را در استوری یا بیو بگذارید؛ هر کس بازش کند، بدون نامش برایتان می‌نویسد و شما ناشناس جواب می‌دهید.",
      `پیام‌ها در بله، تلگرام و صفحه‌ی «پیام‌های ناشناس» سایت می‌رسند: ${site}/me/anon`,
    ].join("\n"),
    mine ? { inline_keyboard: [[{ text: "📤 اشتراک‌گذاری", url: ctx.kind === "telegram" ? `https://t.me/share/url?url=${encodeURIComponent(mine)}&text=${encodeURIComponent("بهم پیام ناشناس بده 🤫")}` : mine }]] } : undefined,
  );
  // The text alone, easy to forward as is.
  if (mine) await say(ctx, `بهم پیام ناشناس بده 🤫\n${mine}`);
}
