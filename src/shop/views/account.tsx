import { formatJalali } from "../../../lib/jalali";
import { STATUS_LABEL, toman, type ItemView, type Order, type Wishlist } from "../db";
import type { User } from "../../session";
import { Errors, Layout, Thumb } from "./layout";

export function LoginPage(props: { next: string; error?: string; phone?: string }) {
  return (
    <Layout title="ورود" user={null}>
      <div class="card" style="max-width:400px;margin:40px auto">
        <h1>ورود</h1>
        <Errors errors={[props.error]} />
        <form method="post" action="/login">
          <input type="hidden" name="next" value={props.next} />
          <label>شماره موبایل</label>
          <input name="phone" value={props.phone ?? ""} class="ltr" inputmode="tel" autocomplete="username" required autofocus />
          <label>رمز عبور</label>
          <input name="password" type="password" class="ltr" autocomplete="current-password" required />
          <p><button>ورود</button></p>
        </form>
        <p class="small">حساب ندارید؟ <a href={`/register?next=${encodeURIComponent(props.next)}`}>ثبت‌نام</a></p>
      </div>
    </Layout>
  );
}

export function RegisterPage(props: { next: string; errors?: string[]; values?: Record<string, string> }) {
  const v = props.values ?? {};
  return (
    <Layout title="ثبت‌نام" user={null}>
      <div class="card" style="max-width:400px;margin:40px auto">
        <h1>ثبت‌نام</h1>
        <Errors errors={props.errors} />
        <form method="post" action="/register">
          <input type="hidden" name="next" value={props.next} />
          <label>نام و نام خانوادگی</label>
          <input name="name" value={v.name ?? ""} required maxlength={80} />
          <label>شماره موبایل</label>
          <input name="phone" value={v.phone ?? ""} class="ltr" inputmode="tel" autocomplete="username" required />
          <label>رمز عبور (حداقل ۸ کاراکتر)</label>
          <input name="password" type="password" class="ltr" minlength={8} autocomplete="new-password" required />
          <p><button>ثبت‌نام</button></p>
        </form>
      </div>
    </Layout>
  );
}

export function MyWishlistsPage(props: { user: User; lists: (Wishlist & { items: number })[]; siteUrl: string }) {
  return (
    <Layout title="لیست‌های آرزوی من" user={props.user}>
      <div class="row" style="margin-bottom:14px">
        <h1 style="margin:0">لیست‌های آرزوی من</h1>
        <span class="sp" />
        <a class="btn" href="/me/wishlists/new">+ لیست جدید</a>
      </div>
      {props.lists.length === 0 && <div class="card muted">هنوز لیستی نساخته‌اید. یک لیست بسازید و از صفحه محصولات آرزوهایتان را اضافه کنید.</div>}
      {props.lists.map((w) => (
        <div class="card">
          <div class="row">
            <h2 style="margin:0"><a href={`/me/wishlists/${w.id}`}>{w.title}</a></h2>
            <span class="tag">{w.items} آرزو</span>
            {!w.is_open && <span class="tag">بسته</span>}
          </div>
          <div class="share" style="margin-top:10px">
            <input readonly value={`${props.siteUrl}/w/${w.slug}`} onclick="this.select()" />
            <a class="btn small secondary" href={`/w/${w.slug}`}>نمایش</a>
          </div>
        </div>
      ))}
    </Layout>
  );
}

export function WishlistFormPage(props: {
  user: User;
  wishlist: Wishlist | null;
  values: Record<string, string>;
  errors?: string[];
  productId?: string;
  items?: ItemView[];
  gifts?: Order[];
  siteUrl: string;
  saved?: boolean;
}) {
  const w = props.wishlist;
  const v = props.values;
  const action = w ? `/me/wishlists/${w.id}` : "/me/wishlists/new";
  return (
    <Layout title={w ? w.title : "لیست جدید"} user={props.user}>
      <h1>{w ? `ویرایش «${w.title}»` : "ساخت لیست آرزو"}</h1>
      {props.saved && <div class="okbox">ذخیره شد.</div>}
      {w && (
        <div class="card">
          <label style="margin-top:0">لینک اشتراک‌گذاری (برای دوستان بفرستید)</label>
          <div class="share">
            <input readonly value={`${props.siteUrl}/w/${w.slug}`} onclick="this.select()" />
            <a class="btn small secondary" href={`/w/${w.slug}`}>نمایش</a>
          </div>
        </div>
      )}
      <Errors errors={props.errors} />
      <form method="post" action={action} class="card">
        {props.productId && <input type="hidden" name="product" value={props.productId} />}
        <div class="two">
          <div>
            <h2>مشخصات لیست</h2>
            <label>عنوان</label>
            <input name="title" value={v.title ?? ""} placeholder="مثلاً: تولد ۳۰ سالگی" required maxlength={100} />
            <label>توضیح برای دوستان (اختیاری)</label>
            <textarea name="description" maxlength={500}>{v.description ?? ""}</textarea>
            <label>تاریخ مناسبت (اختیاری)</label>
            <input name="occasion_date" value={v.occasion_date ?? ""} placeholder="1405/08/15" class="ltr" maxlength={20} />
            {w && (
              <label class="row" style="color:var(--text)">
                <input type="checkbox" name="is_open" value="1" style="width:auto" checked={v.is_open === "1"} /> لیست باز است (امکان خرید)
              </label>
            )}
          </div>
          <div>
            <h2>اطلاعات ارسال 🔒</h2>
            <p class="muted small" style="margin-top:0">فقط فروشگاه، آن هم بعد از خرید، این اطلاعات را می‌بیند. به خریداران نمایش داده نمی‌شود.</p>
            <label>نام گیرنده</label>
            <input name="recipient_name" value={v.recipient_name ?? ""} required maxlength={80} />
            <label>موبایل گیرنده</label>
            <input name="recipient_phone" value={v.recipient_phone ?? ""} class="ltr" inputmode="tel" required />
            <label>آدرس کامل</label>
            <textarea name="address" required maxlength={400}>{v.address ?? ""}</textarea>
            <label>کد پستی</label>
            <input name="postal_code" value={v.postal_code ?? ""} class="ltr" inputmode="numeric" required />
          </div>
        </div>
        <p><button>{w ? "ذخیره" : "ساخت لیست"}</button></p>
      </form>

      {w && (
        <div class="card">
          <h2>آرزوها</h2>
          {!props.items?.length && <p class="muted">خالی است. از <a href="/">صفحه محصولات</a> اضافه کنید.</p>}
          {props.items?.map((it) => (
            <div class="item">
              <Thumb imageKey={it.image_key} alt={it.title} />
              <div class="body">
                <a href={`/p/${it.product_id}`}><b>{it.title}</b></a> <span class="muted small">· {it.shop_name}</span>
                <div class="price">{toman(it.price)}</div>
                <div class="small muted">{it.bought} از {it.quantity} خریده شده{it.note && ` · یادداشت: ${it.note}`}</div>
              </div>
              {it.bought === 0 && it.reserved === 0 ? (
                <form method="post" action={`/me/items/${it.id}/delete`}>
                  <button class="secondary small">حذف</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {w && !!props.gifts?.length && (
        <div class="card wrap">
          <h2>کادوهایی که گرفته‌اید 🎉</h2>
          <table>
            <thead><tr><th>کادو</th><th>از طرف</th><th>پیام</th><th>وضعیت</th><th>زمان</th></tr></thead>
            <tbody>
              {props.gifts.map((o) => (
                <tr>
                  <td>{o.product_title}</td>
                  <td>{o.is_anonymous ? "ناشناس" : o.giver_name}</td>
                  <td style="white-space:pre-wrap">{o.gift_message || "—"}</td>
                  <td><span class="tag">{STATUS_LABEL[o.status]}</span>{o.tracking_code && <div class="small">کد رهگیری: <span class="dt">{o.tracking_code}</span></div>}</td>
                  <td class="muted"><span class="dt">{formatJalali(o.paid_at, false)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
