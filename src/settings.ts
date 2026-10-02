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
  safir_api_key: "", // Bale Safir (business panel) api-access-key: OTP and paid messages by phone
  safir_bot_id: "", // numeric id of the bot Safir sends as
  categories: "تولد\nدکوراسیون\nتکنولوژی\nاکسسوری\nکتاب\nپوشاک\nگل و گیاه", // product categories, one per line
  featured_shop_id: "", // the "shop of the week" banner on the home page
  site_description: "", // meta description of the home page (search engines, AI answers, link previews); empty = default text
};

export type SettingKey = keyof typeof DEFAULTS;
export type Settings = Record<SettingKey, string>;

/** Keys whose values are secret: never rendered back into pages. */
export const SECRET_KEYS: SettingKey[] = ["bale_bot_token", "telegram_bot_token", "bot_webhook_secret", "safir_api_key"];

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

export const safirReady = (s: Settings) => !!(s.safir_api_key && s.safir_bot_id);

export const categoryList = (s: Settings) =>
  s.categories
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);

/** Home page description for search engines and link previews. */
export const siteDescription = (s: Settings) =>
  s.site_description ||
  `${s.site_name}: لیست آرزوی آنلاین بساز، لینکش را برای دوستانت بفرست و از فروشگاه‌های ایرانی کادو بگیر. پرداخت کارت به کارت مستقیم به حساب فروشگاه و ارسال به آدرس محرمانه گیرنده.`;
