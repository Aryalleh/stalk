// Site-wide settings live in D1 and are edited from /admin/settings, so changing them needs no
// redeploy and no Cloudflare secrets.

export const DEFAULTS = {
  site_name: "کادوچی",
  site_url: "", // empty = use the address the site is opened on
  reservation_minutes: "30", // how long a giver has to transfer and report it
  bale_bot_token: "",
  bale_bot_username: "", // filled in automatically when the bot is connected
  telegram_bot_token: "",
  telegram_bot_username: "",
  bot_webhook_secret: "", // generated automatically
};

export type SettingKey = keyof typeof DEFAULTS;
export type Settings = Record<SettingKey, string>;

/** Keys whose values are secret: never rendered back into pages. */
export const SECRET_KEYS: SettingKey[] = ["bale_bot_token", "telegram_bot_token", "bot_webhook_secret"];

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const out: Settings = { ...DEFAULTS };
  for (const r of results) if (r.key in DEFAULTS) out[r.key as SettingKey] = r.value;
  return out;
}

export async function saveSettings(db: D1Database, values: Partial<Settings>) {
  const entries = Object.entries(values).filter(([k]) => k in DEFAULTS);
  if (!entries.length) return;
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  await db.batch(entries.map(([k, v]) => stmt.bind(k, v ?? "")));
}

/** Secret used in bot webhook URLs; created on first use. */
export async function webhookSecret(db: D1Database, s: Settings) {
  if (s.bot_webhook_secret) return s.bot_webhook_secret;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await saveSettings(db, { bot_webhook_secret: secret });
  s.bot_webhook_secret = secret;
  return secret;
}

export function reservationMinutes(s: Settings) {
  const n = Math.floor(Number(s.reservation_minutes));
  return n >= 5 && n <= 24 * 60 ? n : 30;
}

/** Last 4 chars of a secret for display, e.g. "••••abcd". */
export const mask = (v: string) => (v ? `••••${v.slice(-4)}` : "");
