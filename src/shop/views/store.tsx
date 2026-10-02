import { formatJalali } from "../../../lib/jalali";
import { formatCard } from "../../../lib/normalize";
import { STATUS_LABEL, toman, type ItemView, type Order, type ProductWithShop, type Shop, type Wishlist } from "../db";
import type { User } from "../../session";
import { Errors, Layout, Thumb } from "./layout";

function ProductGrid(props: { products: ProductWithShop[] }) {
  if (!props.products.length) return <p class="muted">محصولی پیدا نشد.</p>;
  return (
    <div class="products">
      {props.products.map((p) => (
        <a class="product" href={`/p/${p.id}`}>
          <Thumb imageKey={p.image_key} alt={p.title} />
          <div class="info">
            <div class="title">{p.title}</div>
            <div class="price">{toman(p.price)}</div>
            <div class="muted small">{p.shop_name}</div>
          </div>
        </a>
      ))}
    </div>
  );
}

function Pager(props: { page: number; hasNext: boolean; base: string }) {
  const sep = props.base.includes("?") ? "&" : "?";
  return (
    <div class="row" style="margin-top:16px">
      {props.page > 1 && <a href={`${props.base}${sep}page=${props.page - 1}`}>« قبلی</a>}
      {props.hasNext && <a href={`${props.base}${sep}page=${props.page + 1}`}>بعدی »</a>}
    </div>
  );
}

export function HomePage(props: { user: User | null; q: string; products: ProductWithShop[]; page: number; hasNext: boolean }) {
  return (
    <Layout title="کادو بگیر، آرزو بساز" user={props.user}>
      <div class="card">
        <h1>لیست آرزوهایت را بساز، لینکش را بفرست، کادو بگیر 🎁</h1>
        <p class="muted" style="margin-top:0">
          محصولات دلخواهت را به لیست آرزو اضافه کن و لینکش را برای دوستان و خانواده بفرست. هر کس یکی از آرزوها را بخرد،
          فروشگاه مستقیم برایت ارسال می‌کند — بدون اینکه آدرست را به کسی بدهی.
        </p>
        <form method="get" action="/" class="row">
          <input name="q" value={props.q} placeholder="جستجوی محصول یا فروشگاه" style="flex:1;min-width:200px" />
          <button>جستجو</button>
        </form>
      </div>
      <ProductGrid products={props.products} />
      <Pager page={props.page} hasNext={props.hasNext} base={props.q ? `/?q=${encodeURIComponent(props.q)}` : "/"} />
    </Layout>
  );
}

export function ProductPage(props: {
  user: User | null;
  product: ProductWithShop;
  wishlists: Wishlist[];
  added?: string;
  error?: string;
}) {
  const p = props.product;
  return (
    <Layout title={p.title} user={props.user}>
      <div class="card two">
        <Thumb imageKey={p.image_key} alt={p.title} />
        <div>
          <h1>{p.title}</h1>
          <div class="price" style="font-size:20px">{toman(p.price)}</div>
          <p>
            فروشگاه: <a href={`/s/${p.shop_slug}`}>{p.shop_name}</a>
          </p>
          <p style="white-space:pre-wrap">{p.description}</p>
          {props.added && <div class="okbox">به لیست «{props.added}» اضافه شد. <a href="/me/wishlists">مشاهده لیست‌ها</a></div>}
          <Errors errors={[props.error]} />
          {!props.user ? (
            <a class="btn" href={`/login?next=/p/${p.id}`}>برای افزودن به لیست آرزو وارد شوید</a>
          ) : props.wishlists.length === 0 ? (
            <a class="btn" href={`/me/wishlists/new?product=${p.id}`}>ساخت لیست آرزو و افزودن این محصول</a>
          ) : (
            <form method="post" action={`/p/${p.id}/wish`} class="card" style="background:var(--bg)">
              <h2>افزودن به لیست آرزو</h2>
              <label>لیست</label>
              <select name="wishlist_id">
                {props.wishlists.map((w) => <option value={String(w.id)}>{w.title}</option>)}
              </select>
              <div class="row">
                <div style="width:110px"><label>تعداد</label><input name="quantity" type="number" min="1" max="20" value="1" /></div>
                <div style="flex:1"><label>یادداشت (رنگ، سایز، ...)</label><input name="note" maxlength={200} /></div>
              </div>
              <p><button>❤ افزودن به آرزوها</button> <a class="small" href={`/me/wishlists/new?product=${p.id}`}>یا لیست جدید</a></p>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
}

export function ShopPage(props: { user: User | null; shop: Shop; products: ProductWithShop[] }) {
  return (
    <Layout title={props.shop.name} user={props.user}>
      <div class="card">
        <h1>{props.shop.name}</h1>
        <p class="muted" style="white-space:pre-wrap;margin:0">{props.shop.description}</p>
      </div>
      <ProductGrid products={props.products} />
    </Layout>
  );
}

function ItemProgress(props: { it: ItemView }) {
  const { quantity, bought } = props.it;
  const pct = Math.min(100, Math.round((bought / quantity) * 100));
  return (
    <div>
      <span class="small muted">{bought} از {quantity} خریده شده</span>
      <div class="bar"><span style={`width:${pct}%`} /></div>
    </div>
  );
}

export function WishlistPublicPage(props: {
  user: User | null;
  wishlist: Wishlist;
  ownerName: string;
  items: ItemView[];
  isOwner: boolean;
  shareUrl: string;
}) {
  const w = props.wishlist;
  return (
    <Layout title={w.title} user={props.user}>
      <div class="card">
        <h1>{w.title}</h1>
        <p class="muted" style="margin:0">
          لیست آرزوی <b>{props.ownerName}</b>
          {w.occasion_date && <> · مناسبت: {w.occasion_date}</>}
        </p>
        {w.description && <p style="white-space:pre-wrap">{w.description}</p>}
        {props.isOwner && (
          <div class="warnbox" style="margin-top:12px">
            این لیست خودتان است. لینک اشتراک:
            <div class="share" style="margin-top:6px">
              <input readonly value={props.shareUrl} onclick="this.select()" />
              <a class="btn small" href={`/me/wishlists/${w.id}`}>ویرایش</a>
            </div>
          </div>
        )}
        {!w.is_open && <div class="warnbox">این لیست بسته شده و فعلاً امکان خرید ندارد.</div>}
      </div>
      <div class="card">
        {props.items.length === 0 && <p class="muted">هنوز آرزویی اضافه نشده.</p>}
        {props.items.map((it) => {
          const done = it.bought >= it.quantity;
          const free = it.quantity - it.bought - it.reserved;
          const buyable = w.is_open && it.product_active && it.shop_ok && free > 0;
          return (
            <div class="item">
              <Thumb imageKey={it.image_key} alt={it.title} />
              <div class="body">
                <div><b>{it.title}</b> <span class="muted small">· {it.shop_name}</span></div>
                <div class="price">{toman(it.price)}</div>
                {it.note && <div class="small muted">یادداشت: {it.note}</div>}
                <ItemProgress it={it} />
              </div>
              <div>
                {done ? (
                  <span class="tag ok">✓ برآورده شد</span>
                ) : props.isOwner ? null : buyable ? (
                  <a class="btn" href={`/gift/${it.id}`}>🎁 این را می‌خرم</a>
                ) : it.reserved > 0 && free <= 0 ? (
                  <span class="tag">در حال خرید توسط شخص دیگر</span>
                ) : (
                  <span class="tag">فعلاً موجود نیست</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}

export function CheckoutPage(props: {
  user: User | null;
  item: ItemView;
  wishlist: Wishlist;
  ownerName: string;
  values?: Record<string, string>;
  errors?: string[];
}) {
  const v = props.values ?? {};
  const it = props.item;
  return (
    <Layout title="خرید کادو" user={props.user}>
      <div class="card two">
        <div>
          <h1>خرید کادو برای {props.ownerName}</h1>
          <div class="item">
            <Thumb imageKey={it.image_key} alt={it.title} />
            <div class="body">
              <b>{it.title}</b>
              <div class="price">{toman(it.price)}</div>
              <div class="muted small">{it.shop_name} · از لیست «{props.wishlist.title}»</div>
            </div>
          </div>
          <p class="muted small">
            پرداخت کارت به کارت مستقیم به حساب فروشگاه است. در مرحله بعد شماره کارت را می‌بینید و این آرزو چند دقیقه برای شما رزرو
            می‌شود. فروشگاه بعد از تأیید واریز، کادو را مستقیم به آدرس گیرنده می‌فرستد؛ آدرس گیرنده محرمانه است و به شما نمایش داده
            نمی‌شود.
          </p>
        </div>
        <form method="post" action={`/gift/${it.id}`}>
          <Errors errors={props.errors} />
          <label>نام شما</label>
          <input name="name" value={v.name ?? props.user?.name ?? ""} required maxlength={80} />
          <label>شماره موبایل شما</label>
          <input name="phone" value={v.phone ?? props.user?.phone ?? ""} class="ltr" inputmode="tel" required />
          <label>پیام روی کارت هدیه (اختیاری)</label>
          <textarea name="message" maxlength={300}>{v.message ?? ""}</textarea>
          <label class="row" style="color:var(--text)">
            <input type="checkbox" name="anonymous" value="1" style="width:auto" checked={v.anonymous === "1"} /> نامم به گیرنده نمایش داده نشود
          </label>
          <p><button>ادامه و دریافت شماره کارت</button></p>
        </form>
      </div>
    </Layout>
  );
}

export function OrderPage(props: {
  user: User | null;
  order: Order & { wishlist_slug: string; owner_name: string; card_holder: string; shop_name: string };
  errors?: string[];
  values?: Record<string, string>;
}) {
  const o = props.order;
  const v = props.values ?? {};
  const expired = o.status === "pending" && o.expires_at <= new Date().toISOString();
  const back = <a class="btn secondary" href={`/w/${o.wishlist_slug}`}>بازگشت به لیست آرزو</a>;
  return (
    <Layout title={`کادو برای ${o.owner_name}`} user={props.user}>
      <div class="card" style="max-width:640px;margin:20px auto">
        <h1>🎁 {o.product_title} برای {o.owner_name}</h1>
        <p class="muted" style="margin-top:0">
          سفارش #{o.id} · فروشگاه {o.shop_name} · <span class="tag">{STATUS_LABEL[o.status]}</span>
        </p>
        <p class="small muted">این صفحه مخصوص شماست؛ لینکش را نگه دارید تا وضعیت سفارش را ببینید.</p>

        {o.status === "pending" && (
          <>
            {expired && (
              <div class="warnbox">
                زمان رزرو تمام شده. اگر هنوز واریز نکرده‌اید، ممکن است شخص دیگری این آرزو را بخرد؛ اگر واریز کرده‌اید، مشخصاتش را وارد کنید.
              </div>
            )}
            <div class="card" style="background:var(--bg)">
              <h2>۱. مبلغ را کارت به کارت کنید</h2>
              <p>مبلغ: <b class="price" style="font-size:20px">{toman(o.amount)}</b></p>
              <p>
                به کارت:
                <br />
                <b class="dt" style="font-size:22px;letter-spacing:1px">{formatCard(o.pay_card_number)}</b>
                <br />
                به نام: <b>{o.card_holder}</b>
              </p>
              {!expired && <p class="small muted">این آرزو تا <span class="dt">{formatJalali(o.expires_at)}</span> برای شما رزرو است.</p>}
            </div>
            <form method="post" action={`/order/${o.token}/transfer`} enctype="multipart/form-data">
              <h2>۲. مشخصات واریز را وارد کنید</h2>
              <Errors errors={props.errors} />
              <label>شماره پیگیری</label>
              <input name="ref" value={v.ref ?? ""} class="ltr" inputmode="numeric" required />
              <label>۴ رقم آخر کارتی که از آن واریز کردید</label>
              <input name="last4" value={v.last4 ?? ""} class="ltr" inputmode="numeric" maxlength={4} required style="max-width:140px" />
              <label>زمان واریز (اختیاری)</label>
              <input name="at" value={v.at ?? ""} placeholder="مثلاً ۱۴:۳۰" maxlength={40} style="max-width:240px" />
              <label>عکس رسید (اختیاری)</label>
              <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp" />
              <p><button>ثبت واریز</button></p>
            </form>
          </>
        )}

        {o.status === "awaiting" && (
          <div class="okbox">
            واریز شما ثبت شد و برای فروشگاه ارسال شد. بعد از اینکه فروشگاه دریافت مبلغ را تأیید کند، کادو برای {o.owner_name} ارسال می‌شود.
            <div class="small">شماره پیگیری: <span class="dt">{o.transfer_ref}</span></div>
          </div>
        )}

        {(o.status === "paid" || o.status === "shipped" || o.status === "delivered") && (
          <div class="okbox">
            🎉 فروشگاه پرداخت را تأیید کرد{o.status === "paid" ? " و کادو به‌زودی ارسال می‌شود" : ""}. ممنون از مهربانی‌تان!
          </div>
        )}

        {o.status === "rejected" && (
          <div class="errbox">
            فروشگاه دریافت این واریز را تأیید نکرد{o.reject_reason ? `: ${o.reject_reason}` : "."} اگر مبلغ از حساب شما کم شده، با رسید با
            فروشگاه {o.shop_name} تماس بگیرید.
          </div>
        )}
        <p>{back}</p>
      </div>
    </Layout>
  );
}
