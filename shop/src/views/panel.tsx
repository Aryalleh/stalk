import { formatJalali } from "../../../lib/jalali";
import { STATUS_LABEL, toman, type Order, type Product, type Shop } from "../db";
import type { User } from "../session";
import { Errors, Layout, Thumb } from "./layout";

const SHOP_STATUS: Record<Shop["status"], string> = { pending: "در انتظار تأیید", approved: "فعال", suspended: "معلق" };

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
      {!s.bale_chat_id && !s.telegram_chat_id && (
        <div class="warnbox">برای دریافت فوری پیام سفارش‌های جدید، در <a href="/panel/settings">تنظیمات</a> بات بله یا تلگرام را وصل کنید.</div>
      )}
    </>
  );
}

export function OrdersPage(props: { user: User; shop: Shop; orders: Order[]; filter: string }) {
  const filters = [["todo", "آماده ارسال"], ["shipped", "ارسال‌شده"], ["all", "همه پرداخت‌شده‌ها"]];
  return (
    <Layout title="پنل فروشگاه" user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel" />
      <div class="row" style="margin-bottom:10px">
        {filters.map(([f, l]) => (props.filter === f ? <b>{l}</b> : <a href={`/panel?f=${f}`}>{l}</a>))}
      </div>
      <div class="card wrap">
        {props.orders.length === 0 ? (
          <p class="muted">سفارشی نیست.</p>
        ) : (
          <table>
            <thead><tr><th>#</th><th>محصول</th><th>گیرنده</th><th>مبلغ</th><th>وضعیت</th><th>زمان پرداخت</th></tr></thead>
            <tbody>
              {props.orders.map((o) => (
                <tr>
                  <td><a href={`/panel/orders/${o.id}`}>#{o.id}</a></td>
                  <td>{o.product_title}</td>
                  <td>{o.ship_name}</td>
                  <td class="price">{toman(o.amount)}</td>
                  <td><span class={`tag ${o.status === "paid" ? "" : "ok"}`}>{STATUS_LABEL[o.status]}</span></td>
                  <td class="muted"><span class="dt">{formatJalali(o.paid_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}

export function OrderDetailPage(props: { user: User; shop: Shop; order: Order; error?: string; saved?: boolean }) {
  const o = props.order;
  return (
    <Layout title={`سفارش #${o.id}`} user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel" />
      {props.saved && <div class="okbox">ذخیره شد.</div>}
      <Errors errors={[props.error]} />
      <div class="two">
        <div class="card">
          <h2>سفارش #{o.id} <span class="tag">{STATUS_LABEL[o.status]}</span></h2>
          <p>محصول: <b>{o.product_title}</b> — <span class="price">{toman(o.amount)}</span></p>
          <p>زمان پرداخت: <span class="dt">{formatJalali(o.paid_at)}</span><br />کد پیگیری پرداخت: <span class="dt">{o.pay_ref_id}</span></p>
          <p>از طرف: {o.is_anonymous ? "ناشناس (نام روی کارت نیاید)" : o.giver_name}</p>
          {o.gift_message && <p>پیام کارت هدیه:<br /><span style="white-space:pre-wrap">{o.gift_message}</span></p>}
        </div>
        <div class="card">
          <h2>ارسال به 📦</h2>
          <p>
            {o.ship_name}<br />
            <span class="dt">{o.ship_phone}</span><br />
            <span style="white-space:pre-wrap">{o.ship_address}</span><br />
            کد پستی: <span class="dt">{o.ship_postal_code}</span>
          </p>
          {o.status === "paid" || o.status === "shipped" ? (
            <form method="post" action={`/panel/orders/${o.id}/ship`}>
              <label>کد رهگیری مرسوله</label>
              <input name="tracking_code" value={o.tracking_code} class="ltr" maxlength={60} />
              <p><button>{o.status === "paid" ? "ثبت «ارسال شد»" : "به‌روزرسانی کد رهگیری"}</button></p>
            </form>
          ) : null}
          {o.status === "shipped" && (
            <form method="post" action={`/panel/orders/${o.id}/delivered`}>
              <button class="secondary">تحویل داده شد</button>
            </form>
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

export function ProductFormPage(props: { user: User; shop: Shop; product: Product | null; values: Record<string, string>; errors?: string[] }) {
  const p = props.product;
  const v = props.values;
  return (
    <Layout title={p ? p.title : "محصول جدید"} user={props.user}>
      <ShopHeader shop={props.shop} />
      <Tabs on="/panel/products" />
      <Errors errors={props.errors} />
      <form method="post" action={p ? `/panel/products/${p.id}` : "/panel/products/new"} enctype="multipart/form-data" class="card two">
        <div>
          <label style="margin-top:0">عنوان محصول</label>
          <input name="title" value={v.title ?? ""} required maxlength={120} />
          <label>قیمت (تومان)</label>
          <input name="price" value={v.price ?? ""} class="ltr" inputmode="numeric" required />
          <label>توضیحات</label>
          <textarea name="description" maxlength={3000} style="min-height:140px">{v.description ?? ""}</textarea>
          <label class="row" style="color:var(--text)">
            <input type="checkbox" name="is_active" value="1" style="width:auto" checked={v.is_active !== "0"} /> فعال (نمایش در سایت)
          </label>
        </div>
        <div>
          <label style="margin-top:0">تصویر (JPG/PNG/WebP، حداکثر ۲ مگابایت)</label>
          {p && <div style="max-width:220px;margin-bottom:8px"><Thumb imageKey={p.image_key} alt={p.title} /></div>}
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp" />
          <p style="margin-top:24px"><button>{p ? "ذخیره" : "ثبت محصول"}</button></p>
        </div>
      </form>
    </Layout>
  );
}

export function SettingsPage(props: { user: User; shop: Shop; bots: { bale: boolean; telegram: boolean }; error?: string; ok?: string }) {
  const s = props.shop;
  return (
    <Layout title="تنظیمات" user={props.user}>
      <ShopHeader shop={s} />
      <Tabs on="/panel/settings" />
      <Errors errors={[props.error]} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      <form method="post" action="/panel/settings" class="card">
        <h2>اطلاع‌رسانی سفارش جدید</h2>
        <p class="muted small" style="margin-top:0">
          به بات سایت در بله یا تلگرام پیام <code>/start</code> بدهید؛ بات «شناسه چت» شما را جواب می‌دهد. آن را اینجا وارد کنید.
        </p>
        <div class="two">
          <div>
            <label>شناسه چت بله {!props.bots.bale && <span class="tag">بات بله روی سایت فعال نیست</span>}</label>
            <input name="bale_chat_id" value={s.bale_chat_id} class="ltr" maxlength={40} />
          </div>
          <div>
            <label>شناسه چت تلگرام {!props.bots.telegram && <span class="tag">بات تلگرام روی سایت فعال نیست</span>}</label>
            <input name="telegram_chat_id" value={s.telegram_chat_id} class="ltr" maxlength={40} />
          </div>
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
          <button class="secondary" formaction="/panel/settings/test">ارسال پیام آزمایشی</button>
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

export function SetupPage(props: { configured: boolean; error?: string }) {
  return (
    <Layout title="راه‌اندازی" user={null}>
      <div class="card" style="max-width:420px;margin:40px auto">
        <h1>ساخت مدیر پلتفرم</h1>
        {!props.configured ? (
          <p class="errbox">ابتدا secret به نام <code>SETUP_TOKEN</code> را تنظیم کنید.</p>
        ) : (
          <form method="post" action="/setup">
            <Errors errors={[props.error]} />
            <label>SETUP_TOKEN</label>
            <input name="token" type="password" class="ltr" required />
            <label>نام</label>
            <input name="name" required />
            <label>شماره موبایل</label>
            <input name="phone" class="ltr" required />
            <label>رمز عبور (حداقل ۱۰ کاراکتر)</label>
            <input name="password" type="password" class="ltr" minlength={10} required />
            <p><button>ساخت</button></p>
          </form>
        )}
      </div>
    </Layout>
  );
}
