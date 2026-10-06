import type { Child } from "hono/jsx";
import { CSS_URL } from "../../assets";
import { useSite } from "../../render";
import { brandRgb, siteDescription, socialLinks } from "../../settings";
import { footerLinks } from "../../pages";
import { summary } from "../../schema";
import { developerHref } from "../../content";
import { ACCENTS, canUseCrm, publicName, type Accent, type User } from "../../session";

// Visual language from the designs in html/: dark ink background, cards #221c26, pink accent,
// sticky blurred header, bottom tab bar with a raised "+" button on phones.

export type NavKey = "home" | "shops" | "wishes" | "search" | "profile" | "none";

// Icons and the Vazirmatn font are self-hosted (src/fonts.ts); preloading the font avoids a late text swap.
const HEAD_LINKS = <link rel="preload" href="/static/fonts/vazirmatn.woff2" as="font" type="font/woff2" crossorigin="anonymous" />;

/** Small client helpers used by several pages: copy-to-clipboard, native share, back, PWA install. */
const HELPERS = `
if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
// File pickers: show the chosen file name (or how many) next to the button.
window.updateFilePick = function (input) {
  var box = input.closest('.file-pick'); if (!box) return;
  var label = box.querySelector('.file-pick-name'), n = input.files ? input.files.length : 0;
  label.textContent = n === 0 ? label.getAttribute('data-empty') : n === 1 ? input.files[0].name : n.toLocaleString('fa-IR') + ' عکس انتخاب شد';
  box.classList.toggle('has-file', n > 0);
};
document.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('.file-pick input[type=file]')) window.updateFilePick(e.target); });
// Photos are shrunk in the browser before any upload (max 1600px, ~0.8 quality): phone photos drop
// from several MB to a few hundred KB, so forms send quickly even over slow or proxied links.
// A file is replaced only when the smaller version really is smaller; failures keep the original.
(function () {
  var MAX_SIDE = 1600, QUALITY = 0.82;
  function load(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' });
    return new Promise(function (ok, fail) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = fail; i.src = URL.createObjectURL(file); });
  }
  function shrink(file) {
    if (!/^image[/](jpeg|png|webp)$/.test(file.type) || file.size < 250 * 1024) return Promise.resolve(file);
    return load(file).then(function (img) {
      var w = img.width, h = img.height, k = Math.min(1, MAX_SIDE / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var type = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
      return new Promise(function (ok) { c.toBlob(ok, type, QUALITY); }).then(function (blob) {
        if (!blob || blob.size >= file.size || !/^image[/](jpeg|webp|png)$/.test(blob.type)) return file;
        var ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
        return new File([blob], file.name.replace(/[.][^.]+$/, '') + '.' + ext, { type: blob.type });
      });
    }).catch(function () { return file; });
  }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.enctype !== 'multipart/form-data' || form.dataset.shrunk || !window.DataTransfer) return;
    var big = function (f) { return /^image[/](jpeg|png|webp)$/.test(f.type) && f.size >= 250 * 1024; };
    var inputs = Array.prototype.filter.call(form.querySelectorAll('input[type=file]'), function (i) { return i.files && Array.prototype.some.call(i.files, big); });
    if (!inputs.length) return; // nothing to shrink: submit as usual
    e.preventDefault();
    var submitter = e.submitter;
    var buttons = form.querySelectorAll('button[type=submit],button:not([type])');
    buttons.forEach(function (b) { b.disabled = true; });
    Promise.all(inputs.map(function (input) {
      return Promise.all(Array.prototype.map.call(input.files, shrink)).then(function (files) {
        var dt = new DataTransfer(); files.forEach(function (f) { dt.items.add(f); }); input.files = dt.files;
      });
    })).then(function () {
      form.dataset.shrunk = '1';
      buttons.forEach(function (b) { b.disabled = false; });
      if (form.requestSubmit) form.requestSubmit(submitter && submitter.form === form ? submitter : undefined); else form.submit();
    });
  }, true);
})();
var installPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault(); installPrompt = e;
  document.querySelectorAll('[data-install]').forEach(function (b) { b.classList.remove('hidden'); });
});
window.addEventListener('appinstalled', function () { document.querySelectorAll('[data-install]').forEach(function (b) { b.classList.add('hidden'); }); });
document.addEventListener('click', function (e) {
  var c = e.target.closest('[data-copy]');
  if (c) { e.preventDefault(); navigator.clipboard && navigator.clipboard.writeText(c.getAttribute('data-copy'));
    var t = c.getAttribute('data-copied'); if (t) { var o = c.innerHTML; c.innerHTML = t; setTimeout(function () { c.innerHTML = o; }, 1500); } }
  var s = e.target.closest('[data-share]');
  if (s) { e.preventDefault(); var url = s.getAttribute('data-share') || location.href, title = document.title;
    if (navigator.share) navigator.share({ title: title, url: url }).catch(function () {});
    else if (navigator.clipboard) { navigator.clipboard.writeText(url); s.classList.add('text-brand'); } }
  var i = e.target.closest('[data-install]');
  if (i && installPrompt) { e.preventDefault(); installPrompt.prompt(); installPrompt = null; }
  var b = e.target.closest('[data-back]');
  if (b) { e.preventDefault(); if (history.length > 1 && document.referrer.indexOf(location.host) > -1) history.back(); else location.href = b.getAttribute('data-back') || '/'; }
});`;

export function Avatar(props: { user: { name: string; avatar_key?: string } | null; size?: string; ring?: boolean }) {
  const size = props.size ?? "w-10 h-10";
  const u = props.user;
  const ring = props.ring ? "border-2 border-brand p-1" : "";
  if (u?.avatar_key) {
    return (
      <div class={`${size} rounded-full ${ring} shrink-0`}>
        <img src={`/img/${u.avatar_key}`} alt={u.name} class="w-full h-full rounded-full object-cover" />
      </div>
    );
  }
  const initial = (u?.name ?? "").trim().charAt(0) || "؟";
  return (
    <div class={`${size} rounded-full ${ring} shrink-0`}>
      <div class="w-full h-full rounded-full bg-card text-brand font-bold flex items-center justify-center">{initial}</div>
    </div>
  );
}

function BottomNav(props: { active: NavKey; user: User | null }) {
  // Private pages send signed-out visitors to the login page themselves; crawlers needn't follow.
  const item = (key: NavKey, href: string, icon: string, label: string) => (
    <a href={href} rel={props.user || !href.startsWith("/me") ? undefined : "nofollow"} class={`flex flex-col items-center gap-1 ${props.active === key ? "text-brand" : "text-muted"}`}>
      <i class={`fa-solid ${icon} text-lg`}></i>
      <span class="text-[10px]">{label}</span>
    </a>
  );
  return (
    <nav class="md:hidden fixed bottom-0 inset-x-0 z-50 bg-ink/90 backdrop-blur-lg border-t border-card px-10 pt-3 safe-bottom flex items-center justify-between">
      {item("shops", "/shops", "fa-store", "فروشگاه‌ها")}
      <div class="relative -top-6">
        <a
          href="/"
          aria-label="خانه"
          class={`w-14 h-14 bg-brand text-white rounded-full shadow-lg shadow-brand/40 flex items-center justify-center text-xl ${props.active === "search" || props.active === "home" ? "ring-4 ring-brand/25" : ""}`}
        >
          <i class="fa-solid fa-house"></i>
        </a>
      </div>
      {item("wishes", "/me/wishlists", "fa-gift", "آرزوها")}
    </nav>
  );
}

/** The site menu (desktop sidebar and mobile drawer) shows the same profile card and links on every page. */
function SiteMenu(props: { user: User | null; stats?: { wishes: number; gifts: number }; drawer?: boolean }) {
  const site = useSite();
  const u = props.user;
  const path = site.path;
  const item = (href: string, icon: string, label: string, on = path === href) => (
    <a
      href={href}
      aria-current={on ? "page" : undefined}
      rel={!u && href.startsWith("/me") ? "nofollow" : undefined}
      class={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm transition-colors hover:bg-brand/10 hover:text-brand ${on ? "bg-brand/10 text-brand font-black" : "text-muted font-bold"}`}
    >
      <i class={`fa-solid ${icon} w-5 text-center text-base`}></i>
      {label}
    </a>
  );
  const heading = (t: string) => <div class="pt-4 pb-1 px-4"><span class="text-[10px] font-black text-muted/70">{t}</span></div>;
  return (
    <>
      {u ? (
        <div class="px-6 pt-1 pb-5 flex flex-col items-center text-center border-b border-fg/5">
          <a href="/me" class="relative mb-3" aria-label="حساب من">
            <Avatar user={u} size={props.drawer ? "w-20 h-20" : "w-24 h-24"} ring />
            <span class="absolute -bottom-1 -left-1 w-8 h-8 bg-card border border-fg/10 rounded-xl flex items-center justify-center text-brand text-xs shadow-lg">
              <i class="fa-solid fa-pen"></i>
            </span>
          </a>
          <h2 class="text-base font-black text-fg">{publicName(u)}</h2>
          {u.username && <p class="text-xs font-bold text-muted ltr">@{u.username}</p>}
          {props.stats && (
            <div class="mt-4 flex gap-2 w-full">
              <div class="flex-1 bg-ink p-2.5 rounded-2xl">
                <p class="text-[9px] font-black text-muted mb-0.5">آرزوها</p>
                <p class="text-sm font-black text-fg">{props.stats.wishes.toLocaleString("fa-IR")}</p>
              </div>
              <div class="flex-1 bg-ink p-2.5 rounded-2xl">
                <p class="text-[9px] font-black text-muted mb-0.5">دریافتی</p>
                <p class="text-sm font-black text-brand">{props.stats.gifts.toLocaleString("fa-IR")}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div class="px-6 pt-1 pb-5 border-b border-fg/5 text-center">
          <p class="text-xs text-muted mb-3">برای ساخت لیست آرزو و خرید کادو وارد شوید.</p>
          <a href="/login" rel="nofollow" class="block w-full py-3 rounded-2xl bg-brand text-white text-sm font-black shadow-lg shadow-brand/20">ورود / ثبت‌نام</a>
        </div>
      )}
      <nav class="flex-1 p-4 space-y-0.5 overflow-y-auto">
        {item("/", "fa-house", "خانه و کاوش", path === "/" || path.startsWith("/c/"))}
        {item("/shops", "fa-shop", "فروشگاه‌ها", path === "/shops" || path.startsWith("/s/"))}
        {u && (
          <>
            {heading("حساب کاربری")}
            {item("/me", "fa-user-gear", "حساب من")}
            {item("/me/wishlists", "fa-list-check", "لیست آرزوها", path.startsWith("/me/wishlists"))}
            {item("/me/gifts", "fa-gift", "کادوهای من")}
            {item("/me/orders", "fa-bag-shopping", "سفارشات من", path.startsWith("/me/orders"))}
            {u.shop_id ? item("/panel", "fa-store", "فروشگاه من") : null}
            {u.is_admin ? item("/admin", "fa-shield-halved", "مدیریت سایت") : null}
            {canUseCrm(u) ? item("/crm", "fa-address-book", "CRM") : null}
          </>
        )}
        {heading("ارتباطات")}
        {u && item("/me#bot", "fa-robot", "ربات‌ها", false)}
        {item("/faq", "fa-life-ring", "راهنما و پشتیبانی")}
        {item("/about", "fa-circle-info", "درباره ما")}
      </nav>
      {u && (
        <div class="p-4 border-t border-fg/5 space-y-2">
          <a href="/me/wishlists/new" class="w-full flex items-center justify-center gap-2 p-3 rounded-2xl bg-brand text-white text-sm font-black shadow-lg shadow-brand/20">
            <i class="fa-solid fa-plus"></i>لیست آرزوی جدید
          </a>
          <form method="post" action="/logout" class="m-0">
            <button class="w-full flex items-center justify-center gap-2 p-3 text-red-500 font-black text-sm bg-red-500/10 hover:bg-red-500/15 rounded-2xl">
              <i class="fa-solid fa-arrow-right-from-bracket"></i>خروج از حساب
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/** Desktop sidebar + mobile drawer with the site menu (every page outside the shop panel). */
function SiteNav(props: { user: User | null; stats?: { wishes: number; gifts: number } }) {
  const site = useSite();
  return (
    <>
      <aside class="hidden md:flex fixed top-0 right-0 bottom-0 w-64 z-40 bg-card border-l border-fg/5 flex-col" aria-label="منوی سایت">
        <div class="px-6 pt-6 pb-4">
          <a href="/" aria-label={site.site_name} class="inline-flex"><SiteLogo size="lg" /></a>
        </div>
        <SiteMenu user={props.user} stats={props.stats} />
      </aside>
      <div id="site-shade" data-drawer-close class="md:hidden hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"></div>
      <aside
        id="site-drawer"
        class="md:hidden fixed top-0 right-0 bottom-0 z-[70] w-[85%] max-w-[320px] bg-card flex flex-col translate-x-full transition-transform duration-300"
        aria-label="منوی سایت"
      >
        <div class="p-5 flex items-center justify-between">
          <SiteLogo />
          <button type="button" data-drawer-close aria-label="بستن منو" class="w-9 h-9 flex items-center justify-center rounded-xl text-muted">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
        <SiteMenu user={props.user} stats={props.stats} drawer />
      </aside>
    </>
  );
}

/** The site's logo image (uploaded in /admin/settings), or its name in the brand color. */
export function SiteLogo(props: { size?: "sm" | "md" | "lg"; light?: boolean }) {
  const site = useSite();
  const size = props.size ?? "md";
  if (site.logo_key) {
    const h = { sm: "h-7", md: "h-9", lg: "h-11" }[size];
    return <img src={`/img/${site.logo_key}`} alt={site.site_name} class={`${h} w-auto max-w-[160px] object-contain`} />;
  }
  const text = { sm: "text-lg font-bold", md: "text-xl font-black", lg: "text-2xl font-black" }[size];
  return <span class={`${text} ${props.light ? "text-white" : "text-brand"}`}>{site.site_name}</span>;
}

/** Top of a public profile or wishlist: the person's banner photo (darkened for the text) or a soft gradient. */
export function ProfileHero(props: { banner?: string; children?: Child }) {
  if (!props.banner) {
    return <section class="px-6 py-8 text-center bg-gradient-to-b from-card to-ink rounded-b-[32px] mb-6">{props.children}</section>;
  }
  return (
    <section class="relative overflow-hidden px-6 pt-20 md:pt-28 pb-8 text-center rounded-b-[32px] mb-6 on-photo">
      <img src={`/img/${props.banner}`} alt="" class="absolute inset-0 w-full h-full object-cover" />
      <div class="absolute inset-0 bg-gradient-to-b from-black/15 via-black/45 to-black/80"></div>
      <div class="relative">{props.children}</div>
    </section>
  );
}

/** Opens the site menu drawer on phones (hidden on desktop, where the sidebar is always shown). */
export function MenuButton(props: { glass?: boolean; class?: string }) {
  return (
    <button
      type="button"
      data-drawer-open
      aria-label="منو"
      class={`md:hidden w-10 h-10 shrink-0 flex items-center justify-center rounded-full ${props.glass ? "bg-black/35 backdrop-blur-md text-white" : "bg-card text-fg"} ${props.class ?? ""}`}
    >
      <i class="fa-solid fa-bars"></i>
    </button>
  );
}

const DRAWER_SCRIPT = `
(function () {
  var drawer = document.getElementById('site-drawer'), shade = document.getElementById('site-shade');
  if (!drawer) return;
  function setDrawer(open) {
    drawer.classList.toggle('translate-x-full', !open);
    shade.classList.toggle('hidden', !open);
    document.documentElement.classList.toggle('overflow-hidden', open);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-drawer-open]')) { e.preventDefault(); setDrawer(true); }
    else if (e.target.closest('[data-drawer-close]')) { e.preventDefault(); setDrawer(false); }
    else if (e.target.closest('#site-drawer a')) setDrawer(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setDrawer(false); });
})();
`;

/** Per-page search engine / AI answer / link preview data. Pages are noindex unless `index` is set. */
export interface Seo {
  description?: string;
  /** Path or absolute URL of the preview image. */
  image?: string;
  /** Canonical path (default: the current path without query). */
  canonical?: string;
  type?: "website" | "product" | "profile" | "article";
  /** schema.org objects, emitted as JSON-LD. */
  jsonLd?: object[];
  index?: boolean;
  /** City for geo meta tags (shops). */
  place?: string;
  /** Extra <meta property=…> pairs (e.g. product price). */
  props?: [string, string][];
}

const abs = (origin: string, url: string) => (/^https?:\/\//.test(url) ? url : origin + url);
/** JSON for a <script> tag: escape "<" so text can never close the tag. */
export const jsonLd = (o: object) => JSON.stringify(o).replace(/</g, "\\u003c");

function SeoTags(props: { title: string; seo: Seo }) {
  const site = useSite();
  const seo = props.seo;
  const url = abs(site.origin, seo.canonical ?? site.path);
  const image = abs(site.origin, seo.image || "/static/icon-512.png");
  const description = summary(seo.description ?? "", 158);
  return (
    <>
      {description && <meta name="description" content={description} />}
      <meta name="robots" content={seo.index ? "index, follow, max-image-preview:large" : "noindex, follow"} />
      {seo.index && <link rel="canonical" href={url} />}
      <link rel="alternate" hreflang="fa-IR" href={url} />
      <meta property="og:site_name" content={site.site_name} />
      <meta property="og:locale" content="fa_IR" />
      <meta property="og:type" content={seo.type ?? "website"} />
      <meta property="og:title" content={props.title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta name="twitter:card" content={seo.image ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={props.title} />
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={image} />
      <meta name="geo.region" content="IR" />
      {seo.place && <meta name="geo.placename" content={seo.place} />}
      {(seo.props ?? []).map(([k, v]) => <meta property={k} content={v} />)}
      {(seo.jsonLd ?? []).map((o) => <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(o) }} />)}
    </>
  );
}

export const SOCIAL_ICON: Record<string, [string, string]> = {
  social_instagram: ["fa-brands fa-instagram", "اینستاگرام"],
  social_telegram: ["fa-brands fa-telegram", "تلگرام"],
  social_bale: ["fa-solid fa-comment-dots", "بله"],
  social_x: ["fa-brands fa-x-twitter", "ایکس"],
  social_linkedin: ["fa-brands fa-linkedin", "لینکدین"],
  social_youtube: ["fa-brands fa-youtube", "یوتیوب"],
  social_aparat: ["fa-solid fa-film", "آپارات"],
};

/** Site footer (UX Pilot design): brand and socials, contact card, link columns (built-in links plus
 *  the admin's pages), app install, copyright and the trust-badge code from /admin/pages. */
function Footer() {
  const site = useSite();
  const socials = socialLinks(site);
  const pages = footerLinks(site);
  const year = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric" }).format(new Date());
  const column = (title: string, links: [string, string][]) =>
    links.length > 0 && (
      <div class="space-y-4">
        <h3 class="text-xs font-black text-brand">{title}</h3>
        <ul class="space-y-3">
          {links.map(([href, label]) => (
            <li><a href={href} class="text-sm font-bold text-white/55 hover:text-white transition-colors">{label}</a></li>
          ))}
        </ul>
      </div>
    );
  const bots = [
    site.bale_bot_username && { href: `https://ble.ir/${site.bale_bot_username}`, icon: "fa-solid fa-comment-dots", label: "ربات بله" },
    site.telegram_bot_username && { href: `https://t.me/${site.telegram_bot_username}`, icon: "fa-brands fa-telegram", label: "ربات تلگرام" },
  ].filter(Boolean) as { href: string; icon: string; label: string }[];
  const contact = site.contact_phone || site.contact_email || site.contact_address;
  return (
    <footer class="site-footer relative overflow-hidden bg-slate-950 text-white mt-12 pt-14 pb-28 md:pb-10 md:rounded-t-[40px]">
      <div class="pointer-events-none absolute -top-32 -right-24 w-96 h-96 rounded-full bg-brand/15 blur-[110px]"></div>
      <div class="relative max-w-6xl mx-auto px-6 md:px-10">
        <div class="grid gap-10 lg:grid-cols-12 pb-12 border-b border-white/10">
          <div class="lg:col-span-5 space-y-6">
            <a href="/" aria-label={site.site_name} class="inline-flex"><SiteLogo size="lg" light /></a>
            <p class="text-sm font-medium text-white/55 leading-8 max-w-sm">{site.footer_about || siteDescription(site)}</p>
            {socials.length > 0 && (
              <div class="flex flex-wrap gap-3">
                {socials.map((l) => (
                  <a href={l.url} target="_blank" rel="noopener me" aria-label={SOCIAL_ICON[l.key][1]} class="w-11 h-11 rounded-2xl bg-white/5 flex items-center justify-center text-lg text-white/80 hover:bg-brand hover:text-white hover:-translate-y-0.5 transition-all">
                    <i class={SOCIAL_ICON[l.key][0]}></i>
                  </a>
                ))}
              </div>
            )}
          </div>
          <div class="lg:col-span-7">
            <div class="bg-white/5 border border-white/10 rounded-[32px] p-6 md:p-8 space-y-5">
              <div>
                <h3 class="text-lg font-black mb-1">لیست آرزویت را بساز، کادو بگیر 🎁</h3>
                <p class="text-xs font-bold text-white/45">محصول دلخواهت را از فروشگاه‌ها به لیست اضافه کن و لینکش را برای دوستانت بفرست.</p>
              </div>
              <div class="flex flex-col sm:flex-row gap-3">
                <a href="/me/wishlists/new" rel="nofollow" class="flex-1 text-center px-6 py-3.5 bg-brand text-white rounded-2xl font-black text-sm shadow-xl shadow-brand/20 hover:brightness-110">
                  <i class="fa-solid fa-plus ml-1"></i>ساخت لیست آرزو
                </a>
                <a href="/shops" class="flex-1 text-center px-6 py-3.5 bg-white/10 text-white rounded-2xl font-black text-sm hover:bg-white/15">
                  <i class="fa-solid fa-store ml-1"></i>دیدن فروشگاه‌ها
                </a>
              </div>
              {contact && (
                <address class="not-italic flex flex-wrap gap-x-5 gap-y-2 pt-4 border-t border-white/10 text-xs font-bold text-white/55">
                  {site.contact_phone && <a href={`tel:${site.contact_phone.replace(/[^\d+]/g, "")}`} class="hover:text-white dt"><i class="fa-solid fa-phone ml-1.5 text-brand"></i>{site.contact_phone}</a>}
                  {site.contact_email && <a href={`mailto:${site.contact_email}`} class="hover:text-white dt"><i class="fa-solid fa-envelope ml-1.5 text-brand"></i>{site.contact_email}</a>}
                  {site.contact_address && <span><i class="fa-solid fa-location-dot ml-1.5 text-brand"></i>{site.contact_address}</span>}
                </address>
              )}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-10 py-12">
          {column("کاوش و خرید", [["/", "خانه و کاوش"], ["/shops", "فروشگاه‌ها"], ["/me/wishlists", "لیست آرزوها"], ["/me/gifts", "کادوهای من"], ...pages.explore])}
          {column("راهنما و پشتیبانی", [["/faq", "سوالات متداول"], ["/me/orders", "پیگیری سفارش"], ...pages.help, ["/about#contact", "تماس با ما"]])}
          {column(site.site_name, [["/about", "درباره ما"], ...pages.company])}
          <div class="space-y-4">
            <h3 class="text-xs font-black text-brand">اپلیکیشن و ربات‌ها</h3>
            <div class="space-y-3">
              <button type="button" data-install class="hidden w-full flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 text-right">
                <i class="fa-solid fa-mobile-screen-button text-2xl text-white/60"></i>
                <span><span class="block text-[10px] font-bold text-white/40">نصب روی گوشی</span><span class="block text-sm font-black">اپ {site.site_name}</span></span>
              </button>
              {bots.map((b) => (
                <a href={b.href} target="_blank" rel="noopener" class="flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10">
                  <i class={`${b.icon} text-2xl text-white/60`}></i>
                  <span><span class="block text-[10px] font-bold text-white/40">اعلان سفارش‌ها در</span><span class="block text-sm font-black">{b.label}</span></span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div class="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div class="flex flex-col md:flex-row items-center gap-4 text-center">
            <p class="text-xs font-bold text-white/35">{site.footer_copyright || `© ${year} ${site.site_name} — تمامی حقوق محفوظ است`}</p>
            {site.developer_name && (
              <p class="text-[11px] text-white/30">
                طراحی و توسعه:{" "}
                {developerHref(site.developer_link) ? <a href={developerHref(site.developer_link)} target="_blank" rel="noopener" class="hover:text-white">{site.developer_name}</a> : site.developer_name}
              </p>
            )}
          </div>
          {site.footer_embed && <div class="footer-embed flex flex-wrap items-center justify-center gap-3" dangerouslySetInnerHTML={{ __html: site.footer_embed }} />}
        </div>
      </div>
    </footer>
  );
}

/** Optional analytics from /admin/settings: GA4 and/or Cloudflare Web Analytics, both loaded async. */
function Analytics() {
  const site = useSite();
  const ga = /^G-[A-Z0-9]{4,20}$/.test(site.ga_measurement_id) ? site.ga_measurement_id : "";
  const cf = /^[a-f0-9]{32}$/.test(site.cf_analytics_token) ? site.cf_analytics_token : "";
  return (
    <>
      {ga && (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga}`}></script>
          <script dangerouslySetInnerHTML={{ __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');` }} />
        </>
      )}
      {cf && <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={JSON.stringify({ token: cf })}></script>}
    </>
  );
}

/** Shown on every page while a platform admin is signed in as this user. */
export function ActingAsBar() {
  const acting = useSite().actingAs;
  if (!acting) return null;
  return (
    <div class="sticky top-0 z-[60] bg-amber-400 text-amber-950 text-sm" role="status">
      <div class="max-w-5xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <span>
          <i class="fa-solid fa-user-secret ml-1"></i>
          شما ({acting.admin}) با حساب <b>{acting.user}</b> وارد شده‌اید. هر کاری انجام دهید به نام این کاربر ثبت می‌شود.
        </span>
        <form method="post" action="/logout/return" class="m-0">
          <button class="!bg-amber-950 !text-amber-50 !px-3 !py-1 !rounded-lg !text-xs font-bold">بازگشت به حساب مدیر</button>
        </form>
      </div>
    </div>
  );
}

/**
 * Page shell.
 * - `nav`: which bottom tab is active ("none" hides the tab bar, for focused flows like checkout).
 * - `header`: a custom header; by default the brand bar with the desktop links.
 * - `bare`: designed pages lay out their own content; otherwise the content gets the shared `.ui` look.
 * - `panel`: light shop-panel theme.
 */
export function Layout(props: {
  title: string;
  user: User | null;
  children?: Child;
  nav?: NavKey;
  header?: Child;
  bare?: boolean;
  panel?: boolean;
  wide?: boolean;
  /** Use the whole width (panel inbox). */
  full?: boolean;
  /** Fixed side navigation for desktop (panel): the page moves aside for it. Other pages get the site menu. */
  sidebar?: Child;
  /** Wishlist / gift counts shown in the site menu's profile card. */
  stats?: { wishes: number; gifts: number };
  seo?: Seo;
  /** Use the title as is, without " · site name". */
  fullTitle?: boolean;
}) {
  const site = useSite();
  const nav = props.nav ?? "home";
  const showNav = nav !== "none" && !props.panel;
  const siteNav = !props.panel && !props.sidebar;
  const title = props.fullTitle ? props.title : `${props.title} · ${site.site_name}`;
  // The signed-in person's own look wins over the site's brand color.
  const light = props.user?.theme !== "dark" && !props.panel; // light unless the person chose dark
  const accent = ACCENTS[props.user?.accent as Accent] ?? brandRgb(site);
  return (
    <html lang="fa" dir="rtl" class={light ? "theme-light" : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={props.panel || light ? "#ffffff" : "#0d1320"} />
        <title>{title}</title>
        <SeoTags title={title} seo={props.seo ?? {}} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/static/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={site.site_name} />
        {HEAD_LINKS}
        <link rel="stylesheet" href={CSS_URL} />
        {accent && accent !== "255 92 147" && <style dangerouslySetInnerHTML={{ __html: `:root{--c-brand:${accent}}` }} />}
        {!props.panel && <Analytics />}
      </head>
      <body class={`min-h-screen ${props.panel ? "theme-panel" : ""} ${props.sidebar || siteNav ? "md:pr-64" : ""} ${showNav ? "" : "pb-10"}`}>
        <ActingAsBar />
        {props.sidebar}
        {siteNav && <SiteNav user={props.user} stats={props.stats} />}
        {props.header ?? (
          <header class="md:hidden sticky top-0 z-40 bg-ink/90 backdrop-blur-md border-b border-card">
            <div class="px-4 py-3 flex items-center justify-between gap-3">
              <MenuButton />
              <a href="/" aria-label={site.site_name} class="inline-flex"><SiteLogo /></a>
              <a href={props.user ? "/me" : "/login"} rel={props.user ? undefined : "nofollow"} aria-label="پروفایل">
                {props.user ? <Avatar user={props.user} size="w-9 h-9" /> : <span class="text-sm text-muted">ورود</span>}
              </a>
            </div>
          </header>
        )}
        <main class={`${props.full ? "max-w-[1400px]" : props.wide ? "max-w-5xl" : "max-w-3xl"} mx-auto ${props.bare ? "" : "ui px-4 py-6"}`}>{props.children}</main>
        {showNav ? <Footer /> : !props.panel && <div class="hidden md:block"><Footer /></div>}
        {showNav && <BottomNav active={nav} user={props.user} />}
        <script dangerouslySetInnerHTML={{ __html: HELPERS }} />
        {siteNav && <script dangerouslySetInnerHTML={{ __html: DRAWER_SCRIPT }} />}
      </body>
    </html>
  );
}

/**
 * File chooser in the site's style (replaces the browser's "Choose file / No file chosen" box):
 * a button plus the chosen file name(s). The real input stays in the form, visually hidden.
 */
export function FilePicker(props: {
  name: string;
  label?: string;
  icon?: string;
  accept?: string;
  multiple?: boolean;
  id?: string;
  required?: boolean;
  attrs?: Record<string, string>;
}) {
  return (
    <label class="file-pick">
      <input
        type="file"
        name={props.name}
        id={props.id}
        accept={props.accept ?? "image/jpeg,image/png,image/webp"}
        multiple={props.multiple}
        required={props.required}
        class="sr-only"
        {...(props.attrs ?? {})}
      />
      <span class="file-pick-btn"><i class={`fa-solid ${props.icon ?? "fa-image"}`}></i> {props.label ?? "انتخاب عکس"}</span>
      <span class="file-pick-name" data-empty={props.multiple ? "هنوز عکسی انتخاب نشده" : "فایلی انتخاب نشده"}>
        {props.multiple ? "هنوز عکسی انتخاب نشده" : "فایلی انتخاب نشده"}
      </span>
    </label>
  );
}

/** Round icon button used in headers (back, share, settings...). */
export function IconButton(props: { icon: string; label: string; href?: string; attrs?: Record<string, string>; glass?: boolean }) {
  const cls = `w-10 h-10 flex items-center justify-center rounded-full ${props.glass ? "bg-black/35 backdrop-blur-md text-white" : "bg-card text-muted"}`;
  return (
    <a href={props.href ?? "#"} aria-label={props.label} class={cls} {...(props.attrs ?? {})}>
      <i class={`fa-solid ${props.icon}`}></i>
    </a>
  );
}

/** Title bar with a back button, used by focused screens (checkout, order, bot...). */
export function TitleBar(props: { title: string; back?: string; end?: Child }) {
  return (
    <header class="sticky top-0 z-40 bg-ink/90 backdrop-blur-md">
      <div class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
        <IconButton icon="fa-chevron-right" label="بازگشت" attrs={{ "data-back": props.back ?? "/" }} />
        <h1 class="text-lg font-bold text-fg">{props.title}</h1>
        <div class="flex items-center gap-2">
          {props.end}
          <MenuButton />
          {!props.end && <div class="hidden md:block w-10"></div>}
        </div>
      </div>
    </header>
  );
}

export function Errors(props: { errors?: (string | undefined)[] }) {
  const list = (props.errors ?? []).filter(Boolean);
  if (!list.length) return null;
  return <div class="errbox rounded-xl px-4 py-3 mb-4 text-sm bg-red-500/10 text-red-300">{list.map((e) => <div>{e}</div>)}</div>;
}

export function Thumb(props: { imageKey: string; alt: string }) {
  return <div class="thumb">{props.imageKey ? <img src={`/img/${props.imageKey}`} alt={props.alt} loading="lazy" /> : "🎁"}</div>;
}
