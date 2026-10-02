import { formatJalali } from "../../../lib/jalali";
import { formatCard } from "../../../lib/normalize";
import { mask, type Settings } from "../../settings";
import { CITIES } from "../cities";
import { STATUS_LABEL, toman, type Order, type Product, type ProductImage, type ProductPackage, type Shop } from "../db";
import { DELIVERY_LABEL } from "../notify";
import { CLOTHING_TEMPLATE } from "../sizes";
import { variantKey, variantLabel, variants, type Variant } from "../variants";
import type { User } from "../../session";
import type { Child } from "hono/jsx";
import { Errors, Layout, Thumb } from "./layout";

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

export type PanelTab = "dashboard" | "products" | "orders" | "settings";

/** Shop panel shell from html/shoppanel.html: light theme, shop header and a bottom tab bar. */
function PanelShell(props: { title: string; user: User; shop: Shop; on: PanelTab; children?: Child }) {
  const s = props.shop;
  const tab = (key: PanelTab, href: string, icon: string, label: string) => (
    <a href={href} class={`flex flex-col items-center gap-1 ${props.on === key ? "text-blue-600" : "text-slate-400"}`}>
      <i class={`fa-solid ${icon} text-lg`}></i>
      <span class="text-[10px] font-bold">{label}</span>
    </a>
  );
  const header = (
    <>
      <header class="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href="/panel" class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/20 overflow-hidden shrink-0">
              {s.logo_key ? <img src={`/img/${s.logo_key}`} alt="" class="w-full h-full object-cover" /> : <i class="fa-solid fa-store text-lg"></i>}
            </div>
            <div class="min-w-0">
              <h1 class="text-sm font-bold text-slate-900 truncate">{s.name}</h1>
              <p class="text-[10px] text-slate-500">پنل فروشگاه · <span class={s.status === "approved" ? "text-emerald-600" : "text-amber-600"}>{SHOP_STATUS[s.status]}</span></p>
            </div>
          </a>
          <div class="flex gap-2">
            <a href={`/s/${s.slug}`} aria-label="صفحه عمومی فروشگاه" title="صفحه عمومی فروشگاه" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-500"><i class="fa-solid fa-eye"></i></a>
            <a href="/" aria-label="بازگشت به سایت" title="بازگشت به سایت" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-500"><i class="fa-solid fa-house"></i></a>
          </div>
        </div>
      </header>
      <nav class="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-slate-200 safe-bottom">
        <div class="max-w-md mx-auto px-8 pt-3 flex items-center justify-between">
          {tab("dashboard", "/panel", "fa-chart-pie", "داشبورد")}
          {tab("products", "/panel/products", "fa-box-open", "محصولات")}
          {tab("orders", "/panel/orders", "fa-receipt", "سفارش‌ها")}
          {tab("settings", "/panel/settings", "fa-gear", "تنظیمات")}
        </div>
      </nav>
    </>
  );
  return (
    <Layout title={props.title} user={props.user} panel header={header}>
      <div class="pb-20">
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
  paid: "bg-blue-50 text-blue-600",
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
    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-12 h-12 rounded-lg bg-slate-50 overflow-hidden border border-slate-100 shrink-0 flex items-center justify-center">
            {o.image_key ? <img class="w-full h-full object-cover" src={`/img/${o.image_key}`} alt="" loading="lazy" /> : "🎁"}
          </div>
          <div class="min-w-0">
            <h3 class="text-xs font-bold text-slate-900 truncate">{o.product_title}{variantLabel(o.size, o.color) && <span class="text-slate-500"> · {variantLabel(o.size, o.color)}</span>}</h3>
            <p class="text-[10px] text-slate-500">سفارش #{o.id} · <span class="dt">{formatJalali(o.reported_at ?? o.created_at, false)}</span></p>
            <p class="text-[11px] font-bold text-slate-900 mt-0.5">{toman(o.amount)}</p>
          </div>
        </div>
        <span class={`px-2 py-1 text-[10px] font-bold rounded-md whitespace-nowrap ${STATUS_STYLE[o.status] ?? ""}`}>{o.cancel_kind === "out_of_stock" ? "لغو، ناموجود" : o.change_status === "pending" ? "منتظر پاسخ تغییر" : SHORT_STATUS[o.status]}</span>
      </div>
      <div class="flex items-center justify-between pt-3 border-t border-slate-100">
        <div class="text-[11px] text-slate-500">
          خریدار: <span class="text-slate-900 font-medium">{o.giver_name}</span>
          {o.delivery_method && <> · {DELIVERY_LABEL[o.delivery_method]}</>}
        </div>
        <a href={`/panel/orders/${o.id}`} class="text-[11px] font-bold text-blue-600 flex items-center gap-1">
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
      class={`px-3 py-1.5 text-[11px] font-bold rounded-lg border whitespace-nowrap ${props.on ? "bg-blue-50 !text-blue-600 border-blue-100" : "bg-white !text-slate-500 border-slate-200"}`}
    >
      {props.children}
    </a>
  );
}

export function DashboardPage(props: {
  user: User;
  shop: Shop;
  stats: { today: number; awaiting: number; toShip: number; sales: number; products: number };
  orders: PanelOrder[];
  onlyAwaiting: boolean;
}) {
  const st = props.stats;
  const stat = (label: string, value: string, note?: Child) => (
    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
      <span class="text-[11px] text-slate-500 block mb-1">{label}</span>
      <span class="text-lg font-bold text-slate-900">{value}</span>
      {note}
    </div>
  );
  return (
    <PanelShell title="پنل فروشگاه" user={props.user} shop={props.shop} on="dashboard">
      <section class="grid grid-cols-2 gap-4 mb-8">
        {stat("فروش امروز", toman(st.today))}
        {stat("فیش‌های جدید", st.awaiting.toLocaleString("fa-IR"), st.awaiting ? <span class="text-[10px] text-amber-600 mr-1 font-bold">منتظر تأیید</span> : null)}
        {stat("آماده ارسال", st.toShip.toLocaleString("fa-IR"), st.toShip ? <span class="text-[10px] text-blue-600 mr-1 font-bold">فعال</span> : null)}
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
      <a href="/panel/products/new" class="mt-6 w-full py-4 bg-slate-900 !text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl shadow-slate-900/10">
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
    <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-bold">ناموجود</span>
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
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <a href={`/panel/products/${p.id}`} class="block !text-slate-900">
              <div class="aspect-square bg-slate-50 flex items-center justify-center text-4xl">
                {p.image_key ? <img src={`/img/${p.image_key}`} alt={p.title} loading="lazy" class="w-full h-full object-cover" /> : "🎁"}
              </div>
              <div class="p-3 pb-1">
                <h3 class="text-xs font-bold truncate">{p.title}</h3>
                <div class="flex items-center justify-between mt-1">
                  <span class="text-[11px] font-bold text-blue-600">{toman(p.price)}</span>
                  <span class={`text-[10px] px-1.5 py-0.5 rounded ${p.is_active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>{p.is_active ? "فعال" : "غیرفعال"}</span>
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

/** Stock per variant (size × color), or one number. New sizes/colors get their stock after saving. */
function StockEditor(props: { variants: Variant[]; stock: Record<string, number>; track: boolean }) {
  const single = props.variants.length === 1 && !props.variants[0].label;
  return (
    <div class="card" id="stock">
      <h2>📦 موجودی انبار</h2>
      <label class="row" style="color:var(--fg);margin-top:0">
        <input type="checkbox" name="track_stock" value="1" checked={props.track} /> مدیریت موجودی (بیشتر از موجودی فروخته نمی‌شود)
      </label>
      <p class="muted small" style="margin:4px 0 8px">
        خاموش = نامحدود. موجودی برای هر ترکیب سایز و رنگ جداست. با هر تأیید واریز یکی کم می‌شود؛ تا وقتی فیش‌ها منتظر تأیید هستند، همان
        تعداد رزرو می‌ماند. در صفحه سفارش هم می‌توانید به‌علت ناموجودی لغو کنید یا سایز/رنگ دیگری پیشنهاد دهید.
      </p>
      <div class={single ? "" : "grid grid-cols-2 md:grid-cols-4 gap-2"} style={single ? "max-width:160px" : ""}>
        {props.variants.map((v, n) => (
          <div>
            <label style="margin-top:0">{v.label || "تعداد موجود"}</label>
            <input type="hidden" name={`stock_key_${n}`} value={v.key} />
            <input name={`stock_${n}`} value={String(props.stock[v.key] ?? 0)} class="ltr" inputmode="numeric" />
          </div>
        ))}
      </div>
      <p class="muted small" style="margin-bottom:0">اگر سایز یا رنگ تازه‌ای اضافه کردید، بعد از ذخیره موجودی آن را اینجا وارد کنید.</p>
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
            <input type="file" id="images" name="images" accept="image/jpeg,image/png,image/webp" multiple />
            <div class="small muted" id="img-count"></div>
            <div class="row" id="img-preview" style="margin-top:8px"></div>
          </div>
        </div>
        <StockEditor variants={variants({ size_guide: v.size_guide ?? "", colors: v.colors ?? "" })} stock={props.stock ?? {}} track={v.track_stock === "1"} />
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
          <input type="file" name="size_guide_image" accept="image/jpeg,image/png,image/webp" />
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

export function SettingsPage(props: { user: User; shop: Shop; error?: string; ok?: string }) {
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
            <img id="logo-preview" src={s.logo_key ? `/img/${s.logo_key}` : ""} alt="" class={`w-20 h-20 rounded-2xl object-cover border border-slate-200 mb-2 ${s.logo_key ? "" : "hidden"}`} />
            <input type="file" name="logo" accept="image/jpeg,image/png,image/webp" data-preview="logo-preview" />
            {s.logo_key && <label class="row" style="color:var(--fg)"><input type="checkbox" name="remove_logo" value="1" /> حذف لوگو</label>}
          </div>
          <div class="flex-1 min-w-[220px]">
            <label style="margin-top:0">عکس کاور (افقی)</label>
            <img id="cover-preview" src={s.cover_key ? `/img/${s.cover_key}` : ""} alt="" class={`w-full max-w-sm h-24 rounded-2xl object-cover border border-slate-200 mb-2 ${s.cover_key ? "" : "hidden"}`} />
            <input type="file" name="cover" accept="image/jpeg,image/png,image/webp" data-preview="cover-preview" />
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
    </PanelShell>
  );
}

export function AdminPage(props: {
  user: User;
  shops: (Shop & { owner_name: string; owner_phone: string; products: number })[];
  stats: { shop_id: number; name: string; orders: number; total: number; unsent: number }[];
  featuredId: number;
}) {
  return (
    <Layout title="مدیریت" user={props.user}>
      <h1>مدیریت پلتفرم</h1>
      <AdminTabs on="/admin" />
      <div class="card wrap">
        <h2>فروشگاه‌ها</h2>
        <table>
          <thead><tr><th>فروشگاه</th><th>مالک</th><th>محصولات</th><th>وضعیت</th><th>ثبت</th><th></th></tr></thead>
          <tbody>
            {props.shops.map((s) => (
              <tr>
                <td><a href={`/s/${s.slug}`}>{s.name}</a><div class="small muted dt">{s.phone}</div></td>
                <td>{s.owner_name}<div class="small muted dt">{s.owner_phone}</div></td>
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
    </Layout>
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

function AdminTabs(props: { on: string }) {
  const tabs = [["/admin", "فروشگاه‌ها و فروش"], ["/admin/settings", "تنظیمات سایت"], ["/crm", "CRM"]];
  return (
    <nav class="tabs">
      {tabs.map(([href, label]) => <a href={href} class={props.on === href ? "on" : ""}>{label}</a>)}
    </nav>
  );
}

export function AdminSettingsPage(props: {
  user: User;
  s: Settings;
  webhookBase: string;
  linkedCount: number;
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
    <Layout title="تنظیمات سایت" user={props.user}>
      <h1>تنظیمات سایت</h1>
      <AdminTabs on="/admin/settings" />
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
        <label>آدرس سایت (برای لینک‌هایی که در بات فرستاده می‌شود؛ خالی = همان آدرسی که سایت با آن باز شده)</label>
        <input name="site_url" value={s.site_url} class="ltr" placeholder={props.webhookBase} maxlength={200} />
        <label>مهلت واریز خریدار (دقیقه) — در این مدت آرزو برای او رزرو است</label>
        <input name="reservation_minutes" value={s.reservation_minutes} class="ltr" inputmode="numeric" style="max-width:140px" />
        <label>توضیح سایت برای گوگل، دستیارهای هوش مصنوعی و پیش‌نمایش لینک‌ها (حدود ۱۵۰ حرف؛ خالی = متن پیش‌فرض)</label>
        <textarea name="site_description" maxlength={300} style="min-height:70px">{s.site_description}</textarea>
        <h2 style="margin-top:20px">تماس و شبکه‌های اجتماعی سایت</h2>
        <p class="muted small" style="margin-top:0">
          در پایین همه صفحه‌ها نمایش داده می‌شود و برای گوگل و دستیارهای هوش مصنوعی به‌عنوان مشخصات کسب‌وکار منتشر می‌شود (با آدرس و تلفن،
          به‌عنوان «کسب‌وکار محلی»). خالی بگذارید تا نمایش داده نشود.
        </p>
        <div class="two">
          <div><label>تلفن پشتیبانی</label><input name="contact_phone" value={s.contact_phone} class="ltr" maxlength={30} placeholder="021-12345678" /></div>
          <div><label>ایمیل</label><input name="contact_email" value={s.contact_email} class="ltr" maxlength={100} placeholder="support@example.com" /></div>
        </div>
        <label>آدرس</label>
        <input name="contact_address" value={s.contact_address} maxlength={200} />
        <div class="two">
          <div><label>اینستاگرام</label><input name="social_instagram" value={s.social_instagram} class="ltr" placeholder="@kadoochi" /></div>
          <div><label>کانال تلگرام</label><input name="social_telegram" value={s.social_telegram} class="ltr" placeholder="@kadoochi" /></div>
          <div><label>کانال بله</label><input name="social_bale" value={s.social_bale} class="ltr" placeholder="@kadoochi" /></div>
          <div><label>ایکس (توییتر)</label><input name="social_x" value={s.social_x} class="ltr" placeholder="@kadoochi" /></div>
          <div><label>لینکدین (نام صفحه شرکت یا لینک)</label><input name="social_linkedin" value={s.social_linkedin} class="ltr" /></div>
          <div><label>یوتیوب</label><input name="social_youtube" value={s.social_youtube} class="ltr" placeholder="@kadoochi" /></div>
          <div><label>آپارات</label><input name="social_aparat" value={s.social_aparat} class="ltr" placeholder="kadoochi" /></div>
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

        <p style="margin-top:20px"><button>ذخیره</button></p>
      </form>
    </Layout>
  );
}
