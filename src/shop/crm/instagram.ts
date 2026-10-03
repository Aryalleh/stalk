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
