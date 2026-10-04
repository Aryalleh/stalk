import type { Child } from "hono/jsx";
import { CSS_URL } from "../../assets";
import type { User } from "../../session";

// Super-admin CRM shell (UX Pilot "Super Admin CRM" designs): sky palette, side navigation on
// desktop, a header with the page title, subtitle and actions, a tab row on phones.

export type CrmTab = "dashboard" | "clients" | "history" | "fields" | "team";

const NAV: [CrmTab, string, string, string, boolean][] = [
  ["dashboard", "/admin", "fa-chart-pie", "داشبورد آماری", true],
  ["clients", "/crm", "fa-users", "مدیریت مشتریان", false],
  ["history", "/crm/history", "fa-clock-rotate-left", "لاگ‌های سیستم", false],
  ["fields", "/crm/fields", "fa-list", "فیلدهای منعطف", false],
  ["team", "/crm/users", "fa-shield-halved", "تیم عملیات", true],
];

export function Layout(props: {
  title: string;
  user?: User | null;
  on?: CrmTab;
  sub?: Child;
  actions?: Child;
  wide?: boolean;
  children?: Child;
}) {
  const u = props.user;
  const items = NAV.filter(([, , , , admin]) => !admin || u?.is_admin);
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title} · CRM</title>
        <link rel="preload" href="/static/fonts/vazirmatn.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="stylesheet" href={CSS_URL} />
      </head>
      <body class={`min-h-screen theme-panel ${u ? "md:pr-64" : ""}`}>
        {u && (
          <aside class="hidden md:flex fixed top-0 right-0 bottom-0 w-64 z-40 flex-col bg-white border-l border-sky-100" aria-label="بخش‌های CRM">
            <div class="h-20 flex items-center gap-3 px-6 border-b border-sky-100 shrink-0">
              <span class="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-lg shadow-sky-500/20"><i class="fa-solid fa-address-book"></i></span>
              <a href="/crm" class="text-xl font-black text-sky-900">CRM مشتریان</a>
            </div>
            <nav class="flex-1 overflow-y-auto px-4 py-5 space-y-1.5">
              {items.map(([key, href, icon, label]) => (
                <a
                  href={href}
                  class={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold ${
                    props.on === key ? "bg-sky-500 !text-white shadow-lg shadow-sky-500/25" : "!text-sky-900/60 hover:bg-sky-50 hover:!text-sky-600"
                  }`}
                >
                  <i class={`fa-solid ${icon} w-5 text-center`}></i>
                  {label}
                </a>
              ))}
            </nav>
            <div class="p-4 border-t border-sky-100">
              <div class="flex items-center gap-3 p-3 rounded-2xl bg-sky-50/70 border border-sky-100">
                <span class="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 font-black flex items-center justify-center">{(u.name.trim()[0] ?? "؟").toUpperCase()}</span>
                <div class="flex-1 min-w-0">
                  <b class="text-xs text-sky-900 block truncate">{u.name}</b>
                  <span class="text-[10px] text-slate-500">{u.is_admin ? "مدیر پلتفرم" : "کارشناس CRM"}</span>
                </div>
                <a href="/" title="سایت" aria-label="سایت" class="!text-slate-400 hover:!text-sky-500"><i class="fa-solid fa-house"></i></a>
                <form method="post" action="/logout" class="m-0">
                  <button title="خروج" aria-label="خروج" class="!bg-transparent !text-slate-400 hover:!text-red-500 !p-0 !border-0"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
                </form>
              </div>
            </div>
          </aside>
        )}
        {u && (
          <header class="ui bg-white border-b border-sky-100 sticky top-0 z-30">
            <div class="px-4 md:px-8 min-h-20 py-3 flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <h1 class="text-lg md:text-xl font-black text-sky-900 leading-tight">{props.title}</h1>
                {props.sub && <div class="text-[11px] font-bold text-slate-400 mt-1">{props.sub}</div>}
              </div>
              {props.actions && <div class="flex flex-wrap items-center gap-2">{props.actions}</div>}
            </div>
            <nav class="md:hidden flex gap-1 px-3 overflow-x-auto no-scrollbar" aria-label="بخش‌های CRM">
              {items.map(([key, href, icon, label]) => (
                <a href={href} class={`whitespace-nowrap px-3 py-2.5 text-xs font-bold border-b-2 ${props.on === key ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500"}`}>
                  <i class={`fa-solid ${icon} ml-1`}></i>{label}
                </a>
              ))}
            </nav>
          </header>
        )}
        <main class={`ui ${props.wide ? "max-w-[1500px]" : "max-w-[1200px]"} mx-auto px-4 md:px-8 py-6`}>{props.children}</main>
      </body>
    </html>
  );
}

export function Errors(props: { errors?: string[] }) {
  if (!props.errors?.length) return null;
  return (
    <div class="errbox">
      {props.errors.map((e) => (
        <div>{e}</div>
      ))}
    </div>
  );
}

export function Stat(props: { icon: string; tone: string; label: string; value: string; note?: string }) {
  return (
    <div class="card !mb-0 flex items-center gap-4">
      <span class={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-xl ${props.tone}`}><i class={`fa-solid ${props.icon}`}></i></span>
      <div class="min-w-0">
        <p class="text-[11px] font-black text-slate-400">{props.label}</p>
        <p class="text-lg font-black text-sky-900">{props.value}</p>
        {props.note && <p class="text-[10px] text-slate-400">{props.note}</p>}
      </div>
    </div>
  );
}
