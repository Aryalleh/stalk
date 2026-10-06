import type { Child } from "hono/jsx";
import { CSS_URL } from "../../assets";
import { useSite } from "../../render";
import { brandRgb, socialLinks } from "../../settings";
import { summary } from "../../schema";
import { developerHref } from "../../content";
import { ACCENTS, canUseCrm, type Accent, type User } from "../../session";

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
          href="/search"
          aria-label="جستجو و کاوش محصولات"
          class={`w-14 h-14 bg-brand text-white rounded-full shadow-lg shadow-brand/40 flex items-center justify-center text-xl ${props.active === "search" || props.active === "home" ? "ring-4 ring-brand/25" : ""}`}
        >
          <i class="fa-solid fa-magnifying-glass"></i>
        </a>
      </div>
      {item("wishes", "/me/wishlists", "fa-gift", "آرزوها")}
    </nav>
  );
}

function DesktopNav(props: { user: User | null }) {
  const u = props.user;
  return (
    <div class="hidden md:flex items-center gap-5 text-sm text-muted">
      <a href="/shops" class="hover:text-fg">فروشگاه‌ها</a>
      <a href="/search" class="hover:text-fg">جستجو و کاوش</a>
      {u ? (
        <>
          <a href="/me/wishlists" class="hover:text-fg">آرزوهای من</a>
          <a href="/panel" class="hover:text-fg">پنل فروشگاه</a>
          {u.is_admin ? <a href="/admin" class="hover:text-fg">مدیریت</a> : null}
          {canUseCrm(u) ? <a href="/crm" class="hover:text-fg">CRM</a> : null}
          <a href="/me/wishlists/new" class="px-4 py-2 rounded-xl bg-brand text-white font-bold">+ لیست جدید</a>
          <a href="/me" aria-label="پروفایل"><Avatar user={u} size="w-9 h-9" /></a>
        </>
      ) : (
        <a href="/login" rel="nofollow" class="px-4 py-2 rounded-xl bg-brand text-white font-bold">ورود / ثبت‌نام</a>
      )}
    </div>
  );
}

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

function Footer() {
  const site = useSite();
  const socials = socialLinks(site);
  return (
    <footer class="max-w-5xl mx-auto px-4 pt-10 pb-4 text-center text-xs text-muted space-y-3">
      <nav class="flex flex-wrap justify-center gap-4" aria-label="پیوندهای سایت">
        <a href="/about" class="hover:text-fg">درباره {site.site_name}</a>
        <a href="/faq" class="hover:text-fg">سوالات متداول</a>
        <a href="/search" class="hover:text-fg">جستجوی هدیه</a>
      </nav>
      {(site.contact_phone || site.contact_email || site.contact_address) && (
        <address class="not-italic flex flex-wrap justify-center gap-x-4 gap-y-1">
          {site.contact_phone && <a href={`tel:${site.contact_phone.replace(/[^\d+]/g, "")}`} class="hover:text-fg dt">{site.contact_phone}</a>}
          {site.contact_email && <a href={`mailto:${site.contact_email}`} class="hover:text-fg dt">{site.contact_email}</a>}
          {site.contact_address && <span>{site.contact_address}</span>}
        </address>
      )}
      {site.developer_name && (
        <p class="text-[11px] text-muted/80">
          طراحی و توسعه:{" "}
          {developerHref(site.developer_link) ? (
            <a href={developerHref(site.developer_link)} target="_blank" rel="noopener" class="hover:text-fg">{site.developer_name}</a>
          ) : (
            site.developer_name
          )}
        </p>
      )}
      {socials.length > 0 && (
        <div class="flex justify-center gap-4 text-base">
          {socials.map((l) => (
            <a href={l.url} target="_blank" rel="noopener me" aria-label={SOCIAL_ICON[l.key][1]} class="hover:text-brand">
              <i class={SOCIAL_ICON[l.key][0]}></i>
            </a>
          ))}
        </div>
      )}
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
  /** Fixed side navigation for desktop (panel): the page moves aside for it. */
  sidebar?: Child;
  seo?: Seo;
  /** Use the title as is, without " · site name". */
  fullTitle?: boolean;
}) {
  const site = useSite();
  const nav = props.nav ?? "home";
  const showNav = nav !== "none" && !props.panel;
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
      <body class={`min-h-screen ${props.panel ? "theme-panel" : ""} ${props.sidebar ? "md:pr-64" : ""} ${showNav ? "pb-28 md:pb-10" : "pb-10"}`}>
        <ActingAsBar />
        {props.sidebar}
        {props.header ?? (
          <header class="sticky top-0 z-40 bg-ink/90 backdrop-blur-md border-b border-card">
            <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
              <a href="/" class="text-xl font-bold text-brand">{site.site_name}</a>
              <DesktopNav user={props.user} />
              <a href={props.user ? "/me" : "/login"} rel={props.user ? undefined : "nofollow"} class="md:hidden" aria-label="پروفایل">
                {props.user ? <Avatar user={props.user} size="w-9 h-9" /> : <span class="text-sm text-muted">ورود</span>}
              </a>
            </div>
          </header>
        )}
        <main class={`${props.full ? "max-w-[1400px]" : props.wide ? "max-w-5xl" : "max-w-3xl"} mx-auto ${props.bare ? "" : "ui px-4 py-6"}`}>{props.children}</main>
        {showNav && <Footer />}
        {showNav && <BottomNav active={nav} user={props.user} />}
        <script dangerouslySetInnerHTML={{ __html: HELPERS }} />
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
        {props.end ?? <div class="w-10"></div>}
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
