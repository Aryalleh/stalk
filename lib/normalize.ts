const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(value: string): string {
  return (value ?? "").replace(/[۰-۹٠-٩]/g, (d) => {
    const i = PERSIAN.indexOf(d);
    return String(i >= 0 ? i : ARABIC.indexOf(d));
  });
}

/** Local form: "+98 912-123 4567" → "09121234567". "" stays "". */
export function normalizePhone(value: string): string {
  let v = toLatinDigits(value).replace(/[\s\-()./]/g, "");
  if (!v) return "";
  if (v.startsWith("+98")) v = "0" + v.slice(3);
  else if (v.startsWith("0098")) v = "0" + v.slice(4);
  else if (v.startsWith("98") && v.length === 12) v = "0" + v.slice(2);
  else if (v.startsWith("9") && v.length === 10) v = "0" + v;
  return v;
}

export function normalizeDigits(value: string): string {
  return toLatinDigits(value).replace(/[\s\-]/g, "");
}

const SOCIAL_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|instagram\.com|twitter\.com|x\.com|ble\.ir)\/@?([^/?#]+)/i;

/** "@user", "user" or a profile URL → "user". */
export function normalizeHandle(value: string): string {
  let v = toLatinDigits(value).trim();
  const m = v.match(SOCIAL_URL);
  if (m) v = m[1];
  return v.replace(/^@+/, "").trim();
}

export function phoneError(value: string): string | null {
  return value && !/^\+?\d{5,15}$/.test(value) ? "شماره تماس نامعتبر است." : null;
}

/** Iranian national code (کد ملی) checksum. */
export function nationalCodeError(value: string): string | null {
  if (!value) return null;
  if (!/^\d{10}$/.test(value) || new Set(value).size === 1) return "کد ملی باید ۱۰ رقم معتبر باشد.";
  const check = Number(value[9]);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(value[i]) * (10 - i);
  s %= 11;
  const ok = s < 2 ? check === s : check === 11 - s;
  return ok ? null : "کد ملی نامعتبر است (رقم کنترل اشتباه است).";
}

export function postalCodeError(value: string): string | null {
  return value && !/^\d{10}$/.test(value) ? "کد پستی باید ۱۰ رقم باشد." : null;
}

/** 16-digit bank card number with a valid Luhn checksum (all Shetab cards use it). */
export function cardNumberError(value: string): string | null {
  if (!/^\d{16}$/.test(value)) return "شماره کارت باید ۱۶ رقم باشد.";
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = Number(value[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? null : "شماره کارت نامعتبر است.";
}

export const formatCard = (card: string) => card.replace(/(\d{4})(?=\d)/g, "$1-");
