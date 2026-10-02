import type { Settings } from "../settings";

// Bale's bot API is Telegram-compatible; only the host differs.
const BOT_API = {
  bale: "https://tapi.bale.ai/bot",
  telegram: "https://api.telegram.org/bot",
} as const;
export type BotKind = keyof typeof BOT_API;
export const BOT_KINDS: BotKind[] = ["bale", "telegram"];

export function botToken(s: Settings, kind: BotKind) {
  return kind === "bale" ? s.bale_bot_token : s.telegram_bot_token;
}

export function botUsername(s: Settings, kind: BotKind) {
  return kind === "bale" ? s.bale_bot_username : s.telegram_bot_username;
}

/** Deep link that opens the bot with a /start payload. */
export function botLink(s: Settings, kind: BotKind, payload: string) {
  const u = botUsername(s, kind);
  if (!u) return "";
  return kind === "bale" ? `https://ble.ir/${u}?start=${payload}` : `https://t.me/${u}?start=${payload}`;
}

/** Bots that are set up and connected (webhook registered). */
export const activeBots = (s: Settings) => BOT_KINDS.filter((k) => botToken(s, k) && botUsername(s, k));

async function callBot(s: Settings, kind: BotKind, method: string, body: object | FormData) {
  const token = botToken(s, kind);
  if (!token) throw new Error(`${kind} bot token is not configured`);
  const isForm = body instanceof FormData;
  const res = await fetch(`${BOT_API[kind]}${token}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !data.ok) throw new Error(`${kind} ${method} ${res.status}: ${data.description ?? "error"}`);
  return data.result;
}

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };

export async function sendBotMessage(s: Settings, kind: BotKind, chatId: string, text: string, replyMarkup?: object) {
  await callBot(s, kind, "sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

export async function sendBotPhoto(
  s: Settings,
  kind: BotKind,
  chatId: string,
  photo: { data: ArrayBuffer; type: string; name: string },
  caption: string,
  replyMarkup?: object,
) {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption.slice(0, 1024));
  form.set("photo", new Blob([photo.data], { type: photo.type }), photo.name);
  if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
  await callBot(s, kind, "sendPhoto", form);
}

export async function answerCallback(s: Settings, kind: BotKind, callbackId: string, text: string) {
  await callBot(s, kind, "answerCallbackQuery", { callback_query_id: callbackId, text });
}

/** Remove the inline buttons under a message (best effort). */
export async function clearButtons(s: Settings, kind: BotKind, chatId: string, messageId: number) {
  await callBot(s, kind, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(
    () => undefined,
  );
}

/** Check a token and point the bot's webhook at this site. Returns the bot's username. */
export async function connectBot(kind: BotKind, token: string, webhookUrl: string) {
  const s = { [kind === "bale" ? "bale_bot_token" : "telegram_bot_token"]: token } as unknown as Settings;
  const me = (await callBot(s, kind, "getMe", {})) as { username?: string };
  await callBot(s, kind, "setWebhook", { url: webhookUrl });
  return me.username ?? "";
}

// ---------- sending to people (their connected chats) ----------

export interface Chats {
  bale_chat_id: string;
  telegram_chat_id: string;
}

const targets = (s: Settings, to: Chats): [BotKind, string][] =>
  ([
    ["bale", to.bale_chat_id],
    ["telegram", to.telegram_chat_id],
  ] as [BotKind, string][]).filter(([k, id]) => id && botToken(s, k));

function summarize(results: PromiseSettledResult<unknown>[], t: [BotKind, string][]) {
  if (!t.length) return "no connected chat";
  return results
    .map((r, i) => (r.status === "rejected" ? `${t[i][0]}: ${(r.reason as Error).message}` : ""))
    .filter(Boolean)
    .join("; ");
}

/** Send to every chat the person connected. Returns an error summary ("" if all succeeded). */
export async function sendToChats(s: Settings, to: Chats, text: string, markup?: (kind: BotKind) => object | undefined) {
  const t = targets(s, to);
  return summarize(await Promise.allSettled(t.map(([k, id]) => sendBotMessage(s, k, id, text, markup?.(k)))), t);
}

export async function sendPhotoToChats(
  s: Settings,
  to: Chats,
  photo: { data: ArrayBuffer; type: string; name: string },
  caption: string,
  markup?: (kind: BotKind) => object | undefined,
) {
  const t = targets(s, to);
  return summarize(await Promise.allSettled(t.map(([k, id]) => sendBotPhoto(s, k, id, photo, caption, markup?.(k)))), t);
}

/** Message every platform admin. */
export async function notifyAdmins(db: D1Database, s: Settings, text: string) {
  const { results } = await db.prepare("SELECT bale_chat_id, telegram_chat_id FROM users WHERE is_admin = 1").all<Chats>();
  await Promise.allSettled(results.map((a) => sendToChats(s, a, text)));
}
