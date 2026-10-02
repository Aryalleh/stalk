// One-time login codes delivered through Bale Safir.

const CODE_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const enc = new TextEncoder();
async function hash(phone: string, code: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(`${phone}:${code}`));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}

export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

interface OtpRow {
  code_hash: string;
  expires_at: number;
  attempts: number;
  last_sent_at: number;
  window_start: number;
  window_count: number;
}

/** Store a fresh code for the phone, or explain why not yet (rate limits). */
export async function issueCode(db: D1Database, phone: string, now = Date.now()): Promise<{ code: string } | { wait: string }> {
  const row = await db.prepare("SELECT * FROM otp_codes WHERE phone = ?").bind(phone).first<OtpRow>();
  if (row && now - row.last_sent_at < RESEND_AFTER_MS) {
    return { wait: `برای ارسال دوباره ${Math.ceil((RESEND_AFTER_MS - (now - row.last_sent_at)) / 1000)} ثانیه صبر کنید.` };
  }
  const inWindow = row && now - row.window_start < 3_600_000;
  if (inWindow && row.window_count >= MAX_SENDS_PER_HOUR) return { wait: "تعداد درخواست کد زیاد بوده؛ یک ساعت دیگر تلاش کنید." };
  const code = newCode();
  await db
    .prepare(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, last_sent_at, window_start, window_count)
       VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
       ON CONFLICT (phone) DO UPDATE SET code_hash = ?2, expires_at = ?3, attempts = 0, last_sent_at = ?4, window_start = ?5, window_count = ?6`,
    )
    .bind(phone, await hash(phone, code), now + CODE_TTL_MS, now, inWindow ? row.window_start : now, inWindow ? row.window_count + 1 : 1)
    .run();
  return { code };
}

/** Undo the last send (e.g. Safir failed) so the user can retry at once. */
export async function cancelCode(db: D1Database, phone: string) {
  await db.prepare("UPDATE otp_codes SET expires_at = 0, last_sent_at = 0 WHERE phone = ?").bind(phone).run();
}

/** Check a code. Each code works once and allows a few wrong tries. */
export async function verifyCode(db: D1Database, phone: string, code: string, now = Date.now()): Promise<true | string> {
  const row = await db.prepare("SELECT * FROM otp_codes WHERE phone = ?").bind(phone).first<OtpRow>();
  if (!row || row.expires_at < now) return "کد منقضی شده؛ دوباره درخواست کد بدهید.";
  if (row.attempts >= MAX_ATTEMPTS) return "تعداد تلاش‌ها زیاد بود؛ کد جدید بگیرید.";
  if ((await hash(phone, code)) !== row.code_hash) {
    await db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?").bind(phone).run();
    return "کد اشتباه است.";
  }
  await db.prepare("UPDATE otp_codes SET expires_at = 0 WHERE phone = ?").bind(phone).run();
  return true;
}
