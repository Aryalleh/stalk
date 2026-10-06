import type { Settings } from "./settings";

// Copy shared by the home page, /about, /faq and llms.txt (and their FAQPage / HowTo data).

/** The FAQ: the admin's list from /admin/content, or the built-in one. */
export function faqs(s: Settings): [string, string][] {
  try {
    const list = s.faq_items ? (JSON.parse(s.faq_items) as unknown) : null;
    if (Array.isArray(list) && list.length && list.every((r) => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string")) {
      return list as [string, string][];
    }
  } catch {
    // fall back to the built-in list
  }
  return defaultFaqs(s);
}

export function defaultFaqs(s: Settings): [string, string][] {
  const n = s.site_name;
  return [
    [`${n} چیست؟`, `${n} یک بازار آنلاین برای کادو گرفتن است: هر کس محصولات دلخواهش را از فروشگاه‌های عضو به «لیست آرزو» اضافه می‌کند و لینک لیست را برای دوستان و خانواده می‌فرستد تا هر کدام یکی از آرزوها را برایش بخرند.`],
    ["لیست آرزو چطور ساخته می‌شود؟", "با شماره موبایل و کد یکبار مصرف بله وارد شوید، روی «لیست جدید» بزنید، عنوان، شهر و آدرس گیرنده را وارد کنید و از صفحه هر محصول آن را به لیست اضافه کنید. بعد لینک لیست را به اشتراک بگذارید."],
    ["پرداخت چطور انجام می‌شود؟", "پرداخت کارت به کارت و مستقیم به حساب خود فروشگاه است. خریدار مبلغ را واریز می‌کند و فقط عکس فیش را می‌فرستد؛ فروشگاه بعد از دیدن واریز آن را تأیید می‌کند و کادو را ارسال می‌کند."],
    ["آیا آدرس من به خریدار کادو نشان داده می‌شود؟", "خیر. آدرس گیرنده محرمانه است: خریدار هیچ‌وقت آن را نمی‌بیند و فروشگاه هم فقط بعد از تأیید واریز، برای ارسال، به آن دسترسی پیدا می‌کند."],
    ["می‌توانم برای خودم هم مستقیم خرید کنم؟", "بله. در صفحه هر محصول دکمه «خرید مستقیم» را بزنید، آدرس خودتان را وارد کنید و مثل خرید کادو کارت به کارت کنید."],
    ["کادو چطور و با چه هزینه‌ای ارسال می‌شود؟", "هر فروشگاه شهر خودش را مشخص می‌کند: داخل همان شهر می‌تواند با پیک بفرستد و به همه شهرها با پست. هزینه هر روش را فروشگاه تعیین می‌کند و قبل از پرداخت در جمع مبلغ نمایش داده می‌شود."],
    ["اگر دو نفر هم‌زمان یک آرزو را بخرند چه می‌شود؟", "آرزو برای اولین خریدار برای مدت کوتاهی رزرو می‌شود و تا تأیید یا رد واریز، کس دیگری نمی‌تواند همان را بخرد؛ پس کادوی تکراری خریده نمی‌شود."],
    ["فروشگاه‌ها چطور عضو می‌شوند؟", `صاحب فروشگاه وارد ${n} می‌شود، از «پنل فروشگاه» فروشگاهش را ثبت می‌کند و بعد از تأیید مدیر سایت، محصولاتش با عکس، ویدیو، بسته‌بندی کادویی و راهنمای سایز در سایت نمایش داده می‌شود.`],
    ["از کجا بفهمم کادو ارسال شده؟", "خریدار یک صفحه پیگیری اختصاصی دارد که مراحل «پرداخت، تأیید فروشگاه و ارسال» و کد رهگیری را نشان می‌دهد. پیام‌ها هم از طریق بات بله یا تلگرام می‌رسند."],
  ];
}

export const STEPS: [string, string][] = [
  ["لیست آرزو بساز", "وارد شو و یک لیست آرزو با شهر و آدرس گیرنده بساز."],
  ["آرزوهایت را اضافه کن", "محصولات دلخواهت را از فروشگاه‌ها پیدا کن و به لیست اضافه کن؛ برای لباس، سایزت را هم انتخاب کن."],
  ["لینک را بفرست", "لینک لیست را در پیام‌رسان‌ها و شبکه‌های اجتماعی برای دوستانت بفرست."],
  ["کادو بگیر", "هر کس آرزویی را بخرد، فروشگاه بعد از تأیید واریز آن را مستقیم به آدرست می‌فرستد."],
];


/** The About page's "how it works" steps: the admin's lines ("title | text"), the built-in ones, or none. */
export function aboutSteps(s: Settings): [string, string][] {
  const raw = s.about_steps.trim();
  if (!raw) return STEPS;
  if (raw === "-") return [];
  return raw
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter(([t, d]) => t && d)
    .map(([t, d]) => [t, d] as [string, string]);
}

export const aboutTitle = (s: Settings) => s.about_title || `${s.site_name} چیست؟`;

export const defaultAboutBody = (s: Settings) =>
  `${s.site_name} یک بازار آنلاین برای کادو گرفتن است. کاربران محصولات دلخواهشان را از فروشگاه‌های ایرانی عضو، به «لیست آرزو» اضافه می‌کنند و لینک لیست را برای دوستان و خانواده می‌فرستند؛ هر کس یکی از آرزوها را بخرد، فروشگاه آن را مستقیم برای صاحب لیست ارسال می‌کند.

پرداخت کارت به کارت و مستقیم به حساب فروشگاه است و آدرس گیرنده به خریدار نشان داده نمی‌شود.`;

/** About text as blocks: paragraphs (blank-line separated) and bullet lists (lines starting with "-"). */
export function aboutBlocks(s: Settings): ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] {
  return (s.about_body || defaultAboutBody(s))
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim());
      return lines.every((l) => /^[-•*]\s+/.test(l))
        ? { kind: "ul" as const, items: lines.map((l) => l.replace(/^[-•*]\s+/, "")) }
        : { kind: "p" as const, text: lines.join(" ") };
    });
}

/** The developer credit link: a URL, or a Telegram id written as @name. */
export function developerHref(link: string) {
  const v = link.trim();
  if (/^https?:\/\//.test(v)) return v;
  if (/^@?[A-Za-z][\w]{3,31}$/.test(v)) return `https://t.me/${v.replace(/^@/, "")}`;
  return "";
}
