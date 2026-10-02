import { formatJalali } from "../../../lib/jalali";
import { CITIES } from "../cities";
import { STATUS_LABEL, toman, type ItemView, type Order, type Wishlist } from "../db";
import type { User } from "../../session";
import { Errors, Layout, Thumb } from "./layout";

export function CodeLoginPage(props: {
  next: string;
  step: "phone" | "code" | "unavailable";
  phone?: string;
  isNew?: boolean;
  name?: string;
  error?: string;
  setupOpen?: boolean;
}) {
  return (
    <Layout title="ورود / ثبت‌نام" user={null}>
      <div class="card" style="max-width:400px;margin:40px auto">
        <h1>ورود / ثبت‌نام</h1>
        <Errors errors={[props.error]} />
        {props.step === "unavailable" ? (
          <div class="warnbox">
            ورود فعلاً ممکن نیست: سرویس ارسال کد بله (سفیر) هنوز راه‌اندازی نشده است.
            {props.setupOpen && <> مدیر سایت: <a href="/setup">راه‌اندازی</a></>}
          </div>
        ) : props.step === "phone" ? (
          <form method="post" action="/login">
            <input type="hidden" name="next" value={props.next} />
            <p class="muted small" style="margin-top:0">کد ورود در پیام‌رسان بله برایتان ارسال می‌شود. اگر حساب ندارید، همین‌جا ساخته می‌شود.</p>
            <label>شماره موبایل</label>
            <input name="phone" value={props.phone ?? ""} class="ltr" inputmode="tel" autocomplete="tel" required autofocus />
            <p><button>ارسال کد</button></p>
          </form>
        ) : (
          <form method="post" action="/login/verify">
            <input type="hidden" name="next" value={props.next} />
            <input type="hidden" name="phone" value={props.phone} />
            <p class="muted small" style="margin-top:0">
              کد ۶ رقمی به بله شماره <span class="dt">{props.phone}</span> ارسال شد. <a href={`/login?next=${encodeURIComponent(props.next)}`}>تغییر شماره</a>
            </p>
            <label>کد</label>
            <input name="code" class="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength={6} required autofocus />
            {props.isNew && (
              <>
                <label>نام و نام خانوادگی (حساب جدید)</label>
                <input name="name" value={props.name ?? ""} required maxlength={80} />
              </>
            )}
            <p><button>{props.isNew ? "ساخت حساب و ورود" : "ورود"}</button></p>
          </form>
        )}
      </div>
    </Layout>
  );
}

export function ConnectPage(props: { user: User; next: string; links: { kind: string; url: string }[] }) {
  const label: Record<string, string> = { bale: "اتصال با بله", telegram: "اتصال با تلگرام" };
  const script = `
    (function poll(){
      fetch('/connect/status',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{
        if(d.connected){location.href=${JSON.stringify(props.next)};}
        else if(${props.links.length ? "false" : "d.bots>0"}){location.reload();}
        else{setTimeout(poll,3000);}
      }).catch(()=>setTimeout(poll,5000));
    })();`;
  return (
    <Layout title="اتصال به بات" user={props.user}>
      <div class="card" style="max-width:480px;margin:40px auto;text-align:center">
        <div style="font-size:44px">🤖</div>
        <h1>یک قدم مانده: اتصال به بات</h1>
        <p>
          سفارش‌ها، فیش‌های واریز و همه اطلاع‌رسانی‌ها از طریق بات برایتان ارسال می‌شود. یکی از دکمه‌های زیر را بزنید و در بات
          «شروع» (Start) را بزنید.
        </p>
        {!props.links.length && (
          <div class="warnbox">بات سایت هنوز راه‌اندازی نشده است. کمی بعد دوباره سر بزنید؛ این صفحه خودکار ادامه می‌دهد.</div>
        )}
        <div class="row" style="justify-content:center;margin:18px 0">
          {props.links.map((l) => (
            <a class="btn" href={l.url} target="_blank" rel="noopener">{label[l.kind] ?? l.kind}</a>
          ))}
        </div>
        <p class="muted small">بعد از زدن «شروع» در بات، این صفحه خودکار ادامه می‌دهد. <a href={`/connect?next=${encodeURIComponent(props.next)}`}>بررسی دوباره</a></p>
        <form method="post" action="/logout" style="margin-top:20px"><button class="secondary small">خروج از حساب</button></form>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
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
            <label>شهر گیرنده</label>
            <input name="city" value={v.city ?? ""} list="cities" required maxlength={40} placeholder="مثلاً تهران" autocomplete="off" />
            <datalist id="cities">{CITIES.map((c) => <option value={c} />)}</datalist>
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
                <div class="small muted">{it.bought} از {it.quantity} خریده شده{it.size && ` · سایز: ${it.size}`}{it.note && ` · یادداشت: ${it.note}`}</div>
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
