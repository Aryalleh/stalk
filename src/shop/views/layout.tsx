import type { Child } from "hono/jsx";
import { CSS_URL } from "../../assets";
import { useSite } from "../../render";
import { canUseCrm, type User } from "../../session";

// Visual language from the designs in html/: dark ink background, cards #221c26, pink accent,
// sticky blurred header, bottom tab bar with a raised "+" button on phones.

export type NavKey = "home" | "wishes" | "search" | "profile" | "none";

const HEAD_LINKS = (
  <>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" type="text/css" />
  </>
);

/** Small client helpers used by several pages: copy-to-clipboard and native share. */
const HELPERS = `
document.addEventListener('click', function (e) {
  var c = e.target.closest('[data-copy]');
  if (c) { e.preventDefault(); navigator.clipboard && navigator.clipboard.writeText(c.getAttribute('data-copy'));
    var t = c.getAttribute('data-copied'); if (t) { var o = c.innerHTML; c.innerHTML = t; setTimeout(function () { c.innerHTML = o; }, 1500); } }
  var s = e.target.closest('[data-share]');
  if (s) { e.preventDefault(); var url = s.getAttribute('data-share') || location.href, title = document.title;
    if (navigator.share) navigator.share({ title: title, url: url }).catch(function () {});
    else if (navigator.clipboard) { navigator.clipboard.writeText(url); s.classList.add('text-pink'); } }
  var b = e.target.closest('[data-back]');
  if (b) { e.preventDefault(); if (history.length > 1 && document.referrer.indexOf(location.host) > -1) history.back(); else location.href = b.getAttribute('data-back') || '/'; }
});`;

export function Avatar(props: { user: { name: string; avatar_key?: string } | null; size?: string; ring?: boolean }) {
  const size = props.size ?? "w-10 h-10";
  const u = props.user;
  const ring = props.ring ? "border-2 border-pink p-1" : "";
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
      <div class="w-full h-full rounded-full bg-card text-pink font-bold flex items-center justify-center">{initial}</div>
    </div>
  );
}

function BottomNav(props: { active: NavKey; user: User | null }) {
  const item = (key: NavKey, href: string, icon: string, label: string) => (
    <a href={href} class={`flex flex-col items-center gap-1 ${props.active === key ? "text-pink" : "text-muted"}`}>
      <i class={`fa-solid ${icon} text-lg`}></i>
      <span class="text-[10px]">{label}</span>
    </a>
  );
  return (
    <nav class="md:hidden fixed bottom-0 inset-x-0 z-50 bg-ink/90 backdrop-blur-lg border-t border-card px-6 pt-3 safe-bottom flex items-center justify-between">
      {item("home", "/", "fa-store", "فروشگاه")}
      {item("wishes", props.user ? "/me/wishlists" : "/login?next=/me/wishlists", "fa-gift", "آرزوها")}
      <div class="relative -top-6">
        <a
          href={props.user ? "/me/wishlists/new" : "/login?next=/me/wishlists/new"}
          aria-label="لیست آرزوی جدید"
          class="w-14 h-14 bg-pink text-white rounded-full shadow-lg shadow-pink/40 flex items-center justify-center text-xl"
        >
          <i class="fa-solid fa-plus"></i>
        </a>
      </div>
      {item("search", "/search", "fa-magnifying-glass", "جستجو")}
      {item("profile", props.user ? "/me" : "/login?next=/me", "fa-user", "پروفایل")}
    </nav>
  );
}

function DesktopNav(props: { user: User | null }) {
  const u = props.user;
  return (
    <div class="hidden md:flex items-center gap-5 text-sm text-muted">
      <a href="/" class="hover:text-fg">فروشگاه</a>
      <a href="/search" class="hover:text-fg">جستجو</a>
      {u ? (
        <>
          <a href="/me/wishlists" class="hover:text-fg">آرزوهای من</a>
          <a href="/panel" class="hover:text-fg">پنل فروشگاه</a>
          {u.is_admin ? <a href="/admin" class="hover:text-fg">مدیریت</a> : null}
          {canUseCrm(u) ? <a href="/crm" class="hover:text-fg">CRM</a> : null}
          <a href="/me/wishlists/new" class="px-4 py-2 rounded-xl bg-pink text-white font-bold">+ لیست جدید</a>
          <a href="/me" aria-label="پروفایل"><Avatar user={u} size="w-9 h-9" /></a>
        </>
      ) : (
        <a href="/login" class="px-4 py-2 rounded-xl bg-pink text-white font-bold">ورود / ثبت‌نام</a>
      )}
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
}) {
  const site = useSite();
  const nav = props.nav ?? "home";
  const showNav = nav !== "none" && !props.panel;
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={props.panel ? "#ffffff" : "#17131a"} />
        <title>{props.title} · {site.site_name}</title>
        {HEAD_LINKS}
        <link rel="stylesheet" href={CSS_URL} />
      </head>
      <body class={`min-h-screen ${props.panel ? "theme-panel" : ""} ${showNav ? "pb-28 md:pb-10" : "pb-10"}`}>
        {props.header ?? (
          <header class="sticky top-0 z-40 bg-ink/90 backdrop-blur-md border-b border-card">
            <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
              <a href="/" class="text-xl font-bold text-pink">{site.site_name}</a>
              <DesktopNav user={props.user} />
              <a href={props.user ? "/me" : "/login"} class="md:hidden" aria-label="پروفایل">
                {props.user ? <Avatar user={props.user} size="w-9 h-9" /> : <span class="text-sm text-muted">ورود</span>}
              </a>
            </div>
          </header>
        )}
        <main class={`${props.wide ? "max-w-5xl" : "max-w-3xl"} mx-auto ${props.bare ? "" : "ui px-4 py-6"}`}>{props.children}</main>
        {showNav && <BottomNav active={nav} user={props.user} />}
        <script dangerouslySetInnerHTML={{ __html: HELPERS }} />
      </body>
    </html>
  );
}

/** Round icon button used in headers (back, share, settings...). */
export function IconButton(props: { icon: string; label: string; href?: string; attrs?: Record<string, string>; glass?: boolean }) {
  const cls = `w-10 h-10 flex items-center justify-center rounded-full ${props.glass ? "bg-ink/40 backdrop-blur-md text-white" : "bg-card text-muted"}`;
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
