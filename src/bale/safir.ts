// Bale "Safir" REST API: messages to a phone number (paid per message) and one-time codes.
// https://safir.bale.ai/api/v3/send_message

import type { Settings } from "../settings";

const SAFIR_URL = "https://safir.bale.ai/api/v3/send_message";

const ERRORS: Record<number, string> = {
  2: "خطای داخلی سرور بله",
  3: "تعداد پیام‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید",
  4: "درخواست نامعتبر",
  8: "شماره نامعتبر است",
  17: "این شماره حساب بله ندارد",
  20: "اعتبار سفیر کافی نیست",
  21: "به سقف تعداد مخاطبین بازو رسیده‌اید",
};

export class SafirError extends Error {
  constructor(public code: number, description: string) {
    super(ERRORS[code] ?? description ?? `Safir error ${code}`);
  }
}

/** 09121234567 → 989121234567 (the only format Safir accepts). */
export function toSafirPhone(phone: string) {
  if (!/^09\d{9}$/.test(phone)) throw new SafirError(8, "invalid phone");
  return "98" + phone.slice(1);
}

type MessageData = { message: { text: string } } | { otp_message: { otp: string } };

async function send(s: Settings, phone: string, data: MessageData, requestId = crypto.randomUUID()) {
  if (!s.safir_api_key || !s.safir_bot_id) throw new SafirError(0, "سفیر بله در تنظیمات سایت فعال نشده است");
  const res = await fetch(SAFIR_URL, {
    method: "POST",
    headers: { "api-access-key": s.safir_api_key, "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, bot_id: Number(s.safir_bot_id), phone_number: toSafirPhone(phone), message_data: data }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error_data?: { code: number; description: string }[] | null;
  };
  const err = body.error_data?.[0];
  if (err) throw new SafirError(err.code, err.description);
  if (!res.ok || !body.message_id) throw new SafirError(0, `اتصال به سفیر بله ناموفق بود (HTTP ${res.status})`);
  return body.message_id;
}

export const sendSafirOtp = (s: Settings, phone: string, otp: string) => send(s, phone, { otp_message: { otp } });
export const sendSafirText = (s: Settings, phone: string, text: string) => send(s, phone, { message: { text } });
