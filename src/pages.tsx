// Pages for the footer: built-in ones (privacy, data deletion, terms, shipping) that the admin can
// rewrite, and new pages the admin adds. Text is written in a small, safe format:
//   ## heading   ### subheading   - list item   1. numbered item   **bold**   [text](https://… or /path)
// with a blank line between paragraphs. Nothing is rendered as HTML.
import type { Child } from "hono/jsx";
import type { Settings } from "./settings";

export type FooterColumn = "" | "explore" | "help" | "company";
export const FOOTER_COLUMNS: Record<Exclude<FooterColumn, "">, string> = {
  explore: "کاوش و خرید",
  help: "راهنما و پشتیبانی",
  company: "درباره ما",
};

export interface Page {
  slug: string;
  title: string;
  body: string;
  footer_column: FooterColumn;
  sort: number;
  builtin?: boolean; // has default text in the code; deleting the admin's version restores it
}

const contactLine = (s: Settings) =>
  [s.contact_email && `ایمیل: ${s.contact_email}`, s.contact_phone && `تلفن: ${s.contact_phone}`].filter(Boolean).join(" · ") || "از صفحه [درباره ما](/about#contact)";

/** Built-in pages with their default text (used until the admin saves their own version). */
export const BUILTIN_PAGES: Record<string, (s: Settings) => Omit<Page, "slug">> = {
  terms: (s) => ({
    title: "قوانین و مقررات",
    footer_column: "company",
    sort: 20,
    body: `${s.site_name} بستری است که در آن لیست آرزو می‌سازید و دوستانتان از فروشگاه‌های عضو برایتان کادو می‌خرند. استفاده از سایت یعنی پذیرش این قوانین.

## خرید و پرداخت
- قیمت، موجودی، بسته‌بندی و هزینه ارسال را هر فروشگاه خودش تعیین می‌کند.
- پرداخت کارت به کارت و مستقیم به حساب فروشگاه انجام می‌شود؛ سفارش پس از تأیید واریز توسط فروشگاه قطعی است.
- اگر کالا ناموجود شود، فروشگاه سفارش را لغو می‌کند و مبلغ را برمی‌گرداند یا جایگزین پیشنهاد می‌دهد.

## ارسال و تحویل
- آدرس گیرنده فقط برای فروشگاهی که کادو را می‌فرستد نمایش داده می‌شود و کادودهنده آن را نمی‌بیند.
- مسئولیت بسته‌بندی، ارسال و کیفیت کالا با فروشگاه است.

## حساب کاربری
- هر حساب با یک شماره موبایل ساخته می‌شود و نگه‌داری از آن با شماست.
- انتشار محتوای خلاف قانون یا آزار دیگران مجاز نیست و ممکن است حساب را مسدود کند.

## پشتیبانی
${contactLine(s)}`,
  }),
  shipping: () => ({
    title: "روش‌های ارسال",
    footer_column: "help",
    sort: 10,
    body: `هر فروشگاه خودش کادو را ارسال می‌کند و روش‌ها و هزینه‌ها را در صفحه خرید می‌بینید.

## پیک
برای سفارش‌های داخل شهر فروشگاه؛ معمولاً همان روز یا روز بعد.

## پست
برای همه شهرها؛ بعد از ارسال، کد رهگیری از طریق ربات برای شما و گیرنده فرستاده می‌شود.

## پیگیری سفارش
وضعیت سفارش و کد رهگیری را در [سفارشات من](/me/orders) ببینید.`,
  }),
  privacy: (s) => ({
    title: "حریم خصوصی",
    footer_column: "company",
    sort: 30,
    body: `## چه اطلاعاتی نگه می‌داریم
- شماره موبایل، نام، تاریخ تولد و لیست‌های آرزویی که خودتان در ${s.site_name} ثبت می‌کنید.
- اطلاعات سفارش (گیرنده، آدرس ارسال، مبلغ و رسید واریز) برای انجام سفارش.
- برای فروشگاه‌هایی که اینستاگرام خود را وصل کرده‌اند: پیام‌های دایرکت و کامنت‌هایی که برای آن فروشگاه فرستاده می‌شود، شناسه و نام کاربری فرستنده، تا فروشگاه بتواند پاسخ بدهد و سفارش ثبت کند.

## استفاده و اشتراک‌گذاری
این اطلاعات فقط برای انجام سفارش، ارتباط فروشگاه با مشتری و پشتیبانی استفاده می‌شود. اطلاعات هر مشتری فقط برای همان فروشگاهی که با آن در ارتباط بوده قابل دیدن است. اطلاعات را نمی‌فروشیم و برای تبلیغات به دیگران نمی‌دهیم. پیام‌های اینستاگرام از طریق API رسمی متا دریافت و ارسال می‌شوند.

## حذف اطلاعات
هر زمان بخواهید اطلاعاتتان حذف می‌شود؛ راهنما در صفحه [حذف اطلاعات](/data-deletion) است. ارتباط: ${contactLine(s)}`,
  }),
  "data-deletion": (s) => ({
    title: "حذف اطلاعات کاربر",
    footer_column: "",
    sort: 40,
    body: `برای حذف اطلاعات خود از ${s.site_name} (از جمله پیام‌ها و کامنت‌های اینستاگرامی که برای فروشگاه‌ها فرستاده‌اید):

1. درخواست حذف را با ذکر نام کاربری اینستاگرام یا شماره موبایل خود بفرستید: ${contactLine(s)}
2. حداکثر تا ۳۰ روز پیام‌ها، کامنت‌ها، پرونده مشتری و حساب کاربری شما حذف می‌شود و نتیجه را به شما اطلاع می‌دهیم.
3. اگر اپ را از اینستاگرام (Settings ← Apps and websites) حذف کنید، دریافت پیام‌های تازه هم قطع می‌شود. اطلاعاتی که قانوناً برای سوابق مالی سفارش لازم است تا زمان لازم نگه داشته می‌شود.`,
  }),
};

/** First path parts the site already uses: a page can't take these addresses. */
export const RESERVED_SLUGS = new Set([
  "about", "faq", "shops", "search", "login", "logout", "me", "panel", "admin", "crm", "p", "s", "w", "u", "c", "img", "static",
  "app", "order", "gift", "connect", "setup", "bot", "ig", "offline", "fonts", "page", "pages", "api",
]);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** A page by address: the admin's version, else the built-in default; null if neither exists. */
export async function getPage(db: D1Database, s: Settings, slug: string): Promise<Page | null> {
  const row = await db.prepare("SELECT slug, title, body, footer_column, sort FROM pages WHERE slug = ?").bind(slug).first<Page>();
  if (row) return { ...row, builtin: slug in BUILTIN_PAGES };
  const def = BUILTIN_PAGES[slug];
  return def ? { slug, ...def(s), builtin: true } : null;
}

/** Every page for the admin list: saved ones plus built-ins not yet rewritten. */
export async function allPages(db: D1Database, s: Settings): Promise<(Page & { custom: boolean })[]> {
  const { results } = await db.prepare("SELECT slug, title, body, footer_column, sort FROM pages ORDER BY sort, slug").all<Page>();
  const saved = new Set(results.map((r) => r.slug));
  return [
    ...results.map((r) => ({ ...r, builtin: r.slug in BUILTIN_PAGES, custom: true })),
    ...Object.entries(BUILTIN_PAGES)
      .filter(([slug]) => !saved.has(slug))
      .map(([slug, def]) => ({ slug, ...def(s), builtin: true, custom: false })),
  ].sort((a, b) => a.sort - b.sort);
}

/** Rebuild the footer link list kept in settings (read with every page, no extra query). */
export async function footerIndex(db: D1Database, s: Settings) {
  const pages = await allPages(db, s);
  return JSON.stringify(pages.filter((p) => p.footer_column).map((p) => [p.slug, p.title, p.footer_column]));
}

/** Footer links per column: from the saved index, or the built-in defaults before any save. */
export function footerLinks(s: Settings): Record<Exclude<FooterColumn, "">, [string, string][]> {
  let rows: [string, string, string][] = [];
  try {
    rows = s.pages_index ? JSON.parse(s.pages_index) : [];
  } catch {
    rows = [];
  }
  if (!s.pages_index) rows = Object.entries(BUILTIN_PAGES).map(([slug, def]) => { const d = def(s); return [slug, d.title, d.footer_column]; });
  const out = { explore: [] as [string, string][], help: [] as [string, string][], company: [] as [string, string][] };
  for (const [slug, title, col] of rows) if (col in out) out[col as keyof typeof out].push([`/${slug}`, title]);
  return out;
}

// ---------- the small text format ----------

const safeHref = (url: string) => (/^(https?:\/\/|\/|mailto:|tel:|#)/.test(url) ? url : "");

function inline(text: string): Child[] {
  const out: Child[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b>{m[1]}</b>);
    else {
      const href = safeHref(m[3]);
      const external = href.startsWith("http");
      out.push(href ? <a href={href} {...(external ? { target: "_blank", rel: "noopener" } : {})}>{m[2]}</a> : m[2]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render page text written in the small format above. */
export function PageText(props: { text: string }) {
  const blocks: Child[] = [];
  const lines = props.text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line.startsWith("### ")) { blocks.push(<h3 class="text-base font-black text-fg mt-6 mb-2">{inline(line.slice(4))}</h3>); i++; continue; }
    if (line.startsWith("## ")) { blocks.push(<h2 class="text-lg font-black text-fg mt-8 mb-3">{inline(line.slice(3))}</h2>); i++; continue; }
    if (/^[-*•] /.test(line) || /^[0-9۰-۹]+[.)] /.test(line)) {
      const ordered = /^[0-9۰-۹]+[.)] /.test(line);
      const items: Child[] = [];
      while (i < lines.length && (ordered ? /^[0-9۰-۹]+[.)] /.test(lines[i].trim()) : /^[-*•] /.test(lines[i].trim()))) {
        items.push(<li>{inline(lines[i].trim().replace(/^([-*•]|[0-9۰-۹]+[.)]) /, ""))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol class="list-decimal pr-6 space-y-1.5">{items}</ol> : <ul class="list-disc pr-6 space-y-1.5">{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |[-*•] |[0-9۰-۹]+[.)] )/.test(lines[i].trim())) para.push(lines[i++].trim());
    blocks.push(<p>{para.flatMap((l, n) => (n ? [<br />, ...inline(l)] : inline(l)))}</p>);
  }
  return <div class="page-text space-y-3 text-sm md:text-[15px] leading-8 text-fg/85">{blocks}</div>;
}
