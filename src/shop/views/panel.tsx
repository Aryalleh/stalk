import { formatJalali } from "../../../lib/jalali";
import { formatCard } from "../../../lib/normalize";
import { birthdayLabel } from "../../../lib/people";
import { mask, type Settings } from "../../settings";
import { CITIES } from "../cities";
import { STATUS_LABEL, toman, type Order, type Product, type ProductImage, type ProductPackage, type Shop } from "../db";
import { DELIVERY_LABEL } from "../notify";
import { CLOTHING_TEMPLATE } from "../sizes";
import { variantKey, variantLabel, variants, type Variant } from "../variants";
import type { User } from "../../session";
import type { Child } from "hono/jsx";
import { Errors, FilePicker, Layout, Thumb } from "./layout";

const SHOP_STATUS: Record<Shop["status"], string> = { pending: "در انتظار تأیید", approved: "فعال", suspended: "معلق" };

/** City picker: suggestions from the list, but any city can be typed. */
function CityInput(props: { value: string; name?: string }) {
  return (
    <>
      <input name={props.name ?? "city"} value={props.value} list="cities" required maxlength={40} placeholder="مثلاً تهران" autocomplete="off" />
      <datalist id="cities">{CITIES.map((c) => <option value={c} />)}</datalist>
    </>
  );
}

export function ShopRegisterPage(props: { user: User; values?: Record<string, string>; errors?: string[] }) {
  const v = props.values ?? {};
  return (
    <Layout title="ثبت فروشگاه" user={props.user}>
      <div class="card" style="max-width:520px;margin:20px auto">
        <h1>ثبت فروشگاه</h1>
        <p class="muted">بعد از تأیید مدیر سایت، محصولات شما در سایت نمایش داده می‌شود.</p>
        <Errors errors={props.errors} />
        <form method="post" action="/panel/register">
          <label>نام فروشگاه</label>
          <input name="name" value={v.name ?? ""} required maxlength={80} />
          <label>آدرس صفحه فروشگاه (حروف انگلیسی، عدد و -)</label>
          <input name="slug" value={v.slug ?? ""} class="ltr" pattern="[a-z0-9-]{3,40}" placeholder="my-shop" required />
          <label>تلفن فروشگاه</label>
          <input name="phone" value={v.phone ?? ""} class="ltr" inputmode="tel" required />
          <label>شهر فروشگاه</label>
          <CityInput value={v.city ?? ""} />
          <label>درباره فروشگاه</label>
          <textarea name="description" maxlength={1000}>{v.description ?? ""}</textarea>
          <p><button>ثبت فروشگاه</button></p>
        </form>
      </div>
    </Layout>
  );
}

export type PanelTab =
  | "dashboard" | "inbox" | "customers" | "leads" | "tasks" | "orders" | "sales" | "products" | "reels" | "automation" | "team" | "settings" | "more";

/** Shop admin (the owner) vs agent: agents don't manage settings, team or automation. */
export const isShopAdmin = (u: User, shop: Shop) => u.shop_role === "admin" || shop.owner_id === u.id;

/** Every section of the shop panel: [tab, href, icon, label, admin only]. */
export const PANEL_SECTIONS: [PanelTab, string, string, string, boolean][] = [
  ["dashboard", "/panel", "fa-chart-pie", "داشبورد", false],
  ["inbox", "/panel/inbox", "fa-comments", "گفتگوها", false],
  ["customers", "/panel/customers", "fa-users", "مشتریان", false],
  ["leads", "/panel/leads", "fa-filter", "سرنخ‌ها", false],
  ["tasks", "/panel/tasks", "fa-list-check", "وظایف", false],
  ["orders", "/panel/orders", "fa-receipt", "سفارش‌های سایت", false],
  ["sales", "/panel/sales", "fa-cash-register", "فروش دایرکت", false],
  ["products", "/panel/products", "fa-box-open", "محصولات", false],
  ["reels", "/panel/reels", "fa-film", "ریلز و کامنت", true],
  ["automation", "/panel/automation", "fa-robot", "اتوماسیون", true],
  ["team", "/panel/team", "fa-user-group", "تیم", true],
  ["settings", "/panel/settings", "fa-gear", "تنظیمات", true],
];

/** Desktop side navigation of the panels (UX Pilot design): brand on top, sections, a card at the bottom. */
function SideNav(props: { brand: Child; items: { href: string; icon: string; label: string; on: boolean; badge?: number; divider?: boolean }[]; footer: Child }) {
  return (
    <aside class="hidden md:flex fixed top-0 right-0 bottom-0 w-64 z-40 flex-col bg-white border-l border-sky-100" aria-label="بخش‌های پنل">
      <div class="h-20 flex items-center px-6 border-b border-sky-100 shrink-0">{props.brand}</div>
      <nav class="flex-1 overflow-y-auto no-scrollbar px-4 py-5 space-y-1.5">
        {props.items.map((i) => (
          <>
            {i.divider && <div class="h-px bg-sky-100 my-3" />}
            <a
              href={i.href}
              class={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition ${
                i.on ? "bg-sky-500 !text-white shadow-lg shadow-sky-500/25" : "!text-sky-900/60 hover:bg-sky-50 hover:!text-sky-600"
              }`}
            >
              <i class={`fa-solid ${i.icon} w-5 text-center`}></i>
              <span class="flex-1">{i.label}</span>
              {(i.badge ?? 0) > 0 && (
                <span class={`min-w-6 h-6 px-1.5 rounded-lg text-[11px] flex items-center justify-center ${i.on ? "bg-white/25 text-white" : "bg-sky-100 text-sky-600"}`}>
                  {(i.badge ?? 0) > 99 ? "99+" : (i.badge ?? 0).toLocaleString("fa-IR")}
                </span>
              )}
            </a>
          </>
        ))}
      </nav>
      <div class="p-4 border-t border-sky-100 shrink-0">{props.footer}</div>
    </aside>
  );
}

/** Shop panel shell: sky theme, side navigation (desktop), shop header and bottom bar (phones). */
export function PanelShell(props: { title: string; user: User; shop: Shop; on: PanelTab; children?: Child; wide?: boolean; full?: boolean; unread?: number }) {
  const s = props.shop;
  const admin = isShopAdmin(props.user, s);
  const sections = PANEL_SECTIONS.filter(([, , , , onlyAdmin]) => admin || !onlyAdmin);
  const tab = (key: PanelTab, href: string, icon: string, label: string, badge = 0) => (
    <a href={href} class={`relative flex flex-col items-center gap-1 ${props.on === key ? "text-sky-500" : "text-slate-400"}`}>
      <i class={`fa-solid ${icon} text-lg`}></i>
      {badge > 0 && <span class="absolute -top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">{badge > 99 ? "99+" : badge.toLocaleString("fa-IR")}</span>}
      <span class="text-[10px] font-bold">{label}</span>
    </a>
  );
  const moreOn = !["dashboard", "inbox", "customers", "orders"].includes(props.on);
  const logo = (size: string) => (
    <div class={`${size} rounded-xl bg-sky-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 overflow-hidden shrink-0`}>
      {s.logo_key ? <img src={`/img/${s.logo_key}`} alt="" class="w-full h-full object-cover" /> : <i class="fa-solid fa-store text-lg"></i>}
    </div>
  );
  const status = (
    <>
      {admin ? "مدیر فروشگاه" : "پشتیبان"} · <span class={s.status === "approved" ? "text-emerald-600" : "text-amber-600"}>{SHOP_STATUS[s.status]}</span>
    </>
  );
  const sidebar = (
    <SideNav
      brand={
        <a href="/panel" class="flex items-center gap-3 text-xl font-black !text-sky-500">
          {logo("w-10 h-10")} پنل فروشگاه
        </a>
      }
      items={sections.map(([key, href, icon, label, onlyAdmin], n) => ({
        href,
        icon,
        label,
        on: props.on === key,
        badge: key === "inbox" ? props.unread : 0,
        divider: !!onlyAdmin && !sections[n - 1]?.[4],
      }))}
      footer={
        <div class="flex items-center gap-3 p-3 rounded-2xl bg-sky-50/60 border border-sky-100">
          {logo("w-10 h-10")}
          <div class="flex-1 min-w-0">
            <b class="text-xs text-sky-900 block truncate">{s.name}</b>
            <span class="text-[10px] text-slate-500">{status}</span>
          </div>
          <a href={`/s/${s.slug}`} title="صفحه عمومی فروشگاه" aria-label="صفحه عمومی فروشگاه" class="!text-slate-400 hover:!text-sky-500"><i class="fa-solid fa-eye"></i></a>
          <a href="/" title="بازگشت به سایت" aria-label="بازگشت به سایت" class="!text-slate-400 hover:!text-sky-500"><i class="fa-solid fa-house"></i></a>
        </div>
      }
    />
  );
  const header = (
    <>
      <header class="md:hidden bg-white border-b border-sky-100 sticky top-0 z-40">
        <div class="px-4 py-3 flex items-center justify-between gap-3">
          <a href="/panel" class="flex items-center gap-3 min-w-0">
            {logo("w-10 h-10")}
            <div class="min-w-0">
              <h1 class="text-sm font-bold text-sky-900 truncate">{s.name}</h1>
              <p class="text-[10px] text-slate-500">{status}</p>
            </div>
          </a>
          <div class="flex gap-2">
            <a href={`/s/${s.slug}`} aria-label="صفحه عمومی فروشگاه" title="صفحه عمومی فروشگاه" class="w-10 h-10 flex items-center justify-center rounded-full bg-sky-50 text-sky-600"><i class="fa-solid fa-eye"></i></a>
            <a href="/" aria-label="بازگشت به سایت" title="بازگشت به سایت" class="w-10 h-10 flex items-center justify-center rounded-full bg-sky-50 text-sky-600"><i class="fa-solid fa-house"></i></a>
          </div>
        </div>
      </header>
      <nav class="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-sky-100 safe-bottom">
        <div class="max-w-md mx-auto px-6 pt-3 flex items-center justify-between">
          {tab("dashboard", "/panel", "fa-chart-pie", "داشبورد")}
          {tab("inbox", "/panel/inbox", "fa-comments", "گفتگوها", props.unread ?? 0)}
          {tab("customers", "/panel/customers", "fa-users", "مشتریان")}
          {tab("orders", "/panel/orders", "fa-receipt", "سفارش‌ها")}
          {tab(moreOn ? props.on : "more", "/panel/more", "fa-bars", "منو")}
        </div>
      </nav>
    </>
  );
  return (
    <Layout title={props.title} user={props.user} panel header={header} sidebar={sidebar} wide full={props.full}>
      <div class="pb-20 md:pb-0">
        {s.status === "pending" && <div class="warnbox">فروشگاه در انتظار تأیید است. می‌توانید محصولات را اضافه کنید؛ بعد از تأیید نمایش داده می‌شوند.</div>}
        {s.status === "suspended" && <div class="errbox">فروشگاه معلق است و محصولاتش نمایش داده نمی‌شود.</div>}
        {!s.card_number && (
          <div class="errbox">تا شماره کارت را در <a href="/panel/settings">تنظیمات</a> وارد نکنید، کسی نمی‌تواند محصولات شما را بخرد.</div>
        )}
        {!s.city && <div class="errbox">شهر فروشگاه و روش‌های ارسال را در <a href="/panel/settings">تنظیمات</a> مشخص کنید.</div>}
        {props.children}
      </div>
    </Layout>
  );
}

export const ORDER_FILTERS: [string, string][] = [
  ["awaiting", "در انتظار تأیید واریز"],
  ["todo", "آماده ارسال"],
  ["shipped", "ارسال‌شده"],
  ["rejected", "ردشده"],
];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-500",
  awaiting: "bg-amber-50 text-amber-600",
  paid: "bg-sky-50 text-sky-600",
  shipped: "bg-emerald-50 text-emerald-600",
  delivered: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-600",
};

const SHORT_STATUS: Record<string, string> = {
  pending: "در انتظار واریز", awaiting: "بررسی رسید", paid: "آماده ارسال", shipped: "ارسال شد", delivered: "تحویل شد", rejected: "رد شد",
};

export type PanelOrder = Order & { image_key: string };

function OrderCard(props: { o: PanelOrder }) {
  const o = props.o;
  return (
    <div class="bg-white p-4 rounded-2xl border border-sky-100 shadow-xs">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-12 h-12 rounded-lg bg-slate-50 overflow-hidden border border-slate-100 shrink-0 flex items-center justify-center">
            {o.image_key ? <img class="w-full h-full object-cover" src={`/img/${o.image_key}`} alt="" loading="lazy" /> : "🎁"}
          </div>
          <div class="min-w-0">
            <h3 class="text-xs font-bold text-sky-900 truncate">{o.product_title}{variantLabel(o.size, o.color) && <span class="text-slate-500"> · {variantLabel(o.size, o.color)}</span>}</h3>
            <p class="text-[10px] text-slate-500">سفارش #{o.id} · <span class="dt">{formatJalali(o.reported_at ?? o.created_at, false)}</span></p>
            <p class="text-[11px] font-bold text-sky-900 mt-0.5">{toman(o.amount)}</p>
          </div>
        </div>
        <span class={`px-2 py-1 text-[10px] font-bold rounded-md whitespace-nowrap ${STATUS_STYLE[o.status] ?? ""}`}>{o.cancel_kind === "out_of_stock" ? "لغو، ناموجود" : o.change_status === "pending" ? "منتظر پاسخ تغییر" : SHORT_STATUS[o.status]}</span>
      </div>
      <div class="flex items-center justify-between pt-3 border-t border-slate-100">
        <div class="text-[11px] text-slate-500">
          خریدار: <span class="text-sky-900 font-medium">{o.giver_name}</span>
          {o.delivery_method && <> · {DELIVERY_LABEL[o.delivery_method]}</>}
        </div>
        <a href={`/panel/orders/${o.id}`} class="text-[11px] font-bold text-sky-600 flex items-center gap-1">
          مشاهده جزئیات <i class="fa-solid fa-arrow-left text-[9px]"></i>
        </a>
      </div>
    </div>
  );
}

function OrderList(props: { orders: PanelOrder[]; empty: string }) {
  if (!props.orders.length) return <div class="card text-center text-sm muted py-10">{props.empty}</div>;
  return <div class="space-y-4">{props.orders.map((o) => <OrderCard o={o} />)}</div>;
}

function Chip(props: { href: string; on: boolean; children: Child }) {
  return (
    <a
      href={props.href}
      class={`px-3 py-1.5 text-[11px] font-bold rounded-lg border whitespace-nowrap ${props.on ? "bg-sky-500 !text-white border-sky-500 shadow-xs shadow-sky-500/30" : "bg-white !text-slate-500 border-sky-100 hover:!text-sky-600"}`}
    >
      {props.children}
    </a>
  );
}

export function DashboardPage(props: {
  user: User;
  shop: Shop;
  stats: { today: number; awaiting: number; toShip: number; sales: number; products: number };
  crm: { newLeads: number; openConversations: number; unread: number; tasksDue: number; directRevenue: number; customers: number };
  lowStock: { id: number; title: string; size: string; color: string; quantity: number; min_stock: number }[];
  birthdays: { id: number; name: string; username: string; birthday: string }[];
  tasks: { id: number; title: string; due_at: string | null; customer_id: number | null; customer_name: string | null }[];
  orders: PanelOrder[];
  onlyAwaiting: boolean;
}) {
  const st = props.stats;
  const crm = props.crm;
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const nowIso = new Date().toISOString();
  const kpi = (href: string, icon: string, label: string, value: string, alert = false) => (
    <a href={href} class="bg-white p-3 rounded-2xl border border-sky-100 shadow-xs flex items-center gap-3 !text-sky-900">
      <span class={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${alert ? "bg-red-50 text-red-600" : "bg-sky-50 text-sky-600"}`}><i class={`fa-solid ${icon}`}></i></span>
      <span class="min-w-0"><span class="text-[11px] text-slate-500 block">{label}</span><b class="text-base">{value}</b></span>
    </a>
  );
  const stat = (label: string, value: string, note?: Child) => (
    <div class="bg-white p-4 rounded-2xl border border-sky-100 shadow-xs">
      <span class="text-[11px] text-slate-500 block mb-1">{label}</span>
      <span class="text-lg font-bold text-sky-900">{value}</span>
      {note}
    </div>
  );
  return (
    <PanelShell title="پنل فروشگاه" user={props.user} shop={props.shop} on="dashboard" unread={crm.unread}>
      <section class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {kpi("/panel/inbox", "fa-comments", "پیام‌های خوانده‌نشده", fa(crm.unread), crm.unread > 0)}
        {kpi("/panel/leads", "fa-user-plus", "سرنخ تازه (۳۰ روز)", fa(crm.newLeads))}
        {kpi("/panel/tasks", "fa-list-check", "وظایف سررسید", fa(crm.tasksDue), crm.tasksDue > 0)}
        {kpi("/panel/inbox?status=open", "fa-inbox", "گفتگوی باز", fa(crm.openConversations))}
        {kpi("/panel/sales", "fa-cash-register", "فروش دایرکت (۳۰ روز)", toman(crm.directRevenue))}
        {kpi("/panel/customers", "fa-users", "مشتریان", fa(crm.customers))}
      </section>
      {(props.tasks.length > 0 || props.lowStock.length > 0 || props.birthdays.length > 0) && (
        <section class="grid md:grid-cols-3 gap-3 mb-6">
          {props.tasks.length > 0 && (
            <div class="card !mb-0">
              <h2><i class="fa-solid fa-list-check ml-1 text-sky-600"></i> وظایف من</h2>
              {props.tasks.map((t) => (
                <a href={t.customer_id ? `/panel/customers/${t.customer_id}` : "/panel/tasks"} class="flex justify-between gap-2 py-1 text-sm !text-sky-900">
                  <span class="truncate">{t.title}{t.customer_name ? ` · ${t.customer_name}` : ""}</span>
                  {t.due_at && <span class={`text-[10px] shrink-0 dt ${t.due_at < nowIso ? "text-red-600 font-bold" : "text-slate-500"}`}>{formatJalali(t.due_at)}</span>}
                </a>
              ))}
            </div>
          )}
          {props.lowStock.length > 0 && (
            <div class="card !mb-0">
              <h2><i class="fa-solid fa-triangle-exclamation ml-1 text-amber-500"></i> موجودی کم</h2>
              {props.lowStock.map((r) => (
                <a href={`/panel/products/${r.id}#stock`} class="flex justify-between gap-2 py-1 text-sm !text-sky-900">
                  <span class="truncate">{r.title}{variantLabel(r.size, r.color) ? ` (${variantLabel(r.size, r.color)})` : ""}</span>
                  <b class={r.quantity === 0 ? "text-red-600" : "text-amber-600"}>{fa(r.quantity)}</b>
                </a>
              ))}
            </div>
          )}
          {props.birthdays.length > 0 && (
            <div class="card !mb-0">
              <h2>🎂 تولدهای پیش رو</h2>
              {props.birthdays.map((b) => (
                <a href={`/panel/customers/${b.id}`} class="flex justify-between gap-2 py-1 text-sm !text-sky-900">
                  <span class="truncate">{b.name || `@${b.username}`}</span>
                  <span class="text-[11px] text-slate-500">{birthdayLabel(b.birthday)}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      )}
      <h2>فروش سایت</h2>
      <section class="grid grid-cols-2 gap-4 mb-8">
        {stat("فروش امروز", toman(st.today))}
        {stat("فیش‌های جدید", st.awaiting.toLocaleString("fa-IR"), st.awaiting ? <span class="text-[10px] text-amber-600 mr-1 font-bold">منتظر تأیید</span> : null)}
        {stat("آماده ارسال", st.toShip.toLocaleString("fa-IR"), st.toShip ? <span class="text-[10px] text-sky-600 mr-1 font-bold">فعال</span> : null)}
        {stat("کل فروش موفق", st.sales.toLocaleString("fa-IR"), <span class="text-[10px] text-slate-500 mr-1">{st.products.toLocaleString("fa-IR")} محصول</span>)}
      </section>
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="!mb-0">آخرین سفارش‌ها</h2>
          <div class="flex gap-2">
            <Chip href="/panel" on={!props.onlyAwaiting}>همه</Chip>
            <Chip href="/panel?only=awaiting" on={props.onlyAwaiting}>تأیید نشده</Chip>
          </div>
        </div>
        <OrderList orders={props.orders} empty={props.onlyAwaiting ? "فیشی منتظر تأیید نیست." : "هنوز سفارشی ثبت نشده."} />
        <p class="text-center mt-4"><a href="/panel/orders" class="text-xs font-bold">همه سفارش‌ها</a></p>
      </section>
      <a href="/panel/products/new" class="mt-6 w-full py-4 bg-sky-900 !text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl shadow-sky-900/10">
        <i class="fa-solid fa-plus text-sm"></i> افزودن محصول جدید
      </a>
    </PanelShell>
  );
}

export function OrdersPage(props: { user: User; shop: Shop; orders: PanelOrder[]; filter: string; counts: Record<string, number> }) {
  return (
    <PanelShell title="سفارش‌ها" user={props.user} shop={props.shop} on="orders">
      <h1>سفارش‌ها</h1>
      <div class="flex gap-2 overflow-x-auto no-scrollbar mb-4">
        {ORDER_FILTERS.map(([f, l]) => (
          <Chip href={`/panel/orders?f=${f}`} on={props.filter === f}>
            {l}{props.counts[f] ? ` (${props.counts[f].toLocaleString("fa-IR")})` : ""}
          </Chip>
        ))}
        <Chip href="/panel/sales" on={false}><i class="fa-solid fa-cash-register ml-1"></i>فروش دایرکت</Chip>
      </div>
      <OrderList orders={props.orders} empty="سفارشی نیست." />
    </PanelShell>
  );
}

/** Out-of-stock tools on an order that isn't shipped yet: cancel (refund) or propose another size/color. */
function StockActions(props: { o: Order; variants: Variant[]; available: Record<string, number> | null }) {
  const o = props.o;
  if (o.status === "rejected" && o.cancel_kind === "out_of_stock") {
    return (
      <div class="card">
        <h2>لغو به‌علت ناموجودی</h2>
        {o.reject_reason && <p class="small">{o.reject_reason}</p>}
        {o.paid_at ? (
          <form method="post" action={`/panel/orders/${o.id}/refund`}>
            <label>بازگشت وجه به خریدار ({toman(o.amount)} به <span class="dt">{o.giver_phone}</span>) — شماره پیگیری یا توضیح</label>
            <input name="refund_note" value={o.refund_note} maxlength={200} placeholder="مثلاً: کارت به کارت، پیگیری ۱۲۳۴۵۶" />
            <p><button class="small">ثبت بازگشت وجه</button></p>
          </form>
        ) : (
          <p class="muted small">واریزی تأیید نشده بود؛ اگر مبلغی دریافت کرده‌اید آن را به خریدار برگردانید.</p>
        )}
      </div>
    );
  }
  if (o.status !== "awaiting" && o.status !== "paid") return null;
  const others = props.variants.filter((v) => v.key !== variantKey(o.size, o.color));
  return (
    <div class="card">
      <h2>🚫 کالا تمام شده؟</h2>
      {o.change_status === "pending" ? (
        <div class="warnbox">
          پیشنهاد شما برای گیرنده فرستاده شده و منتظر پاسخ است: <b>{variantLabel(o.change_size, o.change_color)}</b> {o.change_message}
        </div>
      ) : (
        <>
          {o.change_status === "accepted" && (
            <div class="okbox">گیرنده تغییر را پذیرفت{o.change_reply ? `: ${o.change_reply}` : ""}. سفارش را با {variantLabel(o.size, o.color) || "همین مشخصات"} ارسال کنید.</div>
          )}
          <form method="post" action={`/panel/orders/${o.id}/change`}>
            <p class="small muted" style="margin-top:0">پیشنهاد سایز یا رنگ دیگر به گیرنده (در بات برایش می‌رود و قبول یا رد می‌کند):</p>
            {others.length > 0 && (
              <>
                <label>سایز / رنگ جایگزین</label>
                <select name="variant">
                  <option value="">بدون تغییر (فقط پیام)</option>
                  {others.map((v) => (
                    <option value={v.key} disabled={props.available !== null && !props.available[v.key]}>
                      {v.label}{props.available !== null ? (props.available[v.key] ? ` (${props.available[v.key].toLocaleString("fa-IR")} موجود)` : " (ناموجود)") : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label>پیام (مثلاً رنگ‌های موجود)</label>
            <input name="message" maxlength={300} placeholder="مثلاً: رنگ مشکی تمام شد؛ سرمه‌ای و طوسی موجود است" />
            <p><button class="small secondary">ارسال پیشنهاد تغییر</button></p>
          </form>
        </>
      )}
      <form method="post" action={`/panel/orders/${o.id}/cancel-stock`} onsubmit="return confirm('سفارش لغو و کالا ناموجود شود؟ به خریدار و گیرنده خبر داده می‌شود.')">
        <label>لغو سفارش به‌علت ناموجودی — توضیح برای خریدار</label>
        <input name="reason" maxlength={200} placeholder="مثلاً: این مدل دیگر تولید نمی‌شود" />
        {o.status === "paid" && (
          <>
            <label>بازگشت وجه ({toman(o.amount)} به <span class="dt">{o.giver_phone}</span>) — شماره پیگیری</label>
            <input name="refund_note" maxlength={200} />
          </>
        )}
        <p><button class="small danger">لغو به‌علت ناموجودی</button></p>
      </form>
    </div>
  );
}

export function OrderDetailPage(props: { user: User; shop: Shop; order: Order; variants: Variant[]; available: Record<string, number> | null; saved?: string }) {
  const o = props.order;
  const confirmed = o.status === "paid" || o.status === "shipped" || o.status === "delivered";
  return (
    <PanelShell title={`سفارش #${o.id}`} user={props.user} shop={props.shop} on="orders">
      <p class="mb-3"><a href="/panel/orders" class="text-xs"><i class="fa-solid fa-chevron-right ml-1"></i>سفارش‌ها</a></p>
      {props.saved && <div class="okbox">{props.saved}</div>}
      <div class="two">
        <div class="card">
          <h2>سفارش #{o.id} <span class="tag">{STATUS_LABEL[o.status]}</span></h2>
          <p>
            محصول: <b>{o.product_title}</b>{variantLabel(o.size, o.color) && <> — <b>{variantLabel(o.size, o.color)}</b></>} — {toman(o.item_price)}
            {o.package_name && <><br />بسته‌بندی: <b>{o.package_name}</b> — {toman(o.package_price)}</>}
            {o.delivery_method && <><br />ارسال با <b>{DELIVERY_LABEL[o.delivery_method]}</b> — {toman(o.delivery_fee)}</>}
            <br />جمع کل: <span class="price">{toman(o.amount)}</span>
          </p>
          <h2 style="margin-top:16px">🧾 فیش واریز</h2>
          <p class="small muted">
            به کارت <span class="dt">{formatCard(o.pay_card_number)}</span> · ارسال فیش: <span class="dt">{formatJalali(o.reported_at)}</span>
          </p>
          {o.receipt_key && (
            <a href={`/panel/orders/${o.id}/receipt`} target="_blank">
              <img src={`/panel/orders/${o.id}/receipt`} alt="فیش واریز" style="max-width:100%;max-height:420px;border-radius:10px;border:1px solid var(--line)" />
            </a>
          )}
          <p>خریدار: {o.giver_name} — <span class="dt">{o.giver_phone}</span>{o.is_anonymous ? " (ناشناس: نامش روی کارت هدیه نیاید)" : ""}</p>
          {o.gift_message && <p>پیام کارت هدیه:<br /><span style="white-space:pre-wrap">{o.gift_message}</span></p>}
          {o.status === "awaiting" && (
            <div class="card" style="background:var(--bg)">
              <p style="margin-top:0">حساب خود را بررسی کنید. مبلغ <b>{toman(o.amount)}</b> واریز شده؟ (همین کار را با دکمه‌های زیر فیش در بات هم می‌توانید انجام دهید.)</p>
              <form method="post" action={`/panel/orders/${o.id}/confirm`} style="margin-bottom:10px">
                <button>✓ بله، واریز را تأیید می‌کنم</button>
              </form>
              <form method="post" action={`/panel/orders/${o.id}/reject`} class="row" onsubmit="return confirm('واریز رد شود؟ آرزو دوباره قابل خرید می‌شود.')">
                <input name="reason" placeholder="دلیل (مثلاً: مبلغی واریز نشده)" maxlength={200} style="flex:1;min-width:180px" />
                <button class="secondary">رد واریز</button>
              </form>
            </div>
          )}
          {o.status === "rejected" && !o.cancel_kind && <p class="errbox">رد شد{o.reject_reason ? `: ${o.reject_reason}` : ""}</p>}
        </div>
        <div class="card">
          <h2>ارسال به 📦</h2>
          {confirmed ? (
            <>
              <p>
                {o.ship_name}<br />
                <span class="dt">{o.ship_phone}</span><br />
                {o.ship_city && <>{o.ship_city}<br /></>}
                <span style="white-space:pre-wrap">{o.ship_address}</span><br />
                کد پستی: <span class="dt">{o.ship_postal_code}</span>
              </p>
              {o.status !== "delivered" && (
                <form method="post" action={`/panel/orders/${o.id}/ship`}>
                  <label>کد رهگیری مرسوله</label>
                  <input name="tracking_code" value={o.tracking_code} class="ltr" maxlength={60} />
                  <p><button>{o.status === "paid" ? "ثبت «ارسال شد»" : "به‌روزرسانی کد رهگیری"}</button></p>
                </form>
              )}
              {o.status === "shipped" && (
                <form method="post" action={`/panel/orders/${o.id}/delivered`}>
                  <button class="secondary">تحویل داده شد</button>
                </form>
              )}
            </>
          ) : (
            <p class="muted">آدرس گیرنده بعد از تأیید واریز نمایش داده می‌شود.</p>
          )}
        </div>
      </div>
      <StockActions o={o} variants={props.variants} available={props.available} />
    </PanelShell>
  );
}

function StockBadge(props: { p: Product & { stock_total: number } }) {
  const p = props.p;
  if (!p.track_stock) return <span class="text-[10px] text-slate-500">موجودی: نامحدود</span>;
  return p.stock_total > 0 ? (
    <span class="text-[10px] text-slate-700">موجودی: <b>{p.stock_total.toLocaleString("fa-IR")}</b></span>
  ) : (
    <span class="text-[10px] px-1.5 py-0.5 rounded-sm bg-red-50 text-red-600 font-bold">ناموجود</span>
  );
}

export function ProductsPage(props: { user: User; shop: Shop; products: (Product & { stock_total: number; has_sizes: number })[] }) {
  return (
    <PanelShell title="محصولات" user={props.user} shop={props.shop} on="products">
      <div class="flex items-center justify-between mb-4">
        <h1 class="!mb-0">محصولات</h1>
        <a class="btn small" href="/panel/products/new"><i class="fa-solid fa-plus"></i> محصول جدید</a>
      </div>
      {props.products.length === 0 && <div class="card text-center text-sm muted py-10">هنوز محصولی ثبت نشده.</div>}
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        {props.products.map((p) => (
          <div class="bg-white rounded-2xl border border-sky-100 shadow-xs overflow-hidden">
            <a href={`/panel/products/${p.id}`} class="block !text-sky-900">
              <div class="aspect-square bg-slate-50 flex items-center justify-center text-4xl">
                {p.image_key ? <img src={`/img/${p.image_key}`} alt={p.title} loading="lazy" class="w-full h-full object-cover" /> : "🎁"}
              </div>
              <div class="p-3 pb-1">
                <h3 class="text-xs font-bold truncate">{p.title}</h3>
                <div class="flex items-center justify-between mt-1">
                  <span class="text-[11px] font-bold text-sky-600">{toman(p.price)}</span>
                  <span class={`text-[10px] px-1.5 py-0.5 rounded-sm ${p.is_active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>{p.is_active ? "فعال" : "غیرفعال"}</span>
                </div>
              </div>
            </a>
            <div class="px-3 pb-3 flex items-center justify-between gap-2">
              <StockBadge p={p} />
              {p.has_sizes ? (
                <a href={`/panel/products/${p.id}#stock`} class="text-[10px]">موجودی سایزها</a>
              ) : (
                <form method="post" action={`/panel/products/${p.id}/stock`} class="flex gap-1">
                  <button name="delta" value="-1" class="!px-2 !py-0.5 !text-xs !rounded-lg secondary" aria-label="یکی کم کن">−</button>
                  <button name="delta" value="1" class="!px-2 !py-0.5 !text-xs !rounded-lg" aria-label="یکی اضافه کن">+</button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

/** Per-variant details beyond the quantity (product_variants in the CRM model). */
export interface VariantInfo {
  sku: string;
  price: number | null;
  sale_price: number | null;
  min_stock: number;
}

/** Stock, SKU, price and sale price per variant (size × color). New sizes/colors appear after saving. */
function StockEditor(props: { variants: Variant[]; stock: Record<string, number>; info: Record<string, VariantInfo>; track: boolean }) {
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return (
    <div class="card" id="stock">
      <h2>📦 تنوع‌ها و موجودی انبار</h2>
      <label class="row" style="color:var(--fg);margin-top:0">
        <input type="checkbox" name="track_stock" value="1" checked={props.track} /> مدیریت موجودی (بیشتر از موجودی فروخته نمی‌شود)
      </label>
      <p class="muted small" style="margin:4px 0 8px">
        خاموش = نامحدود. موجودی برای هر ترکیب سایز و رنگ جداست. با هر تأیید واریز یکی کم می‌شود؛ تا وقتی فیش‌ها منتظر تأیید هستند، همان
        تعداد رزرو می‌ماند. قیمت خالی = قیمت اصلی محصول؛ قیمت حراج در فروش دایرکت استفاده می‌شود. وقتی موجودی به «حداقل» برسد در داشبورد هشدار می‌گیرید.
      </p>
      <div class="space-y-3">
        {props.variants.map((v, n) => {
          const i = props.info[v.key];
          return (
            <div class="border border-slate-100 rounded-xl p-2">
              <input type="hidden" name={`stock_key_${n}`} value={v.key} />
              <b class="text-xs">{v.label || "محصول"}</b>
              <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div><label class="!mt-1">موجودی</label><input name={`stock_${n}`} value={String(props.stock[v.key] ?? 0)} class="ltr" inputmode="numeric" /></div>
                <div><label class="!mt-1">حداقل</label><input name={`min_${n}`} value={String(i?.min_stock ?? 0)} class="ltr" inputmode="numeric" /></div>
                <div><label class="!mt-1">SKU</label><input name={`sku_${n}`} value={i?.sku ?? ""} class="ltr" maxlength={40} /></div>
                <div><label class="!mt-1">قیمت</label><input name={`vprice_${n}`} value={num(i?.price)} class="ltr" inputmode="numeric" placeholder="اصلی" /></div>
                <div><label class="!mt-1">قیمت حراج</label><input name={`sale_${n}`} value={num(i?.sale_price)} class="ltr" inputmode="numeric" placeholder="—" /></div>
              </div>
            </div>
          );
        })}
      </div>
      <p class="muted small" style="margin-bottom:0">اگر سایز یا رنگ تازه‌ای اضافه کردید، بعد از ذخیره مشخصات آن را اینجا وارد کنید.</p>
    </div>
  );
}

export function ProductFormPage(props: {
  user: User;
  shop: Shop;
  product: Product | null;
  values: Record<string, string>;
  images?: ProductImage[];
  packages?: ProductPackage[];
  stock?: Record<string, number>;
  variantInfo?: Record<string, VariantInfo>;
  categories: string[];
  errors?: string[];
}) {
  const p = props.product;
  const v = props.values;
  const pkgs = [...(props.packages ?? []), ...Array.from({ length: 3 }, () => ({ id: 0, name: "", price: 0 }))];
  return (
    <PanelShell title={p ? p.title : "محصول جدید"} user={props.user} shop={props.shop} on="products">
      <p class="mb-3"><a href="/panel/products" class="text-xs"><i class="fa-solid fa-chevron-right ml-1"></i>محصولات</a></p>
      {v.saved && <div class="okbox">ذخیره شد.</div>}
      <Errors errors={props.errors} />
      <form method="post" action={p ? `/panel/products/${p.id}` : "/panel/products/new"} enctype="multipart/form-data">
        <div class="card two">
          <div>
            <label style="margin-top:0">عنوان محصول</label>
            <input name="title" value={v.title ?? ""} required maxlength={120} />
            <label>قیمت (تومان)</label>
            <input name="price" value={v.price ?? ""} class="ltr" inputmode="numeric" required />
            <label>دسته‌بندی</label>
            <select name="category">
              <option value="">بدون دسته</option>
              {[...new Set([...props.categories, ...(v.category ? [v.category] : [])])].map((c) => <option value={c} selected={v.category === c}>{c}</option>)}
            </select>
            <label>توضیحات</label>
            <textarea name="description" maxlength={3000} style="min-height:140px">{v.description ?? ""}</textarea>
            <label>رنگ‌ها (هر خط یک رنگ؛ خالی = بدون انتخاب رنگ)</label>
            <textarea name="colors" maxlength={600} placeholder={"مثلاً:\nمشکی\nسرمه‌ای\nطوسی"} style="min-height:90px">{v.colors ?? ""}</textarea>
            <label>ویژگی‌های کلیدی (هر خط یک ویژگی، تا ۸ مورد)</label>
            <textarea name="features" maxlength={800} placeholder={"مثلاً:\nجنس نخ پنبه\nقابل شستشو"}>{v.features ?? ""}</textarea>
            <label>لینک ویدیو (پست اینستاگرام، کانال تلگرام یا بله)</label>
            <input name="video_url" value={v.video_url ?? ""} class="ltr" placeholder="https://instagram.com/p/... یا https://t.me/channel/123" maxlength={300} />
            <label class="row" style="color:var(--fg)">
              <input type="checkbox" name="is_active" value="1" style="width:auto" checked={v.is_active !== "0"} /> فعال (نمایش در سایت)
            </label>
          </div>
          <div>
            <label style="margin-top:0">عکس‌ها (تا ۸ عکس، هر کدام حداکثر ۳ مگابایت؛ اولی عکس اصلی است)</label>
            {!!props.images?.length && (
              <div class="row" style="margin-bottom:8px">
                {props.images.map((img, n) => (
                  <label style="text-align:center;margin:0">
                    <img src={`/img/${img.image_key}`} alt="" style="width:84px;height:84px;object-fit:cover;border-radius:8px;display:block" />
                    <input type="checkbox" name="delete_image" value={String(img.id)} class="del-img" style="width:auto" /> حذف
                    {n === 0 && <div class="small muted">عکس اصلی</div>}
                  </label>
                ))}
              </div>
            )}
            <FilePicker name="images" id="images" multiple label="افزودن عکس" icon="fa-images" />
            <div class="small muted" id="img-count"></div>
            <div class="row" id="img-preview" style="margin-top:8px"></div>
          </div>
        </div>
        <StockEditor variants={variants({ size_guide: v.size_guide ?? "", colors: v.colors ?? "" })} stock={props.stock ?? {}} info={props.variantInfo ?? {}} track={v.track_stock === "1"} />
        <div class="card">
          <h2>📏 راهنمای سایز (برای لباس و هر محصول سایزدار)</h2>
          <p class="muted small" style="margin-top:0">
            ستون اول نام سایز است (S، M، 38، ...). اگر جدول داشته باشد، صاحب لیست آرزو موقع افزودن محصول باید سایزش را انتخاب کند و همان
            سایز در سفارش برای شما می‌آید. برای محصول بدون سایز، جدول را خالی بگذارید.
          </p>
          <input type="hidden" name="size_guide" id="size-guide" value={v.size_guide ?? ""} />
          <div id="sg-editor" class="wrap"></div>
          <noscript><p class="errbox">برای ویرایش جدول سایز، جاوااسکریپت مرورگر را فعال کنید.</p></noscript>
          <label>عکس جدول سایز (اختیاری)</label>
          {p?.size_guide_image && (
            <div class="row" style="margin-bottom:6px">
              <img src={`/img/${p.size_guide_image}`} alt="راهنمای سایز" style="max-width:220px;border-radius:8px" />
              <label class="row" style="color:var(--fg)"><input type="checkbox" name="remove_size_guide_image" value="1" style="width:auto" /> حذف عکس</label>
            </div>
          )}
          <FilePicker name="size_guide_image" label="انتخاب عکس جدول" icon="fa-table" />
        </div>

        <div class="card">
          <h2>بسته‌بندی‌های کادویی</h2>
          <p class="muted small" style="margin-top:0">
            خریدار کادو یکی از این‌ها را انتخاب می‌کند و قیمتش به مبلغ اضافه می‌شود (قیمت ۰ = رایگان). برای حذف، نام را خالی کنید. اگر
            هیچ بسته‌بندی تعریف نکنید، انتخاب بسته‌بندی نمایش داده نمی‌شود.
          </p>
          {pkgs.map((k, n) => (
            <div class="row" style="margin-bottom:6px">
              <input type="hidden" name={`pkg_id_${n}`} value={k.id ? String(k.id) : ""} />
              <input name={`pkg_name_${n}`} value={k.name} placeholder="مثلاً: جعبه کادو با روبان" maxlength={60} style="flex:2;min-width:180px" />
              <input name={`pkg_price_${n}`} value={k.id ? String(k.price) : ""} placeholder="قیمت (تومان)" class="ltr" inputmode="numeric" style="flex:1;min-width:120px" />
            </div>
          ))}
        </div>
        <p><button>{p ? "ذخیره" : "ثبت محصول"}</button></p>
      </form>
      <script dangerouslySetInnerHTML={{ __html: productFormScript(props.images?.length ?? 0) }} />
    </PanelShell>
  );
}

/** Client side of the product form: photo previews before upload and the size-table editor. */
function productFormScript(existingImages: number) {
  return `
(function () {
  var MAX = 8, form = document.querySelector('form[enctype]');
  // ---- photos: keep every picked file (several rounds of picking add up) and preview them ----
  var input = document.getElementById('images'), box = document.getElementById('img-preview'), count = document.getElementById('img-count');
  var dt = new DataTransfer();
  function kept() { return ${existingImages} - document.querySelectorAll('.del-img:checked').length; }
  function drawPhotos() {
    box.innerHTML = '';
    Array.prototype.forEach.call(dt.files, function (f, i) {
      var cell = document.createElement('div'); cell.style.cssText = 'position:relative';
      var img = document.createElement('img'); img.src = URL.createObjectURL(f);
      img.style.cssText = 'width:84px;height:84px;object-fit:cover;border-radius:8px;display:block;border:2px solid var(--accent)';
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'حذف';
      x.style.cssText = 'position:absolute;top:2px;left:2px;padding:0 7px;border-radius:50%;line-height:1.5';
      x.onclick = function () { var n = new DataTransfer(); Array.prototype.forEach.call(dt.files, function (g, j) { if (j !== i) n.items.add(g); }); dt = n; input.files = dt.files; drawPhotos(); };
      cell.appendChild(img); cell.appendChild(x); box.appendChild(cell);
    });
    var total = kept() + dt.files.length;
    count.textContent = dt.files.length ? (dt.files.length + ' عکس جدید انتخاب شد — مجموع ' + total + ' از ' + MAX) : '';
    count.style.color = total > MAX ? 'var(--danger)' : '';
    if (window.updateFilePick) window.updateFilePick(input);
  }
  input.addEventListener('change', function () {
    Array.prototype.forEach.call(input.files, function (f) { if (kept() + dt.files.length < MAX) dt.items.add(f); });
    input.files = dt.files; drawPhotos();
  });
  document.querySelectorAll('.del-img').forEach(function (c) { c.addEventListener('change', drawPhotos); });

  // ---- size table editor (stored as JSON in #size-guide) ----
  var hidden = document.getElementById('size-guide'), ed = document.getElementById('sg-editor');
  var TEMPLATE = ${JSON.stringify(CLOTHING_TEMPLATE)};
  var g = null; try { g = hidden.value ? JSON.parse(hidden.value) : null; } catch (e) { g = null; }
  function btn(label, fn, cls) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = cls || 'secondary small'; b.onclick = fn; return b; }
  function cellInput(val, set, w) { var i = document.createElement('input'); i.value = val || ''; i.maxLength = 30; i.style.cssText = 'min-width:' + (w || 80) + 'px'; i.oninput = function () { set(i.value); }; return i; }
  function draw() {
    ed.innerHTML = '';
    var bar = document.createElement('div'); bar.className = 'row'; bar.style.marginBottom = '8px';
    if (!g) {
      bar.appendChild(btn('استفاده از قالب لباس', function () { g = JSON.parse(JSON.stringify(TEMPLATE)); draw(); }, 'small'));
      bar.appendChild(btn('جدول خالی', function () { g = { columns: ['سایز', ''], rows: [['', '']] }; draw(); }));
      ed.appendChild(bar); return;
    }
    var t = document.createElement('table'), head = document.createElement('tr');
    g.columns.forEach(function (c, ci) {
      var th = document.createElement('th'); th.appendChild(cellInput(c, function (v) { g.columns[ci] = v; }, 90));
      if (ci > 0) th.appendChild(btn('×', function () { g.columns.splice(ci, 1); g.rows.forEach(function (r) { r.splice(ci, 1); }); draw(); }));
      head.appendChild(th);
    });
    head.appendChild(document.createElement('th')); t.appendChild(head);
    g.rows.forEach(function (r, ri) {
      var tr = document.createElement('tr');
      g.columns.forEach(function (_, ci) { var td = document.createElement('td'); td.appendChild(cellInput(r[ci], function (v) { g.rows[ri][ci] = v; })); tr.appendChild(td); });
      var td = document.createElement('td'); td.appendChild(btn('حذف ردیف', function () { g.rows.splice(ri, 1); draw(); })); tr.appendChild(td);
      t.appendChild(tr);
    });
    ed.appendChild(t);
    bar.appendChild(btn('+ ردیف (سایز)', function () { g.rows.push(g.columns.map(function () { return ''; })); draw(); }));
    bar.appendChild(btn('+ ستون (اندازه)', function () { if (g.columns.length >= 10) return; g.columns.push(''); g.rows.forEach(function (r) { r.push(''); }); draw(); }));
    bar.appendChild(btn('حذف کل جدول', function () { if (confirm('جدول سایز حذف شود؟')) { g = null; draw(); } }));
    bar.style.marginTop = '8px'; ed.appendChild(bar);
  }
  draw();
  form.addEventListener('submit', function () { hidden.value = g ? JSON.stringify(g) : ''; });
})();`;
}

const PREVIEW_SCRIPT = `document.querySelectorAll('input[data-preview]').forEach(function(i){i.addEventListener('change',function(){
  var img=document.getElementById(i.getAttribute('data-preview'));if(i.files[0]){img.src=URL.createObjectURL(i.files[0]);img.classList.remove('hidden');}});});`;

export function SettingsPage(props: { user: User; shop: Shop; error?: string; ok?: string; children?: Child }) {
  const s = props.shop;
  const u = props.user;
  return (
    <PanelShell title="تنظیمات" user={props.user} shop={s} on="settings">
      <h1>تنظیمات فروشگاه</h1>
      <Errors errors={[props.error]} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      <form method="post" action="/panel/settings" class="card" enctype="multipart/form-data">
        <h2>لوگو و عکس کاور</h2>
        <p class="muted small" style="margin-top:0">در صفحه فروشگاه، کنار محصولات و بنر «فروشگاه هفته» نمایش داده می‌شوند.</p>
        <div class="flex flex-wrap gap-6 items-start">
          <div>
            <label style="margin-top:0">لوگو (مربعی)</label>
            <img id="logo-preview" src={s.logo_key ? `/img/${s.logo_key}` : ""} alt="" class={`w-20 h-20 rounded-2xl object-cover border border-sky-100 mb-2 ${s.logo_key ? "" : "hidden"}`} />
            <FilePicker name="logo" label="انتخاب لوگو" attrs={{ "data-preview": "logo-preview" }} />
            {s.logo_key && <label class="row" style="color:var(--fg)"><input type="checkbox" name="remove_logo" value="1" /> حذف لوگو</label>}
          </div>
          <div class="flex-1 min-w-[220px]">
            <label style="margin-top:0">عکس کاور (افقی)</label>
            <img id="cover-preview" src={s.cover_key ? `/img/${s.cover_key}` : ""} alt="" class={`w-full max-w-sm h-24 rounded-2xl object-cover border border-sky-100 mb-2 ${s.cover_key ? "" : "hidden"}`} />
            <FilePicker name="cover" label="انتخاب کاور" attrs={{ "data-preview": "cover-preview" }} />
            {s.cover_key && <label class="row" style="color:var(--fg)"><input type="checkbox" name="remove_cover" value="1" /> حذف کاور</label>}
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: PREVIEW_SCRIPT }} />

        <h2 style="margin-top:20px">اطلاع‌رسانی</h2>
        <p class="muted small" style="margin-top:0">
          فیش‌های واریز (با دکمه تأیید و رد) و سفارش‌ها به بات‌هایی که حسابتان به آن وصل است ارسال می‌شود:{" "}
          {u.bale_chat_id && <span class="tag ok">بله ✓</span>} {u.telegram_chat_id && <span class="tag ok">تلگرام ✓</span>}
        </p>

        <h2 style="margin-top:20px">دریافت پول (کارت به کارت)</h2>
        <div class="two">
          <div>
            <label>شماره کارت</label>
            <input name="card_number" value={s.card_number} class="ltr" inputmode="numeric" placeholder="6037-xxxx-xxxx-xxxx" />
          </div>
          <div>
            <label>نام صاحب کارت</label>
            <input name="card_holder" value={s.card_holder} maxlength={80} />
          </div>
        </div>

        <h2 style="margin-top:20px">شهر و ارسال</h2>
        <label>شهر فروشگاه</label>
        <CityInput value={s.city} />
        <div class="two">
          <div>
            <label class="row" style="color:var(--fg)">
              <input type="checkbox" name="courier_enabled" value="1" style="width:auto" checked={!!s.courier_enabled} /> ارسال با پیک (فقط داخل شهر خودتان)
            </label>
            <label>هزینه پیک (تومان)</label>
            <input name="courier_fee" value={String(s.courier_fee)} class="ltr" inputmode="numeric" />
          </div>
          <div>
            <label class="row" style="color:var(--fg)">
              <input type="checkbox" name="post_enabled" value="1" style="width:auto" checked={!!s.post_enabled} /> ارسال با پست (همه شهرها، از جمله شهر خودتان)
            </label>
            <label>هزینه پست (تومان)</label>
            <input name="post_fee" value={String(s.post_fee)} class="ltr" inputmode="numeric" />
          </div>
        </div>

        <h2 style="margin-top:20px">شبکه‌های اجتماعی (در صفحه فروشگاه نمایش داده می‌شود)</h2>
        <div class="two">
          <div><label>اینستاگرام (آیدی یا لینک)</label><input name="instagram" value={s.instagram} class="ltr" placeholder="@myshop" /></div>
          <div><label>کانال تلگرام</label><input name="telegram" value={s.telegram} class="ltr" placeholder="@mychannel" /></div>
          <div><label>کانال بله</label><input name="bale" value={s.bale} class="ltr" placeholder="@mychannel" /></div>
          <div><label>وب‌سایت</label><input name="website" value={s.website} class="ltr" placeholder="https://..." /></div>
        </div>

        <h2 style="margin-top:20px">اطلاعات فروشگاه</h2>
        <label>نام</label>
        <input name="name" value={s.name} required maxlength={80} />
        <label>تلفن</label>
        <input name="phone" value={s.phone} class="ltr" required />
        <label>درباره</label>
        <textarea name="description" maxlength={1000}>{s.description}</textarea>
        <p class="row">
          <button>ذخیره</button>
          <button class="secondary" formaction="/panel/settings/test">ارسال پیام آزمایشی به بات</button>
        </p>
      </form>
      {props.children}
    </PanelShell>
  );
}

export function AdminPage(props: {
  user: User;
  shops: (Shop & { owner_name: string; owner_phone: string; products: number })[];
  stats: { shop_id: number; name: string; orders: number; total: number; unsent: number }[];
  kpi: { shops: number; pendingShops: number; users: number; customers: number; openConversations: number; instagramShops: number; giftGmv: number; directGmv: number };
  featuredId: number;
}) {
  const k = props.kpi;
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const box = (label: string, value: string, note?: string) => (
    <div class="card !mb-0">
      <span class="small muted block">{label}</span>
      <b class="text-lg">{value}</b>
      {note && <span class="small muted block">{note}</span>}
    </div>
  );
  return (
    <AdminShell title="مدیریت" user={props.user} on="/admin">
      <h1>داشبورد پلتفرم</h1>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {box("فروشگاه‌ها", fa(k.shops), k.pendingShops ? `${fa(k.pendingShops)} منتظر تأیید` : undefined)}
        {box("کاربران", fa(k.users))}
        {box("مشتریان CRM", fa(k.customers), `${fa(k.instagramShops)} فروشگاه وصل به اینستاگرام`)}
        {box("گفتگوی باز", fa(k.openConversations))}
        {box("فروش کل (GMV)", toman(k.giftGmv + k.directGmv))}
        {box("فروش کادو در سایت", toman(k.giftGmv))}
        {box("فروش دایرکت فروشگاه‌ها", toman(k.directGmv))}
      </div>
      <div class="card wrap">
        <h2>فروشگاه‌ها</h2>
        <table>
          <thead><tr><th>فروشگاه</th><th>مالک</th><th>محصولات</th><th>وضعیت</th><th>ثبت</th><th></th></tr></thead>
          <tbody>
            {props.shops.map((s) => (
              <tr>
                <td><a href={`/s/${s.slug}`}>{s.name}</a><div class="small muted dt">{s.phone}</div></td>
                <td>
                  {s.owner_name}<div class="small muted dt">{s.owner_phone}</div>
                  {s.owner_id !== props.user.id && (
                    <form method="post" action={`/admin/users/${s.owner_id}/login-as`} class="m-0" style="margin-top:4px">
                      <button class="small secondary" title="ورود به حساب مالک فروشگاه">ورود به حساب</button>
                    </form>
                  )}
                </td>
                <td>{s.products}</td>
                <td><span class={`tag ${s.status === "approved" ? "ok" : ""}`}>{SHOP_STATUS[s.status]}</span></td>
                <td class="muted"><span class="dt">{formatJalali(s.created_at, false)}</span></td>
                <td>
                  <form method="post" action={`/admin/shops/${s.id}/status`} class="row">
                    {s.status !== "approved" && <button class="small" name="status" value="approved">تأیید</button>}
                    {s.status !== "suspended" && <button class="small secondary" name="status" value="suspended">تعلیق</button>}
                  </form>
                  {s.status === "approved" && (
                    <form method="post" action="/admin/featured" style="margin-top:6px">
                      {props.featuredId === s.id ? (
                        <button class="small secondary" name="shop_id" value="0">⭐ فروشگاه هفته (برداشتن)</button>
                      ) : (
                        <button class="small secondary" name="shop_id" value={String(s.id)}>انتخاب به‌عنوان فروشگاه هفته</button>
                      )}
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="card wrap">
        <h2>فروش هر فروشگاه (پرداخت‌شده‌ها — برای تسویه)</h2>
        <table>
          <thead><tr><th>فروشگاه</th><th>تعداد سفارش</th><th>جمع مبلغ</th><th>ارسال‌نشده</th></tr></thead>
          <tbody>
            {props.stats.map((s) => (
              <tr><td>{s.name}</td><td>{s.orders}</td><td class="price">{toman(s.total)}</td><td>{s.unsent}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

export function SetupPage(props: { step: "details" | "code"; error?: string; values?: Record<string, string> }) {
  const v = props.values ?? {};
  return (
    <Layout title="راه‌اندازی" user={null}>
      <div class="card" style="max-width:460px;margin:40px auto">
        <h1>راه‌اندازی سایت</h1>
        <Errors errors={[props.error]} />
        {props.step === "details" ? (
          <form method="post" action="/setup">
            <p class="warnbox">
              ورود به سایت فقط با کد یکبار مصرف بله است، پس اول سرویس «سفیر» بله را وصل کنید. اولین کسی که این فرم را کامل کند مدیر سایت
              می‌شود و بعد این صفحه بسته می‌شود.
            </p>
            <label>نام شما</label>
            <input name="name" value={v.name ?? ""} required maxlength={80} />
            <label>شماره موبایل شما (کد تأیید به بله همین شماره می‌رود)</label>
            <input name="phone" value={v.phone ?? ""} class="ltr" inputmode="tel" required />
            <label>کلید API سفیر (api-access-key از پنل کسب‌وکار بله)</label>
            <input name="safir_api_key" class="ltr" autocomplete="off" required />
            <label>شناسه عددی بازوی فرستنده (bot_id)</label>
            <input name="safir_bot_id" value={v.safir_bot_id ?? ""} class="ltr" inputmode="numeric" required />
            <p><button>ارسال کد تأیید</button></p>
          </form>
        ) : (
          <form method="post" action="/setup/verify">
            <input type="hidden" name="name" value={v.name} />
            <input type="hidden" name="phone" value={v.phone} />
            <p class="muted small" style="margin-top:0">
              کد ۶ رقمی به بله شماره <span class="dt">{v.phone}</span> ارسال شد.
            </p>
            <label>کد</label>
            <input name="code" class="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength={6} required autofocus />
            <p><button>ساخت حساب مدیر</button></p>
          </form>
        )}
      </div>
    </Layout>
  );
}

export interface AdminUserRow {
  id: number;
  name: string;
  phone: string;
  username: string | null;
  is_admin: number;
  is_staff: number;
  created_at: string;
  bale: number;
  telegram: number;
  shop_name: string | null;
  shop_slug: string | null;
  shop_role: string;
}

/** /admin/users: every account, searchable, with "sign in as" for non-admins and a log of those sign-ins. */
export function AdminUsersPage(props: {
  user: User;
  q: string;
  page: number;
  users: AdminUserRow[];
  more: boolean;
  recent: { started_at: string; ended_at: string | null; admin_name: string; user_id: number; user_name: string; user_phone: string }[];
  error: string;
}) {
  const pageLink = (p: number) => `/admin/users?${new URLSearchParams({ ...(props.q ? { q: props.q } : {}), page: String(p) })}`;
  return (
    <AdminShell title="کاربران" user={props.user} on="/admin/users">
      <h1>کاربران</h1>
      <p class="muted small">
        با «ورود به حساب» سایت را دقیقاً همان‌طور که آن کاربر می‌بیند باز می‌کنید (پروفایل، لیست‌ها، پنل فروشگاهش). حداکثر ۲ ساعت؛ با دکمه
        «بازگشت به حساب مدیر» در بالای صفحه یا خروج، به حساب خودتان برمی‌گردید. هر ورود ثبت می‌شود.
      </p>
      {props.error && <div class="errbox">{props.error}</div>}
      <form method="get" action="/admin/users" class="row mb-3">
        <input name="q" value={props.q} placeholder="جستجو: نام، موبایل، نام کاربری یا فروشگاه" class="flex-1" />
        <button>جستجو</button>
      </form>
      <div class="card wrap">
        <table>
          <thead><tr><th>کاربر</th><th>فروشگاه</th><th>بات</th><th>عضویت</th><th></th></tr></thead>
          <tbody>
            {props.users.map((u) => (
              <tr>
                <td>
                  {u.username ? <a href={`/u/${u.username}`}>{u.name || "—"}</a> : u.name || "—"}
                  {u.is_admin ? <span class="tag ok mr-1">مدیر</span> : u.is_staff ? <span class="tag mr-1">CRM</span> : null}
                  <div class="small muted dt">{u.phone}</div>
                </td>
                <td>{u.shop_slug ? <a href={`/s/${u.shop_slug}`}>{u.shop_name}</a> : <span class="muted">—</span>}{u.shop_role === "agent" && <div class="small muted">کارمند</div>}</td>
                <td class="small">{[u.bale ? "بله" : "", u.telegram ? "تلگرام" : ""].filter(Boolean).join("، ") || <span class="muted">وصل نیست</span>}</td>
                <td class="muted"><span class="dt">{formatJalali(u.created_at, false)}</span></td>
                <td>
                  {!u.is_admin && u.id !== props.user.id && (
                    <form method="post" action={`/admin/users/${u.id}/login-as`} class="m-0">
                      <button class="small secondary"><i class="fa-solid fa-right-to-bracket ml-1"></i>ورود به حساب</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!props.users.length && <tr><td colSpan={5} class="muted">کاربری پیدا نشد.</td></tr>}
          </tbody>
        </table>
        <div class="row" style="justify-content:space-between;margin-top:10px">
          {props.page > 1 ? <a href={pageLink(props.page - 1)}>→ قبلی</a> : <span></span>}
          {props.more && <a href={pageLink(props.page + 1)}>بعدی ←</a>}
        </div>
      </div>
      <div class="card wrap">
        <h2>ورودهای اخیر مدیران به حساب کاربران</h2>
        {props.recent.length ? (
          <table>
            <thead><tr><th>مدیر</th><th>کاربر</th><th>شروع</th><th>پایان</th></tr></thead>
            <tbody>
              {props.recent.map((r) => (
                <tr>
                  <td>{r.admin_name}</td>
                  <td>{r.user_name}<div class="small muted dt">{r.user_phone}</div></td>
                  <td class="muted"><span class="dt">{formatJalali(r.started_at)}</span></td>
                  <td class="muted">{r.ended_at ? <span class="dt">{formatJalali(r.ended_at)}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="muted small">هنوز موردی نیست.</p>
        )}
      </div>
    </AdminShell>
  );
}

/** Admin area: light theme (like the shop panel) with its own header and tabs. */
function AdminShell(props: { title: string; user: User; on: string; children?: Child }) {
  const tabs: [string, string, string][] = [
    ["/admin", "fa-chart-simple", "آمار و فروشگاه‌ها"],
    ["/admin/users", "fa-users", "کاربران"],
    ["/admin/content", "fa-pen-to-square", "درباره و سوالات"],
    ["/admin/settings", "fa-gear", "تنظیمات سایت"],
    ["/crm", "fa-address-book", "CRM"],
  ];
  const sidebar = (
    <SideNav
      brand={
        <a href="/admin" class="flex items-center gap-3 text-xl font-black !text-sky-500">
          <span class="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/20"><i class="fa-solid fa-shield-halved"></i></span>
          مدیریت سایت
        </a>
      }
      items={tabs.map(([href, icon, label]) => ({ href, icon, label, on: props.on === href, divider: href === "/crm" }))}
      footer={
        <div class="flex items-center gap-3 p-3 rounded-2xl bg-sky-50/60 border border-sky-100">
          <span class="w-10 h-10 rounded-full bg-sky-100 text-sky-600 font-bold flex items-center justify-center">{props.user.name.trim()[0] ?? "؟"}</span>
          <div class="flex-1 min-w-0">
            <b class="text-xs text-sky-900 block truncate">{props.user.name}</b>
            <span class="text-[10px] text-slate-500">مدیر پلتفرم</span>
          </div>
          <a href="/" title="بازگشت به سایت" aria-label="بازگشت به سایت" class="!text-slate-400 hover:!text-sky-500"><i class="fa-solid fa-house"></i></a>
        </div>
      }
    />
  );
  const header = (
    <header class="md:hidden bg-white border-b border-sky-100 sticky top-0 z-40">
      <div class="px-4 py-3 flex items-center justify-between gap-3">
        <a href="/admin" class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white"><i class="fa-solid fa-shield-halved"></i></div>
          <div>
            <h1 class="text-sm font-bold text-sky-900">مدیریت سایت</h1>
            <p class="text-[10px] text-slate-500">{props.user.name}</p>
          </div>
        </a>
        <a href="/" aria-label="بازگشت به سایت" title="بازگشت به سایت" class="w-10 h-10 flex items-center justify-center rounded-full bg-sky-50 text-sky-600"><i class="fa-solid fa-house"></i></a>
      </div>
      <nav class="px-4 flex gap-1 overflow-x-auto no-scrollbar" aria-label="بخش‌های مدیریت">
        {tabs.map(([href, icon, label]) => (
          <a
            href={href}
            class={`whitespace-nowrap px-3 py-2.5 text-xs font-bold border-b-2 ${props.on === href ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500 hover:text-sky-900"}`}
          >
            <i class={`fa-solid ${icon} ml-1`}></i>{label}
          </a>
        ))}
      </nav>
    </header>
  );
  return (
    <Layout title={props.title} user={props.user} panel wide header={header} sidebar={sidebar}>
      {props.children}
    </Layout>
  );
}

export function AdminSettingsPage(props: {
  user: User;
  s: Settings;
  webhookBase: string;
  linkedCount: number;
  igVerifyToken: string;
  igRedirect: string;
  error?: string;
  ok?: string;
}) {
  const s = props.s;
  const bot = (kind: "bale" | "telegram", title: string, father: string) => {
    const token = kind === "bale" ? s.bale_bot_token : s.telegram_bot_token;
    const username = kind === "bale" ? s.bale_bot_username : s.telegram_bot_username;
    return (
      <div>
        <h2 style="margin-top:20px">بات {title}</h2>
        <p class="muted small" style="margin-top:0">
          توکن را از {father} بگیرید. بعد از ذخیره، «اتصال» را بزنید تا توکن بررسی و پیام‌های بات به این سایت وصل شود.
        </p>
        {token && (
          <p class="small">
            توکن فعلی: <span class="dt">{mask(token)}</span>
            {username ? <> · بات: <b class="dt">@{username}</b> <span class="tag ok">وصل</span></> : <> · <span class="tag">هنوز وصل نشده</span></>}
          </p>
        )}
        <label>{token ? "توکن جدید (برای نگه‌داشتن توکن فعلی خالی بگذارید)" : "توکن"}</label>
        <input name={`${kind}_bot_token`} class="ltr" autocomplete="off" placeholder="123456:ABC..." />
        {token && (
          <label class="row" style="color:var(--fg)">
            <input type="checkbox" name={`${kind}_bot_remove`} value="1" style="width:auto" /> حذف توکن
          </label>
        )}
        {token && (
          <p><button class="secondary" formaction={`/admin/settings/connect/${kind}`}>اتصال / اتصال دوباره بات {title}</button></p>
        )}
      </div>
    );
  };
  return (
    <AdminShell title="تنظیمات سایت" user={props.user} on="/admin/settings">
      <h1>تنظیمات سایت</h1>
      <Errors errors={[props.error]} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      {s.bale_bot_username && (
        <div class="card">
          <h2>اتصال شماره‌ها به بله</h2>
          <p style="margin:0">
            {props.linkedCount.toLocaleString("fa-IR")} شماره به بات وصل شده‌اند. لینک دعوت (برای مشتری‌ها بفرستید):{" "}
            <a class="dt" href={`https://ble.ir/${s.bale_bot_username}?start=link`}>{`https://ble.ir/${s.bale_bot_username}?start=link`}</a>
          </p>
        </div>
      )}
      <form method="post" action="/admin/settings" class="card">
        <h2>عمومی</h2>
        <label>نام سایت</label>
        <input name="site_name" value={s.site_name} required maxlength={40} />
        <label>
          آدرس اصلی سایت — دامنه پیش‌فرض. اگر چند دامنه به این Worker وصل است، همه بازدیدها به همین آدرس منتقل می‌شوند و لینک‌های بات،
          نقشه سایت و آدرس‌های canonical هم با آن ساخته می‌شوند. خالی = بدون انتقال (همان دامنه‌ای که سایت با آن باز شده).
        </label>
        <input name="site_url" value={s.site_url} class="ltr" placeholder={props.webhookBase} maxlength={200} />
        <label>مهلت واریز خریدار (دقیقه) — در این مدت آرزو برای او رزرو است</label>
        <input name="reservation_minutes" value={s.reservation_minutes} class="ltr" inputmode="numeric" style="max-width:140px" />
        <label>توضیح سایت برای گوگل، دستیارهای هوش مصنوعی و پیش‌نمایش لینک‌ها (حدود ۱۵۰ حرف؛ خالی = متن پیش‌فرض)</label>
        <textarea name="site_description" maxlength={300} style="min-height:70px">{s.site_description}</textarea>
        <h2 style="margin-top:20px">رنگ اصلی سایت</h2>
        <p class="muted small" style="margin-top:0">رنگ دکمه‌ها، قیمت‌ها و لینک‌ها در کل سایت (پیش‌فرض آبی). تماس، شبکه‌های اجتماعی، «درباره» و سوالات متداول در <a href="/admin/content">درباره و سوالات</a> تنظیم می‌شوند.</p>
        <div class="row">
          <input type="color" name="brand_color" value={s.brand_color} style="width:64px;height:40px;padding:2px" aria-label="رنگ اصلی" />
          <span class="small muted ltr">{s.brand_color}</span>
        </div>

        <h2 style="margin-top:20px">آمار بازدید (اختیاری)</h2>
        <div class="two">
          <div><label>Google Analytics 4 (شناسه G-…)</label><input name="ga_measurement_id" value={s.ga_measurement_id} class="ltr" placeholder="G-XXXXXXXXXX" /></div>
          <div><label>Cloudflare Web Analytics (توکن)</label><input name="cf_analytics_token" value={s.cf_analytics_token} class="ltr" /></div>
        </div>

        <label>دسته‌بندی محصولات (هر خط یکی؛ در صفحه اول و فرم محصول نمایش داده می‌شود)</label>
        <textarea name="categories" maxlength={1000} style="min-height:150px">{s.categories}</textarea>
        <div class="card" style="margin-top:16px">
          <h2>مینی‌اپ بله و تلگرام (ورود خودکار)</h2>
          <p class="muted small" style="margin:0">
            با «اتصال» بات، دکمه منوی بات خودکار سایت را داخل بله/تلگرام باز می‌کند. برای ساخت مینی‌اپ جدا در BotFather (مثلاً با /newapp)،
            این آدرس را بدهید: <b class="dt">{`${props.webhookBase}/app`}</b>
            <br />کاربری که بات را قبلاً وصل کرده، داخل مینی‌اپ بدون کد وارد می‌شود؛ کاربر جدید یک‌بار با کد وارد می‌شود و حسابش خودکار به بات وصل می‌شود.
            <br />
            <b>تلگرام:</b> برای لینک ویترین فروشگاه‌ها و دکمه‌های زیر پست کانال‌ها (<span class="ltr">t.me/bot?startapp=…</span>)، در BotFather ← /mybots ← Bot
            Settings ← <b>Configure Mini App</b> مینی‌اپ اصلی (Main Mini App) را با همین آدرس فعال کنید.
          </p>
        </div>
        {bot("bale", "بله", "@BotFather در بله")}
        {bot("telegram", "تلگرام", "@BotFather در تلگرام")}

        <h2 style="margin-top:20px">سفیر بله (کد ورود و پیام به شماره)</h2>
        <p class="muted small" style="margin-top:0">
          ورود و ثبت‌نام سایت فقط با همین سرویس است (برای همین قابل حذف نیست). با آن، کاربران با کد یکبار مصرف وارد می‌شوند و CRM می‌تواند به شماره‌هایی که هنوز به بات
          وصل نیستند پیام بدهد (هزینه‌دار). پیام به شماره‌های وصل‌شده از طریق بات و رایگان است.
        </p>
        {s.safir_api_key && <p class="small">کلید فعلی: <span class="dt">{mask(s.safir_api_key)}</span></p>}
        <label>{s.safir_api_key ? "کلید API جدید (برای نگه‌داشتن کلید فعلی خالی بگذارید)" : "کلید API (api-access-key)"}</label>
        <input name="safir_api_key" class="ltr" autocomplete="off" />
        <label>شناسه عددی بازوی فرستنده (bot_id)</label>
        <input name="safir_bot_id" value={s.safir_bot_id} class="ltr" inputmode="numeric" style="max-width:220px" />
        {s.safir_api_key && s.safir_bot_id && (
          <p><button class="secondary" formaction="/admin/settings/test-safir">ارسال پیام آزمایشی سفیر به شماره من</button></p>
        )}

        <h2 style="margin-top:20px" id="instagram">اینستاگرام دایرکت و کامنت (CRM فروشگاه‌ها)</h2>
        <ol class="small muted list-decimal pr-5 space-y-1" style="margin-top:0">
          <li>در developers.facebook.com یک اپ با کاربرد «Instagram API» (ورود با اینستاگرام) بسازید و دسترسی‌های instagram_business_basic، instagram_business_manage_messages و instagram_business_manage_comments را اضافه کنید.</li>
          <li>«Instagram app secret» را همین پایین وارد و ذخیره کنید.</li>
          <li>در بخش Webhooks آدرس و توکن زیر را بدهید و فیلدهای <b>messages</b> و <b>comments</b> را Subscribe کنید.</li>
          <li>در App settings ← Basic این دو آدرس را بگذارید و اپ را منتشر (Live) کنید: Privacy policy: <b class="dt ltr">{`${props.webhookBase}/privacy`}</b> · Data deletion: <b class="dt ltr">{`${props.webhookBase}/data-deletion`}</b></li>
          <li>هر فروشگاه در «تنظیمات» پنل خودش توکن حسابش را وارد می‌کند (حساب باید در زبانه Roles نقش Instagram Tester داشته باشد تا App Review انجام نشده).</li>
        </ol>
        <p class="small">آدرس Callback: <b class="dt ltr">{`${props.webhookBase}/ig/webhook`}</b><br />Verify token: <b class="dt ltr">{props.igVerifyToken}</b></p>
        <label>Instagram app ID (برای دکمه «اتصال با اینستاگرام» فروشگاه‌ها)</label>
        <input name="ig_app_id" value={s.ig_app_id} class="ltr" inputmode="numeric" style="max-width:280px" />
        <p class="small muted">
          در Instagram API ← «Set up Instagram business login» ← Business login settings، این آدرس را در OAuth redirect URIs بگذارید:{" "}
          <b class="dt ltr">{props.igRedirect}</b> (دقیقاً همین، با https و بدون / در انتها)
        </p>
        {s.meta_app_secret && <p class="small">کلید فعلی: <span class="dt">{mask(s.meta_app_secret)}</span></p>}
        <label>{s.meta_app_secret ? "Instagram app secret جدید (خالی = بدون تغییر)" : "Instagram app secret (برای بررسی امضای وب‌هوک)"}</label>
        <input name="meta_app_secret" class="ltr" autocomplete="off" />

        <p style="margin-top:20px"><button>ذخیره</button></p>
      </form>
    </AdminShell>
  );
}

/** /admin/content: About page, FAQ, contact details and social profiles, developer credit. */
export function AdminContentPage(props: { user: User; s: Settings; faq: [string, string][]; isDefaultFaq: boolean; error?: string; ok?: string }) {
  const s = props.s;
  const rows = [...props.faq, ...Array.from({ length: 3 }, () => ["", ""] as [string, string])];
  const social = (key: string, label: string, placeholder: string) => (
    <div>
      <label>{label}</label>
      <input name={key} value={s[key as keyof Settings]} class="ltr" placeholder={placeholder} />
    </div>
  );
  return (
    <AdminShell title="درباره و سوالات" user={props.user} on="/admin/content">
      <h1>محتوای سایت</h1>
      <Errors errors={[props.error]} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      <form method="post" action="/admin/content">
        <div class="card">
          <div class="row">
            <h2 style="margin:0">صفحه «درباره ما»</h2>
            <span class="sp" />
            <a href="/about" target="_blank" class="small">مشاهده صفحه</a>
          </div>
          <label>عنوان</label>
          <input name="about_title" value={s.about_title} maxlength={120} placeholder={`${s.site_name} چیست؟`} />
          <label>متن (خالی = متن پیش‌فرض). پاراگراف‌ها را با یک خط خالی جدا کنید؛ خطی که با «-» شروع شود، فهرست نقطه‌دار می‌شود.</label>
          <textarea name="about_body" maxlength={6000} style="min-height:220px">{s.about_body}</textarea>
        </div>

        <div class="card">
          <h2>راه‌های ارتباطی (در «درباره ما»، پایین همه صفحه‌ها و اطلاعات کسب‌وکار برای گوگل)</h2>
          <div class="two">
            <div><label>تلفن</label><input name="contact_phone" value={s.contact_phone} class="ltr" maxlength={30} placeholder="021-12345678" /></div>
            <div><label>ایمیل</label><input name="contact_email" value={s.contact_email} class="ltr" maxlength={100} placeholder="support@example.com" /></div>
          </div>
          <label>آدرس</label>
          <input name="contact_address" value={s.contact_address} maxlength={200} />
          <div class="two">
            {social("social_telegram", "آیدی یا کانال تلگرام", "@kadoochi")}
            {social("social_instagram", "اینستاگرام", "@kadoochi")}
            {social("social_bale", "بله", "@kadoochi")}
            {social("social_x", "ایکس (توییتر)", "@kadoochi")}
            {social("social_linkedin", "لینکدین (نام صفحه یا لینک)", "kadoochi")}
            {social("social_youtube", "یوتیوب", "@kadoochi")}
            {social("social_aparat", "آپارات", "kadoochi")}
          </div>
        </div>

        <div class="card">
          <h2>طراحی و توسعه</h2>
          <p class="muted small" style="margin-top:0">در صفحه «درباره ما» و پایین سایت نمایش داده می‌شود. خالی بگذارید تا نمایش داده نشود.</p>
          <div class="two">
            <div><label>نام توسعه‌دهنده</label><input name="developer_name" value={s.developer_name} maxlength={80} /></div>
            <div><label>لینک (سایت یا آیدی تلگرام مثل ‎@name)</label><input name="developer_link" value={s.developer_link} class="ltr" maxlength={200} /></div>
          </div>
        </div>

        <div class="card">
          <div class="row">
            <h2 style="margin:0">سوالات متداول</h2>
            <span class="sp" />
            <a href="/faq" target="_blank" class="small">مشاهده صفحه</a>
          </div>
          <p class="muted small">
            {props.isDefaultFaq ? "الان سوالات پیش‌فرض نمایش داده می‌شوند؛ با ذخیره، همین فهرست قابل ویرایش می‌شود. " : ""}
            برای حذف یک سوال، سوال و پاسخش را خالی کنید. این سوال‌ها در صفحه «سوالات متداول»، صفحه اول و داده ساختاریافته برای گوگل می‌آیند.
          </p>
          {rows.map(([q, a], n) => (
            <div style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">
              <label style="margin-top:0">سوال {(n + 1).toLocaleString("fa-IR")}</label>
              <input name={`q_${n}`} value={q} maxlength={200} />
              <label>پاسخ</label>
              <textarea name={`a_${n}`} maxlength={1500} style="min-height:70px">{a}</textarea>
            </div>
          ))}
          {!props.isDefaultFaq && (
            <label class="row" style="color:var(--fg);margin-top:12px">
              <input type="checkbox" name="reset_faq" value="1" /> بازگرداندن سوالات پیش‌فرض
            </label>
          )}
        </div>
        <p><button>ذخیره</button></p>
      </form>
    </AdminShell>
  );
}
