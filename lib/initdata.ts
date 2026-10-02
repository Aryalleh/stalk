// Bale and Telegram mini apps hand the page signed "initData" (a query string). The signature is
// HMAC-SHA256 over the sorted "key=value" lines, keyed with HMAC-SHA256("WebAppData", bot token);
// only someone holding the bot token can produce it, so a valid one proves who opened the app.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export interface MiniAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface InitData {
  user: MiniAppUser;
  authDate: number;
  startParam: string;
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The signature a bot with `botToken` would put on these fields (exported for tests). */
export async function signInitData(fields: Record<string, string>, botToken: string) {
  const check = Object.keys(fields)
    .filter((k) => k !== "hash" && k !== "signature")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  return hex(await hmac(secret, check));
}

/** Verify initData against a bot token. Returns null when it is forged, malformed or older than maxAgeSec. */
export async function verifyInitData(raw: string, botToken: string, maxAgeSec = 86400, nowSec = Math.floor(Date.now() / 1000)): Promise<InitData | null> {
  if (!raw || !botToken || raw.length > 4096) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of params) fields[k] = v;
  const expected = await signInitData(fields, botToken);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;
  let user: MiniAppUser;
  try {
    user = JSON.parse(fields.user ?? "");
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return { user, authDate, startParam: fields.start_param ?? "" };
}
