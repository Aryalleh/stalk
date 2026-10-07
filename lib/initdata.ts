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

/**
 * The signature a bot with `botToken` would put on these fields (exported for tests). Telegram (Bot API
 * 8.0+) also sends a "signature" field (for Ed25519 checks by third parties) and its HMAC hash covers it;
 * pass dropSignature to sign without it, as older clients and Bale do.
 */
export async function signInitData(fields: Record<string, string>, botToken: string, dropSignature = false) {
  const check = Object.keys(fields)
    .filter((k) => k !== "hash" && !(dropSignature && k === "signature"))
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  return hex(await hmac(secret, check));
}

/** Why initData was refused (logged, and shown to the person as a short code). */
export type InitDataProblem = "empty" | "no_token" | "too_long" | "no_hash" | "bad_hash" | "expired" | "future" | "bad_user";

const sameHex = (a: string, b: string) => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** Check initData against a bot token: the data, or why it was refused. */
export async function checkInitData(
  raw: string,
  botToken: string,
  maxAgeSec = 86400,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ data: InitData; problem?: undefined } | { data?: undefined; problem: InitDataProblem }> {
  if (!raw) return { problem: "empty" };
  if (!botToken) return { problem: "no_token" };
  if (raw.length > 8192) return { problem: "too_long" };
  const params = new URLSearchParams(raw);
  const hash = (params.get("hash") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { problem: "no_hash" };
  const fields: Record<string, string> = {};
  for (const [k, v] of params) fields[k] = v;
  const ok = sameHex(await signInitData(fields, botToken), hash) || ("signature" in fields && sameHex(await signInitData(fields, botToken, true), hash));
  if (!ok) return { problem: "bad_hash" };
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) return { problem: "expired" };
  if (authDate - nowSec > 300) return { problem: "future" };
  let user: MiniAppUser;
  try {
    user = JSON.parse(fields.user ?? "");
  } catch {
    return { problem: "bad_user" };
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { problem: "bad_user" };
  return { data: { user, authDate, startParam: fields.start_param ?? "" } };
}

/** Verify initData against a bot token. Returns null when it is forged, malformed or older than maxAgeSec. */
export async function verifyInitData(raw: string, botToken: string, maxAgeSec = 86400, nowSec = Math.floor(Date.now() / 1000)): Promise<InitData | null> {
  return (await checkInitData(raw, botToken, maxAgeSec, nowSec)).data ?? null;
}
