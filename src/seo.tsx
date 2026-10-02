import { Hono } from "hono";
import type { C, Env } from "./env";
import { organizationLd } from "./schema";
import { STEPS, faqs } from "./content";
import { render, siteOrigin } from "./render";
import { categoryList, siteDescription, type Settings } from "./settings";
import { Layout } from "./shop/views/layout";

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
    url("/faq", { priority: "0.6" }),
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
  return organizationLd({ ...c.get("settings"), origin: siteOrigin(c), path: "/", signedIn: false });
}

seo.get("/about", (c) => {
  const s = c.get("settings");
  const origin = siteOrigin(c);
  const description = `${s.site_name} چیست و چطور کار می‌کند: لیست آرزو بساز، لینکش را بفرست و از فروشگاه‌های ایرانی کادو بگیر؛ پرداخت کارت به کارت مستقیم به فروشگاه و آدرس محرمانه.`;
  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `کادو گرفتن با ${s.site_name}`,
    description,
    step: STEPS.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text, url: `${origin}/about#step-${i + 1}` })),
  };
  const page = { "@context": "https://schema.org", "@type": "AboutPage", name: `درباره ${s.site_name}`, url: `${origin}/about`, about: { "@id": `${origin}/#organization` } };
  return render(
    c,
    <Layout title={`درباره ${s.site_name}`} user={c.get("user")} seo={{ index: true, description, type: "article", jsonLd: [organization(c), page, howTo] }}>
      <article class="space-y-6">
        <h1>{s.site_name} چیست؟</h1>
        <p class="leading-8">
          <b>{s.site_name}</b> یک بازار آنلاین برای کادو گرفتن است. کاربران محصولات دلخواهشان را از فروشگاه‌های ایرانی عضو، به «لیست آرزو»
          اضافه می‌کنند و لینک لیست را برای دوستان و خانواده می‌فرستند؛ هر کس یکی از آرزوها را بخرد، فروشگاه آن را مستقیم برای صاحب لیست
          ارسال می‌کند. پرداخت کارت به کارت و مستقیم به حساب فروشگاه است و آدرس گیرنده به خریدار نشان داده نمی‌شود.
        </p>
        <section class="card">
          <h2>کادو گرفتن در ۴ قدم</h2>
          <ol class="list-decimal pr-5 space-y-3 text-sm leading-7">
            {STEPS.map(([name, text], i) => (
              <li id={`step-${i + 1}`}><b>{name}:</b> {text}</li>
            ))}
          </ol>
        </section>
        <section class="card">
          <h2>چرا {s.site_name}؟</h2>
          <ul class="list-disc pr-5 space-y-2 text-sm leading-7">
            <li>کادوی تکراری خریده نمی‌شود؛ هر آرزو تا تأیید واریز برای یک خریدار رزرو است.</li>
            <li>آدرس گیرنده محرمانه است و فقط فروشگاه، بعد از تأیید پرداخت، آن را می‌بیند.</li>
            <li>پول مستقیم به حساب فروشگاه می‌رود؛ واسطه‌ای بین خریدار و فروشنده نیست.</li>
            <li>ارسال با پیک داخل شهر فروشگاه و با پست به همه شهرهای ایران.</li>
            <li>اطلاع‌رسانی سفارش‌ها در بات بله و تلگرام، و نصب سایت مثل یک اپ روی گوشی.</li>
          </ul>
        </section>
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
