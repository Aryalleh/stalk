import { Hono } from "hono";
import type { C, Env } from "./env";
import { organizationLd, summary } from "./schema";
import { STEPS, aboutBlocks, aboutTitle, developerHref, faqs } from "./content";
import { render, siteOrigin } from "./render";
import { categoryList, siteDescription, socialLinks, type Settings } from "./settings";
import { Layout, SOCIAL_ICON } from "./shop/views/layout";

// Search engines and AI answer engines: robots.txt, sitemap.xml, llms.txt, and the About / FAQ
// pages whose question-and-answer content is also published as FAQPage / HowTo structured data.

export const seo = new Hono<Env>();

/** Paths with personal or transactional content: never crawled. */
const PRIVATE = ["/me", "/panel", "/admin", "/crm", "/login", "/connect", "/setup", "/order/", "/gift/", "/w/", "/app", "/bot/", "/offline"];

seo.get("/robots.txt", (c) => {
  const origin = siteOrigin(c);
  const body = [
    "User-agent: *",
    "Allow: /",
    ...PRIVATE.map((p) => `Disallow: ${p}`),
    "Disallow: /*?*q=",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
  return c.text(body, 200, { "Cache-Control": "public, max-age=3600" });
});

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

seo.get("/sitemap.xml", async (c) => {
  const origin = siteOrigin(c);
  const db = c.env.DB;
  const [shops, products] = await db.batch([
    db.prepare("SELECT slug, logo_key, created_at FROM shops WHERE status = 'approved' ORDER BY id LIMIT 5000"),
    db.prepare(
      `SELECT p.id, p.title, p.image_key, p.updated_at FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.is_active = 1 AND s.status = 'approved' ORDER BY p.id DESC LIMIT 40000`,
    ),
  ]);
  const url = (loc: string, opts: { lastmod?: string; priority?: string; image?: string; imageTitle?: string } = {}) =>
    `<url><loc>${xml(origin + loc)}</loc>` +
    (opts.lastmod ? `<lastmod>${opts.lastmod.slice(0, 10)}</lastmod>` : "") +
    (opts.priority ? `<priority>${opts.priority}</priority>` : "") +
    (opts.image ? `<image:image><image:loc>${xml(origin + "/img/" + opts.image)}</image:loc>${opts.imageTitle ? `<image:title>${xml(opts.imageTitle)}</image:title>` : ""}</image:image>` : "") +
    "</url>";
  const lines = [
    url("/", { priority: "1.0" }),
    url("/about", { priority: "0.6" }),
    url("/shops", { priority: "0.8" }),
    url("/faq", { priority: "0.6" }),
    url("/privacy", { priority: "0.2" }),
    ...categoryList(c.get("settings")).map((cat) => url(`/c/${encodeURIComponent(cat)}`, { priority: "0.7" })),
    ...(shops.results as { slug: string; logo_key: string; created_at: string }[]).map((s) =>
      url(`/s/${s.slug}`, { priority: "0.8", lastmod: s.created_at, image: s.logo_key }),
    ),
    ...(products.results as { id: number; title: string; image_key: string; updated_at: string }[]).map((p) =>
      url(`/p/${p.id}`, { priority: "0.9", lastmod: p.updated_at, image: p.image_key, imageTitle: p.title }),
    ),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    lines.join("\n") +
    "\n</urlset>\n";
  return c.body(body, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

function organization(c: C) {
  return organizationLd({ ...c.get("settings"), origin: siteOrigin(c), path: "/", signedIn: false, actingAs: null });
}

seo.get("/about", (c) => {
  const s = c.get("settings");
  const origin = siteOrigin(c);
  const blocks = aboutBlocks(s);
  const firstText = blocks.find((b) => b.kind === "p");
  const description = summary(firstText && firstText.kind === "p" ? firstText.text : siteDescription(s), 158);
  const dev = developerHref(s.developer_link);
  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `کادو گرفتن با ${s.site_name}`,
    description,
    step: STEPS.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text, url: `${origin}/about#step-${i + 1}` })),
  };
  const page = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: aboutTitle(s),
    url: `${origin}/about`,
    about: { "@id": `${origin}/#organization` },
    ...(s.developer_name ? { creator: { "@type": "Person", name: s.developer_name, ...(dev ? { url: dev } : {}) } } : {}),
  };
  const socials = socialLinks(s);
  const contact = (href: string, icon: string, label: string, value: string, external = false) => (
    <a href={href} {...(external ? { target: "_blank", rel: "noopener" } : {})} class="flex items-center gap-3 p-3 rounded-2xl bg-ink/60 hover:bg-ink !text-fg">
      <span class="w-10 h-10 rounded-xl bg-brand/15 text-brand flex items-center justify-center shrink-0"><i class={icon}></i></span>
      <span class="min-w-0">
        <span class="block text-[11px] text-muted">{label}</span>
        <span class="block text-sm font-bold truncate ltr text-right">{value}</span>
      </span>
    </a>
  );
  const handle = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return render(
    c,
    <Layout title={aboutTitle(s)} user={c.get("user")} seo={{ index: true, description, type: "article", jsonLd: [organization(c), page, howTo] }}>
      <article class="space-y-6">
        <header class="text-center pt-2">
          <img src="/static/icon-192.png" alt={s.site_name} width="72" height="72" class="mx-auto mb-4 rounded-2xl" />
          <h1>{aboutTitle(s)}</h1>
        </header>
        <section class="space-y-4 leading-8">
          {blocks.map((b) =>
            b.kind === "p" ? (
              <p>{b.text}</p>
            ) : (
              <ul class="list-disc pr-5 space-y-1">{b.items.map((i) => <li>{i}</li>)}</ul>
            ),
          )}
        </section>
        <section class="card">
          <h2>کادو گرفتن در ۴ قدم</h2>
          <ol class="list-decimal pr-5 space-y-3 text-sm leading-7">
            {STEPS.map(([name, text], i) => (
              <li id={`step-${i + 1}`}><b>{name}:</b> {text}</li>
            ))}
          </ol>
        </section>
        {(s.contact_phone || s.contact_email || s.contact_address || socials.length > 0) && (
          <section class="card">
            <h2>راه‌های ارتباط با ما</h2>
            <div class="grid gap-3 md:grid-cols-2">
              {s.contact_phone && contact(`tel:${s.contact_phone.replace(/[^\d+]/g, "")}`, "fa-solid fa-phone", "تلفن", s.contact_phone)}
              {s.contact_email && contact(`mailto:${s.contact_email}`, "fa-solid fa-envelope", "ایمیل", s.contact_email)}
              {socials.map((l) => contact(l.url, SOCIAL_ICON[l.key][0], SOCIAL_ICON[l.key][1], handle(l.url), true))}
            </div>
            {s.contact_address && (
              <p class="text-sm mt-4"><i class="fa-solid fa-location-dot text-brand ml-2"></i>{s.contact_address}</p>
            )}
          </section>
        )}
        {s.developer_name && (
          <section class="card flex items-center gap-4">
            <span class="w-12 h-12 rounded-2xl bg-brand/15 text-brand flex items-center justify-center text-xl shrink-0"><i class="fa-solid fa-code"></i></span>
            <div class="min-w-0">
              <p class="text-[11px] muted" style="margin:0">طراحی و توسعه</p>
              {dev ? (
                <a href={dev} target="_blank" rel="noopener" class="font-bold">{s.developer_name} <span class="text-xs muted ltr">{handle(dev)}</span></a>
              ) : (
                <b>{s.developer_name}</b>
              )}
            </div>
          </section>
        )}
        <p class="text-sm">سوال دیگری دارید؟ <a href="/faq">سوالات متداول</a> را ببینید.</p>
      </article>
    </Layout>,
  );
});

seo.get("/faq", (c) => {
  const s = c.get("settings");
  const list = faqs(s);
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: list.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  return render(
    c,
    <Layout
      title={`سوالات متداول ${s.site_name}`}
      user={c.get("user")}
      seo={{ index: true, description: `پاسخ سوالات رایج درباره ${s.site_name}: ساخت لیست آرزو، پرداخت کارت به کارت، ارسال کادو، محرمانه بودن آدرس و خرید مستقیم.`, type: "article", jsonLd: [schema] }}
    >
      <h1>سوالات متداول</h1>
      {list.map(([q, a]) => (
        <section class="card">
          <h2 class="!text-base">{q}</h2>
          <p class="text-sm leading-7 muted">{a}</p>
        </section>
      ))}
    </Layout>,
  );
});

// For AI assistants and answer engines (https://llmstxt.org).
seo.get("/llms.txt", async (c) => {
  const s = c.get("settings");
  const origin = siteOrigin(c);
  const { results: shops } = await c.env.DB.prepare("SELECT name, slug, city, description FROM shops WHERE status = 'approved' ORDER BY id LIMIT 100").all<{
    name: string;
    slug: string;
    city: string;
    description: string;
  }>();
  const body = [
    `# ${s.site_name}`,
    "",
    `> ${siteDescription(s)}`,
    "",
    "زبان سایت فارسی است و به همه شهرهای ایران ارسال دارد.",
    "",
    "## صفحه‌های اصلی",
    `- [صفحه اصلی و محصولات](${origin}/)`,
    `- [${s.site_name} چیست و چطور کار می‌کند](${origin}/about)`,
    `- [سوالات متداول](${origin}/faq)`,
    `- [نقشه سایت](${origin}/sitemap.xml)`,
    "",
    "## دسته‌بندی‌ها",
    ...categoryList(s).map((cat) => `- [${cat}](${origin}/c/${encodeURIComponent(cat)})`),
    "",
    "## فروشگاه‌ها",
    ...shops.map((sh) => `- [${sh.name}](${origin}/s/${sh.slug})${sh.city ? ` — ${sh.city}` : ""}${sh.description ? `: ${sh.description.replace(/\s+/g, " ").slice(0, 160)}` : ""}`),
    "",
    "## سوالات متداول",
    ...faqs(s).flatMap(([q, a]) => [`### ${q}`, a, ""]),
  ].join("\n");
  return c.text(body, 200, { "Cache-Control": "public, max-age=3600" });
});

// ---------- privacy policy and data deletion (required by Meta to publish the Instagram app) ----------

function LegalPage(props: { c: C; title: string; children: unknown }) {
  return (
    <Layout title={props.title} user={props.c.get("user")} seo={{ description: summary(`${props.title} — ${props.c.get("settings").site_name}`, 158) }}>
      <article class="space-y-4 text-sm leading-8">
        <h1>{props.title}</h1>
        {props.children as never}
      </article>
    </Layout>
  );
}

const contactLine = (s: Settings) =>
  [s.contact_email && `ایمیل: ${s.contact_email}`, s.contact_phone && `تلفن: ${s.contact_phone}`].filter(Boolean).join(" · ") || "از صفحه «درباره ما»";

seo.get("/privacy", (c) => {
  const s = c.get("settings");
  return render(
    c,
    <LegalPage c={c} title="حریم خصوصی">
      <section class="card">
        <h2>چه اطلاعاتی نگه می‌داریم</h2>
        <ul class="list-disc pr-5">
          <li>شماره موبایل، نام، تاریخ تولد و لیست‌های آرزویی که خودتان در {s.site_name} ثبت می‌کنید.</li>
          <li>اطلاعات سفارش (گیرنده، آدرس ارسال، مبلغ و رسید واریز) برای انجام سفارش.</li>
          <li>
            برای فروشگاه‌هایی که اینستاگرام خود را وصل کرده‌اند: پیام‌های دایرکت و کامنت‌هایی که برای آن فروشگاه فرستاده می‌شود، شناسه و نام کاربری
            فرستنده، تا فروشگاه بتواند پاسخ بدهد و سفارش ثبت کند.
          </li>
        </ul>
      </section>
      <section class="card">
        <h2>استفاده و اشتراک‌گذاری</h2>
        <p>
          این اطلاعات فقط برای انجام سفارش، ارتباط فروشگاه با مشتری و پشتیبانی استفاده می‌شود. اطلاعات هر مشتری فقط برای همان فروشگاهی که با آن در
          ارتباط بوده قابل دیدن است. اطلاعات را نمی‌فروشیم و برای تبلیغات به دیگران نمی‌دهیم. پیام‌های اینستاگرام از طریق API رسمی متا دریافت و ارسال
          می‌شوند.
        </p>
      </section>
      <section class="card">
        <h2>حذف اطلاعات</h2>
        <p>
          هر زمان بخواهید اطلاعاتتان حذف می‌شود؛ راهنما در صفحه <a href="/data-deletion">حذف اطلاعات</a> است. ارتباط: {contactLine(s)}
        </p>
      </section>
    </LegalPage>,
  );
});

seo.get("/data-deletion", (c) => {
  const s = c.get("settings");
  return render(
    c,
    <LegalPage c={c} title="حذف اطلاعات کاربر">
      <section class="card">
        <p>برای حذف اطلاعات خود از {s.site_name} (از جمله پیام‌ها و کامنت‌های اینستاگرامی که برای فروشگاه‌ها فرستاده‌اید):</p>
        <ol class="list-decimal pr-5">
          <li>درخواست حذف را با ذکر نام کاربری اینستاگرام یا شماره موبایل خود بفرستید: {contactLine(s)}</li>
          <li>حداکثر تا ۳۰ روز پیام‌ها، کامنت‌ها، پرونده مشتری و حساب کاربری شما حذف می‌شود و نتیجه را به شما اطلاع می‌دهیم.</li>
          <li>
            اگر اپ را از اینستاگرام (Settings ← Apps and websites) حذف کنید، دریافت پیام‌های تازه هم قطع می‌شود. اطلاعاتی که قانوناً برای سوابق مالی
            سفارش لازم است تا زمان لازم نگه داشته می‌شود.
          </li>
        </ol>
      </section>
    </LegalPage>,
  );
});
