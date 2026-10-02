import { formatJalali } from "../../../lib/jalali";
import { formatCard } from "../../../lib/normalize";
import { mask, type Settings } from "../../settings";
import { CITIES } from "../cities";
import { STATUS_LABEL, toman, type Order, type Product, type ProductImage, type ProductPackage, type Shop } from "../db";
import { DELIVERY_LABEL } from "../notify";
import type { User } from "../../session";
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

function Tabs(props: { on: string }) {
  const tabs = [["/panel", "سفارش‌ها"], ["/panel/products", "محصولات"], ["/panel/settings", "تنظیمات و اطلاع‌رسانی"]];
  return (
    <nav class="tabs">
      {tabs.map(([href, label]) => <a href={href} class={props.on === href ? "on" : ""}>{label}</a>)}
    </nav>
  );
}

function ShopHeader(props: { shop: Shop }) {
  const s = props.shop;
  return (
    <>
      <div class="row" style="margin-bottom:12px">
        <h1 style="margin:0">{s.name}</h1>
        <span class={`tag ${s.status === "approved" ? "ok" : ""}`}>{SHOP_STATUS[s.status]}</span>
        <span class="sp" />
        <a href={`/s/${s.slug}`}>صفحه عمومی فروشگاه</a>
      </div>
      {s.status === "pending" && <div class="warnbox">فروشگاه در انتظار تأیید است. می‌توانید محصولات را اضافه کنید؛ بعد از تأیید نمایش داده می‌شوند.</div>}
      {s.status === "suspended" && <div class="errbox">فروشگاه معلق است و محصولاتش نمایش داده نمی‌شود.</div>}
      {!s.card_number && (
        <div class="errbox">تا شماره کارت را در <a href="/panel/settings">تنظیمات</a> وارد نکنید، کسی نمی‌تواند محصولات شما را بخرد.</div>
      )}
      {!s.city && <div class="errbox">شهر فروشگاه و روش‌های ارسال را در <a href="/panel/settings">تنظیمات</a> مشخص کنید.</div>}
    </>
  );
}

export const ORDER_FILTERS: [string, string][] = [
  ["awaiting", "در انتظار تأیید واریز"],
  ["todo", "آماده ارسال"],
  ["shipped", "ارسال‌شده"],
  ["rejected", "ردشده"],
];

export function OrdersPage(props: { user: User; shop: Shop; orders: Order[]; filter: string; counts: Record<string, number> }) {
  return (
    <Layout title="پنل فروشگاه" user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel" />
      <div class="row" style="margin-bottom:10px">
        {ORDER_FILTERS.map(([f, l]) => {
          const label = `${l}${props.counts[f] ? ` (${props.counts[f]})` : ""}`;
          return props.filter === f ? <b>{label}</b> : <a href={`/panel?f=${f}`}>{label}</a>;
        })}
      </div>
      <div class="card wrap">
        {props.orders.length === 0 ? (
          <p class="muted">سفارشی نیست.</p>
        ) : (
          <table>
            <thead><tr><th>#</th><th>محصول</th><th>خریدار</th><th>مبلغ</th><th>ارسال</th><th>وضعیت</th><th>زمان ارسال فیش</th></tr></thead>
            <tbody>
              {props.orders.map((o) => (
                <tr>
                  <td><a href={`/panel/orders/${o.id}`}>#{o.id}</a></td>
                  <td>{o.product_title}</td>
                  <td>{o.giver_name}</td>
                  <td class="price">{toman(o.amount)}</td>
                  <td>{DELIVERY_LABEL[o.delivery_method] ?? "—"}</td>
                  <td><span class={`tag ${o.status === "shipped" || o.status === "delivered" ? "ok" : ""}`}>{STATUS_LABEL[o.status]}</span></td>
                  <td class="muted"><span class="dt">{formatJalali(o.reported_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}

export function OrderDetailPage(props: { user: User; shop: Shop; order: Order; saved?: string }) {
  const o = props.order;
  const confirmed = o.status === "paid" || o.status === "shipped" || o.status === "delivered";
  return (
    <Layout title={`سفارش #${o.id}`} user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel" />
      {props.saved && <div class="okbox">{props.saved}</div>}
      <div class="two">
        <div class="card">
          <h2>سفارش #{o.id} <span class="tag">{STATUS_LABEL[o.status]}</span></h2>
          <p>
            محصول: <b>{o.product_title}</b> — {toman(o.item_price)}
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
          <p>خریدار: {o.giver_name} — <span class="dt">{o.giver_phone}</span>{o.is_anonymous ? " (نامش روی کارت هدیه نیاید)" : ""}</p>
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
          {o.status === "rejected" && <p class="errbox">رد شد{o.reject_reason ? `: ${o.reject_reason}` : ""}</p>}
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
    </Layout>
  );
}

export function ProductsPage(props: { user: User; shop: Shop; products: Product[] }) {
  return (
    <Layout title="محصولات" user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel/products" />
      <p><a class="btn" href="/panel/products/new">+ محصول جدید</a></p>
      <div class="card">
        {props.products.length === 0 && <p class="muted">هنوز محصولی ثبت نشده.</p>}
        {props.products.map((p) => (
          <div class="item">
            <Thumb imageKey={p.image_key} alt={p.title} />
            <div class="body">
              <a href={`/panel/products/${p.id}`}><b>{p.title}</b></a>
              <div class="price">{toman(p.price)}</div>
            </div>
            <span class={`tag ${p.is_active ? "ok" : ""}`}>{p.is_active ? "فعال" : "غیرفعال"}</span>
          </div>
        ))}
      </div>
    </Layout>
  );
}

export function ProductFormPage(props: {
  user: User;
  shop: Shop;
  product: Product | null;
  values: Record<string, string>;
  images?: ProductImage[];
  packages?: ProductPackage[];
  errors?: string[];
}) {
  const p = props.product;
  const v = props.values;
  const pkgs = [...(props.packages ?? []), ...Array.from({ length: 3 }, () => ({ id: 0, name: "", price: 0 }))];
  return (
    <Layout title={p ? p.title : "محصول جدید"} user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel/products" />
      {v.saved && <div class="okbox">ذخیره شد.</div>}
      <Errors errors={props.errors} />
      <form method="post" action={p ? `/panel/products/${p.id}` : "/panel/products/new"} enctype="multipart/form-data">
        <div class="card two">
          <div>
            <label style="margin-top:0">عنوان محصول</label>
            <input name="title" value={v.title ?? ""} required maxlength={120} />
            <label>قیمت (تومان)</label>
            <input name="price" value={v.price ?? ""} class="ltr" inputmode="numeric" required />
            <label>توضیحات</label>
            <textarea name="description" maxlength={3000} style="min-height:140px">{v.description ?? ""}</textarea>
            <label>لینک ویدیو (پست اینستاگرام، کانال تلگرام یا بله)</label>
            <input name="video_url" value={v.video_url ?? ""} class="ltr" placeholder="https://instagram.com/p/... یا https://t.me/channel/123" maxlength={300} />
            <label class="row" style="color:var(--text)">
              <input type="checkbox" name="is_active" value="1" style="width:auto" checked={v.is_active !== "0"} /> فعال (نمایش در سایت)
            </label>
          </div>
          <div>
            <label style="margin-top:0">عکس‌ها (تا ۸ عکس، هر کدام حداکثر ۳ مگابایت؛ اولی عکس اصلی است)</label>
            {!!props.images?.length && (
              <div class="row" style="margin-bottom:8px">
                {props.images.map((img) => (
                  <label style="text-align:center;margin:0">
                    <img src={`/img/${img.image_key}`} alt="" style="width:84px;height:84px;object-fit:cover;border-radius:8px;display:block" />
                    <input type="checkbox" name="delete_image" value={String(img.id)} style="width:auto" /> حذف
                  </label>
                ))}
              </div>
            )}
            <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple />
          </div>
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
    </Layout>
  );
}

export function SettingsPage(props: { user: User; shop: Shop; error?: string; ok?: string }) {
  const s = props.shop;
  const u = props.user;
  return (
    <Layout title="تنظیمات" user={props.user}>
      <ShopHeader shop={s} />
      <Tabs on="/panel/settings" />
      <Errors errors={[props.error]} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      <form method="post" action="/panel/settings" class="card">
        <h2>اطلاع‌رسانی</h2>
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
            <label class="row" style="color:var(--text)">
              <input type="checkbox" name="courier_enabled" value="1" style="width:auto" checked={!!s.courier_enabled} /> ارسال با پیک (فقط داخل شهر خودتان)
            </label>
            <label>هزینه پیک (تومان)</label>
            <input name="courier_fee" value={String(s.courier_fee)} class="ltr" inputmode="numeric" />
          </div>
          <div>
            <label class="row" style="color:var(--text)">
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
    </Layout>
  );
}

export function AdminPage(props: {
  user: User;
  shops: (Shop & { owner_name: string; owner_phone: string; products: number })[];
  stats: { shop_id: number; name: string; orders: number; total: number; unsent: number }[];
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
          <label class="row" style="color:var(--text)">
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
