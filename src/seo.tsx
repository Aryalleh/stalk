import { Hono } from "hono";
import type { C, Env } from "./env";
import { organizationLd, summary } from "./schema";
import { aboutBlocks, aboutSteps, aboutTitle, defaultAboutBody, developerHref, faqs } from "./content";
import { render, siteOrigin } from "./render";
import { categoryList, siteDescription, socialLinks, type Settings } from "./settings";
import { Layout, SOCIAL_ICON, SiteLogo } from "./shop/views/layout";
import { PageText, SLUG_RE, allPages, getPage } from "./pages";

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
      `SELECT p.id, p.code, p.title, p.image_key, p.updated_at FROM products p JOIN shops s ON s.id = p.shop_id
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
    ...(await allPages(db, c.get("settings"))).map((p) => url(`/${p.slug}`, { priority: "0.3" })),
    ...categoryList(c.get("settings")).map((cat) => url(`/c/${encodeURIComponent(cat)}`, { priority: "0.7" })),
    ...(shops.results as { slug: string; logo_key: string; created_at: string }[]).map((s) =>
      url(`/s/${s.slug}`, { priority: "0.8", lastmod: s.created_at, image: s.logo_key }),
    ),
    ...(products.results as { id: number; code: string; title: string; image_key: string; updated_at: string }[]).map((p) =>
      url(`/p/${p.code || p.id}`, { priority: "0.9", lastmod: p.updated_at, image: p.image_key, imageTitle: p.title }),
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
  const steps = aboutSteps(s);
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const firstText = blocks.find((b) => b.kind === "p");
  const description = summary(firstText && firstText.kind === "p" ? firstText.text : siteDescription(s), 158);
  const dev = developerHref(s.developer_link);
  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `کادو گرفتن با ${s.site_name}`,
    description,
    step: steps.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text, url: `${origin}/about#step-${i + 1}` })),
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
    <Layout title={aboutTitle(s)} user={c.get("user")} bare wide seo={{ index: true, description, type: "article", jsonLd: [organization(c), page, ...(steps.length ? [howTo] : [])] }}>
      <article class="px-4 md:px-10 py-8 md:py-12 max-w-3xl space-y-6">
        <header class="text-center md:text-right space-y-4">
          <div class="flex justify-center md:justify-start">
            {s.logo_key ? <SiteLogo size="lg" /> : <img src="/static/icon-192.png" alt={s.site_name} width="72" height="72" class="rounded-2xl" />}
          </div>
          <h1 class="text-2xl md:text-4xl font-black text-fg">{aboutTitle(s)}</h1>
        </header>
        <div class="bg-card rounded-[28px] border border-fg/5 p-5 md:p-8">
          <PageText text={s.about_body || defaultAboutBody(s)} />
        </div>
        {steps.length > 0 && (
          <section class="bg-card rounded-[28px] border border-fg/5 p-5 md:p-8">
            <h2 class="text-lg font-black text-fg mb-5">کادو گرفتن در {fa(steps.length)} قدم</h2>
            <ol class="grid gap-4 md:grid-cols-2">
              {steps.map(([name, text], i) => (
                <li id={`step-${i + 1}`} class="flex gap-3 p-4 rounded-2xl bg-ink">
                  <span class="w-9 h-9 rounded-xl bg-brand text-white font-black flex items-center justify-center shrink-0">{fa(i + 1)}</span>
                  <span class="text-sm leading-7"><b class="block text-fg">{name}</b><span class="text-muted">{text}</span></span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {(s.contact_phone || s.contact_email || s.contact_address || socials.length > 0) && (
          <section class="bg-card rounded-[28px] border border-fg/5 p-5 md:p-8 scroll-mt-24" id="contact">
            <h2 class="text-lg font-black text-fg mb-4">راه‌های ارتباط با ما</h2>
            <div class="grid gap-3 md:grid-cols-2">
              {s.contact_phone && contact(`tel:${s.contact_phone.replace(/[^\d+]/g, "")}`, "fa-solid fa-phone", "تلفن", s.contact_phone)}
              {s.contact_email && contact(`mailto:${s.contact_email}`, "fa-solid fa-envelope", "ایمیل", s.contact_email)}
              {socials.map((l) => contact(l.url, SOCIAL_ICON[l.key][0], SOCIAL_ICON[l.key][1], handle(l.url), true))}
            </div>
            {s.contact_address && (
              <p class="text-sm text-fg mt-4"><i class="fa-solid fa-location-dot text-brand ml-2"></i>{s.contact_address}</p>
            )}
          </section>
        )}
        {s.developer_name && (
          <section class="bg-card rounded-[28px] border border-fg/5 p-5 flex items-center gap-4">
            <span class="w-12 h-12 rounded-2xl bg-brand/15 text-brand flex items-center justify-center text-xl shrink-0"><i class="fa-solid fa-code"></i></span>
            <div class="min-w-0">
              <p class="text-[11px] text-muted">طراحی و توسعه</p>
              {dev ? (
                <a href={dev} target="_blank" rel="noopener" class="font-bold text-fg hover:text-brand">{s.developer_name} <span class="text-xs text-muted ltr">{handle(dev)}</span></a>
              ) : (
                <b class="text-fg">{s.developer_name}</b>
              )}
            </div>
          </section>
        )}
        <p class="text-sm text-muted">سوال دیگری دارید؟ <a href="/faq" class="text-brand font-bold">سوالات متداول</a> را ببینید.</p>
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

// ---------- pages: privacy, data deletion (required by Meta for the Instagram app), terms, shipping and
// any page the admin adds; each address is /<slug> (registered last, after every other route) ----------

export async function pageRoute(c: C) {
  const slug = c.req.param("slug") ?? "";
  const s = c.get("settings");
  const page = SLUG_RE.test(slug) ? await getPage(c.env.DB, s, slug) : null;
  if (!page) return c.notFound();
  return render(
    c,
    <Layout title={page.title} user={c.get("user")} bare wide seo={{ index: true, canonical: `/${page.slug}`, description: summary(page.body.replace(/[#*\[\]()-]/g, " ") || page.title, 158) }}>
      <article class="px-4 md:px-10 py-8 md:py-12 max-w-3xl">
        <nav class="text-xs text-muted mb-4" aria-label="مسیر">
          <a href="/" class="hover:text-brand">{s.site_name}</a> <span class="mx-1">/</span> <span>{page.title}</span>
        </nav>
        <h1 class="text-2xl md:text-4xl font-black text-fg mb-6">{page.title}</h1>
        <div class="bg-card rounded-[28px] border border-fg/5 p-5 md:p-8">
          <PageText text={page.body} />
        </div>
      </article>
    </Layout>,
  );
}
