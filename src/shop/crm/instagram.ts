// Instagram Direct (Instagram API with Instagram Login). A Meta app's webhook delivers DMs for every
// connected shop to /ig/webhook; each shop connects its account (id + long-lived access token) in the
// panel. https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api

const GRAPH = "https://graph.instagram.com/v21.0";
const enc = new TextEncoder();

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(app secret, raw body). */
export async function validSignature(rawBody: string, header: string | undefined, appSecret: string) {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface IgEvent {
  accountId: string; // the shop's Instagram account (entry.id)
  customerId: string; // the other person (IGSID)
  direction: "in" | "out"; // "out" = echo of a message the shop sent from the Instagram app
  mid: string;
  type: string; // text / image / video / audio / story_reply / share / ...
  body: string;
  at: string;
}

interface Payload {
  object?: string;
  entry?: {
    id?: string;
    changes?: { field?: string; value?: CommentValue }[];
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        is_deleted?: boolean;
        attachments?: { type?: string; payload?: { url?: string } }[];
        reply_to?: { story?: { url?: string } };
      };
    }[];
  }[];
}

/** The DMs in a webhook delivery (reactions, reads and deletions are ignored). */
export function parseWebhook(body: unknown): IgEvent[] {
  const p = body as Payload;
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: IgEvent[] = [];
  for (const entry of p.entry) {
    const accountId = String(entry.id ?? "");
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid || m.is_deleted) continue;
      const echo = !!m.is_echo;
      const customerId = String((echo ? ev.recipient?.id : ev.sender?.id) ?? "");
      if (!accountId || !customerId) continue;
      const att = m.attachments?.[0];
      const type = m.reply_to?.story ? "story_reply" : m.text ? "text" : (att?.type ?? "text");
      const body = m.text ?? (att?.payload?.url ? `[${att.type ?? "attachment"}] ${att.payload.url}` : "");
      out.push({
        accountId,
        customerId,
        direction: echo ? "out" : "in",
        mid: m.mid,
        type,
        body: body.slice(0, 4000),
        at: new Date(ev.timestamp ?? Date.now()).toISOString(),
      });
    }
  }
  return out;
}

/** Send a text DM. Returns Instagram's message id. */
export async function sendDm(token: string, accountId: string, recipientId: string, text: string) {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
  if (!res.ok || !data.message_id) throw new Error(data.error?.message ?? `instagram ${res.status}`);
  return data.message_id;
}

/** Username and name of an Instagram user who messaged the account (best effort). */
export async function fetchProfile(token: string, igsid: string) {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(igsid)}?fields=name,username`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return {};
    const d = (await res.json()) as { name?: string; username?: string };
    return { name: d.name ?? "", username: d.username ?? "" };
  } catch {
    return {};
  }
}

// ---------- comments on posts / reels ----------

interface CommentValue {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
}

export interface IgComment {
  accountId: string;
  commentId: string;
  mediaId: string;
  fromId: string;
  username: string;
  text: string;
  parentId: string | null;
}

/** New comments in a webhook delivery (field "comments"). */
export function parseComments(body: unknown): IgComment[] {
  const p = body as Payload;
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: IgComment[] = [];
  for (const entry of p.entry) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      if (ch.field !== "comments" || !v?.id || !v.from?.id || !v.media?.id) continue;
      out.push({
        accountId: String(entry.id ?? ""),
        commentId: String(v.id),
        mediaId: String(v.media.id),
        fromId: String(v.from.id),
        username: v.from.username ?? "",
        text: (v.text ?? "").slice(0, 2000),
        parentId: v.parent_id ? String(v.parent_id) : null,
      });
    }
  }
  return out;
}

async function graph<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `instagram ${res.status}`);
  return data;
}

/** Private reply: a DM to the person who commented (once per comment, within 7 days). */
export async function privateReply(token: string, accountId: string, commentId: string, text: string) {
  const d = await graph<{ message_id?: string }>(token, `${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  return d.message_id ?? null;
}

/** Public reply under a comment. */
export async function replyToComment(token: string, commentId: string, text: string) {
  const d = await graph<{ id?: string }>(token, `${encodeURIComponent(commentId)}/replies`, { method: "POST", body: JSON.stringify({ message: text }) });
  return d.id ?? null;
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
  comments_count?: number;
}

/** The account's latest posts and reels. */
export async function listMedia(token: string, accountId: string, limit = 24) {
  const fields = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,comments_count";
  const d = await graph<{ data?: IgMedia[] }>(token, `${encodeURIComponent(accountId)}/media?fields=${fields}&limit=${limit}`);
  return d.data ?? [];
}

/** The professional account behind a token: user_id is the id webhooks use (not the app-scoped id). */
export async function fetchAccount(token: string) {
  const d = await graph<{ user_id?: string | number; id?: string; username?: string }>(token, "me?fields=user_id,username");
  return { accountId: String(d.user_id ?? d.id ?? ""), username: d.username ?? "" };
}

/** Long-lived tokens last 60 days; refreshing (allowed once they are a day old) gives another 60. */
export async function refreshToken(token: string) {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!res.ok || !d.access_token) throw new Error(d.error?.message ?? `instagram ${res.status}`);
  return d.access_token;
}

// ---------- "Connect with Instagram" (Instagram Business Login, OAuth) ----------

export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"];

export function authorizeUrl(appId: string, redirectUri: string, state: string) {
  const p = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: IG_SCOPES.join(","), state });
  return `https://www.instagram.com/oauth/authorize?force_reauth=true&${p}`;
}

/** Code → short-lived token → long-lived (60-day) token. */
export async function exchangeCode(appId: string, appSecret: string, redirectUri: string, code: string) {
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") }),
  });
  type Short = { access_token?: string; user_id?: string | number; error_message?: string; error?: { message?: string } };
  const raw = (await res.json().catch(() => ({}))) as Short & { data?: Short[] };
  const d = raw.data?.[0] ?? raw;
  if (!res.ok || !d.access_token) throw new Error(d.error_message ?? d.error?.message ?? raw.error_message ?? `instagram ${res.status}`);
  const long = await fetch(
    `${GRAPH.replace(/\/v[\d.]+$/, "")}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(d.access_token)}`,
  );
  const l = (await long.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
  if (!long.ok || !l.access_token) throw new Error(l.error?.message ?? `instagram ${long.status}`);
  return l.access_token;
}
