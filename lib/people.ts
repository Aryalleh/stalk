// Profile fields: Jalali birth dates, public usernames and names.
import { toGregorian, toJalali } from "./jalali";
import { toLatinDigits } from "./normalize";

export const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

/** Today's Jalali year (Tehran time). */
export function currentJalaliYear(now = new Date()) {
  const t = new Date(now.getTime() + 3.5 * 3600_000);
  return toJalali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()).jy;
}

/** "YYYY-MM-DD" for a real Jalali date of someone 5 to 120 years old, or null. */
export function birthDate(year: string, month: string, day: string, now = new Date()): string | null {
  const [y, m, d] = [year, month, day].map((v) => Number(toLatinDigits(String(v ?? "")).trim()));
  const thisYear = currentJalaliYear(now);
  if (![y, m, d].every(Number.isInteger) || y < thisYear - 120 || y > thisYear - 5 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-trip through the Gregorian calendar to reject days that don't exist (e.g. 30 Esfand of a common year).
  const g = toGregorian(y, m, d);
  const back = toJalali(g.gy, g.gm, g.gd);
  if (back.jy !== y || back.jm !== m || back.jd !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "۱۲ مرداد" (no year: shown publicly). */
export function birthdayLabel(birth: string) {
  const m = birth.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2]).toLocaleString("fa-IR")} ${JALALI_MONTHS[Number(m[1]) - 1]}` : "";
}

const RESERVED = new Set(["admin", "panel", "me", "login", "logout", "app", "api", "crm", "setup", "support", "help", "about", "faq", "search", "static", "kadoochi"]);

/** Error message for a username, or "" when it can be used (uniqueness is checked by the database). */
export function usernameError(u: string) {
  if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(u)) return "نام کاربری باید ۳ تا ۳۰ حرف انگلیسی کوچک، عدد، نقطه، - یا _ باشد و با حرف یا عدد شروع شود.";
  if (RESERVED.has(u) || /^user\d+$/.test(u)) return "این نام کاربری رزرو است؛ نام دیگری انتخاب کنید.";
  return "";
}

export const fullName = (first: string, last: string) => `${first.trim()} ${last.trim()}`.trim();
