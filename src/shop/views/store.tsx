import { formatJalali } from "../../../lib/jalali";
import { formatCard } from "../../../lib/normalize";
import {
  STATUS_LABEL,
  deliveryOptions,
  toman,
  type DeliveryMethod,
  type ItemView,
  type Order,
  type ProductImage,
  type ProductPackage,
  type ProductWithShop,
  type Shop,
  type Wishlist,
} from "../db";
import { DELIVERY_LABEL } from "../notify";
import { readSizeGuide, type SizeGuide } from "../sizes";
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

/** Turn a pasted Instagram / Telegram / Bale link into a label for the video button. */
function videoLabel(url: string) {
  if (/instagram\.com/i.test(url)) return "▶ ویدیو در اینستاگرام";
  if (/(t\.me|telegram\.me)/i.test(url)) return "▶ ویدیو در تلگرام";
  if (/ble\.ir/i.test(url)) return "▶ ویدیو در بله";
  return "▶ مشاهده ویدیو";
}

function Gallery(props: { images: ProductImage[]; title: string }) {
  if (!props.images.length) return <Thumb imageKey="" alt={props.title} />;
  return (
    <div>
      <div class="thumb" style="border-radius:12px">
        <img id="gallery-main" src={`/img/${props.images[0].image_key}`} alt={props.title} />
      </div>
      {props.images.length > 1 && (
        <div class="row" style="margin-top:8px">
          {props.images.map((img) => (
            <img
              src={`/img/${img.image_key}`}
              alt=""
              loading="lazy"
              style="width:64px;height:64px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--line)"
              onclick="document.getElementById('gallery-main').src=this.src"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SizeGuideBox(props: { guide: SizeGuide | null; image: string }) {
  if (!props.guide && !props.image) return null;
  return (
    <details class="card" style="background:var(--bg)" open>
      <summary style="cursor:pointer"><b>📏 راهنمای سایز</b></summary>
      {props.guide && (
        <div class="wrap" style="margin-top:8px">
          <table>
            <thead><tr>{props.guide.columns.map((c) => <th>{c}</th>)}</tr></thead>
            <tbody>
              {props.guide.rows.map((r) => (
                <tr>{r.map((v, i) => (i === 0 ? <td><b>{v}</b></td> : <td>{v || "—"}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.image && <img src={`/img/${props.image}`} alt="جدول سایز" loading="lazy" style="max-width:100%;border-radius:8px;margin-top:8px" />}
    </details>
  );
}

export function ProductPage(props: {
  user: User | null;
  product: ProductWithShop;
  wishlists: Wishlist[];
  images: ProductImage[];
  packages: ProductPackage[];
  added?: string;
  error?: string;
}) {
  const p = props.product;
  const guide = readSizeGuide(p.size_guide);
  const sizes = guide?.rows.map((r) => r[0]) ?? [];
  return (
    <Layout title={p.title} user={props.user}>
      <div class="card two">
        <Gallery images={props.images} title={p.title} />
        <div>
          <h1>{p.title}</h1>
          <div class="price" style="font-size:20px">{toman(p.price)}</div>
          <p>
            فروشگاه: <a href={`/s/${p.shop_slug}`}>{p.shop_name}</a>
          </p>
          {p.video_url && (
            <p><a class="btn secondary" href={p.video_url} target="_blank" rel="noopener nofollow">{videoLabel(p.video_url)}</a></p>
          )}
          <p style="white-space:pre-wrap">{p.description}</p>
          <SizeGuideBox guide={guide} image={p.size_guide_image} />
          {props.packages.length > 0 && (
            <div class="card" style="background:var(--bg)">
              <b>بسته‌بندی‌های کادویی</b>
              {props.packages.map((k) => (
                <div class="row small"><span>{k.name}</span><span class="sp" /><span>{k.price ? toman(k.price) : "رایگان"}</span></div>
              ))}
              <div class="muted small">خریدار کادو هنگام خرید بسته‌بندی را انتخاب می‌کند.</div>
            </div>
          )}
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
              {sizes.length > 0 && (
                <>
                  <label>سایز</label>
                  <select name="size" required>
                    <option value="">انتخاب سایز…</option>
                    {sizes.map((z) => <option value={z}>{z}</option>)}
                  </select>
                </>
              )}
              <div class="row">
                <div style="width:110px"><label>تعداد</label><input name="quantity" type="number" min="1" max="20" value="1" /></div>
                <div style="flex:1"><label>یادداشت ({sizes.length ? "رنگ، ..." : "رنگ، سایز، ..."})</label><input name="note" maxlength={200} /></div>
              </div>
              <p><button>❤ افزودن به آرزوها</button> <a class="small" href={`/me/wishlists/new?product=${p.id}`}>یا لیست جدید</a></p>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
}

const SOCIALS: [keyof Shop, string, (v: string) => string][] = [
  ["instagram", "اینستاگرام", (v) => (v.startsWith("http") ? v : `https://instagram.com/${v.replace(/^@/, "")}`)],
  ["telegram", "تلگرام", (v) => (v.startsWith("http") ? v : `https://t.me/${v.replace(/^@/, "")}`)],
  ["bale", "بله", (v) => (v.startsWith("http") ? v : `https://ble.ir/${v.replace(/^@/, "")}`)],
  ["website", "وب‌سایت", (v) => (v.startsWith("http") ? v : `https://${v}`)],
];

export function ShopPage(props: { user: User | null; shop: Shop; products: ProductWithShop[]; preview?: boolean }) {
  const shop = props.shop;
  return (
    <Layout title={shop.name} user={props.user}>
      {props.preview && (
        <div class="warnbox">
          پیش‌نمایش: این فروشگاه هنوز تأیید نشده و فقط شما (و مدیر سایت) این صفحه را می‌بینید.
        </div>
      )}
      <div class="card">
        <h1>{shop.name}</h1>
        {shop.city && <p class="muted" style="margin:0">📍 {shop.city}</p>}
        <p class="muted" style="white-space:pre-wrap">{shop.description}</p>
        <div class="row">
          {SOCIALS.filter(([k]) => shop[k]).map(([k, label, url]) => (
            <a class="btn secondary small" href={url(String(shop[k]))} target="_blank" rel="noopener nofollow">{label}</a>
          ))}
        </div>
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
          const ships = deliveryOptions(
            { city: it.shop_city, courier_enabled: it.courier_enabled, courier_fee: it.courier_fee, post_enabled: it.post_enabled, post_fee: it.post_fee },
            w.city,
          ).length > 0;
          const buyable = w.is_open && it.product_active && it.shop_ok && ships && free > 0;
          return (
            <div class="item">
              <Thumb imageKey={it.image_key} alt={it.title} />
              <div class="body">
                <div><b>{it.title}</b> <span class="muted small">· {it.shop_name}</span></div>
                <div class="price">{toman(it.price)}</div>
                {it.size && <div class="small">سایز: <b>{it.size}</b></div>}
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
                ) : !ships && it.shop_ok ? (
                  <span class="tag">فروشگاه به شهر گیرنده ارسال ندارد</span>
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
  packages: ProductPackage[];
  delivery: { method: DeliveryMethod; fee: number }[];
  values?: Record<string, string>;
  errors?: string[];
}) {
  const v = props.values ?? {};
  const it = props.item;
  const pkgDefault = v.package ?? (props.packages[0] ? String(props.packages[0].id) : "");
  const shipDefault = v.delivery ?? props.delivery[0]?.method ?? "";
  // Live total as the giver picks options (server recomputes the real amount).
  const script = `
    (function(){
      var f=document.getElementById('checkout'); if(!f) return;
      function upd(){
        var t=${it.price};
        var p=f.querySelector('input[name=package]:checked'); if(p) t+=Number(p.dataset.price);
        var d=f.querySelector('input[name=delivery]:checked'); if(d) t+=Number(d.dataset.price);
        document.getElementById('total').textContent=t.toLocaleString('fa-IR')+' تومان';
      }
      f.addEventListener('change',upd); upd();
    })();`;
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
              {it.size && <div class="small">سایز: <b>{it.size}</b></div>}
              <div class="muted small">{it.shop_name} · از لیست «{props.wishlist.title}»</div>
            </div>
          </div>
          <p class="muted small">
            پرداخت کارت به کارت مستقیم به حساب فروشگاه است. در مرحله بعد شماره کارت را می‌بینید، مبلغ را واریز می‌کنید و فقط عکس فیش را
            می‌فرستید. فروشگاه بعد از تأیید، کادو را مستقیم به آدرس گیرنده می‌فرستد؛ آدرس گیرنده محرمانه است و به شما نمایش داده نمی‌شود.
          </p>
        </div>
        <form method="post" action={`/gift/${it.id}`} id="checkout">
          <Errors errors={props.errors} />
          {props.packages.length > 0 && (
            <>
              <label>بسته‌بندی کادو</label>
              {props.packages.map((k) => (
                <label class="row" style="color:var(--text);margin:4px 0">
                  <input type="radio" name="package" value={String(k.id)} data-price={String(k.price)} style="width:auto" checked={pkgDefault === String(k.id)} />
                  {k.name} — {k.price ? toman(k.price) : "رایگان"}
                </label>
              ))}
            </>
          )}
          <label>روش ارسال</label>
          {props.delivery.length === 0 ? (
            <div class="errbox">این فروشگاه به شهر گیرنده ارسال ندارد.</div>
          ) : (
            props.delivery.map((d) => (
              <label class="row" style="color:var(--text);margin:4px 0">
                <input type="radio" name="delivery" value={d.method} data-price={String(d.fee)} style="width:auto" checked={shipDefault === d.method} />
                {DELIVERY_LABEL[d.method]} — {d.fee ? toman(d.fee) : "رایگان"}
              </label>
            ))
          )}
          <label>نام شما</label>
          <input name="name" value={v.name ?? props.user?.name ?? ""} required maxlength={80} />
          <label>شماره موبایل شما</label>
          <input name="phone" value={v.phone ?? props.user?.phone ?? ""} class="ltr" inputmode="tel" required />
          <label>پیام روی کارت هدیه (اختیاری)</label>
          <textarea name="message" maxlength={300}>{v.message ?? ""}</textarea>
          <label class="row" style="color:var(--text)">
            <input type="checkbox" name="anonymous" value="1" style="width:auto" checked={v.anonymous === "1"} /> نامم به گیرنده نمایش داده نشود
          </label>
          <p>جمع قابل پرداخت: <b class="price" id="total">{toman(it.price)}</b></p>
          <p><button disabled={props.delivery.length === 0}>ادامه و دریافت شماره کارت</button></p>
        </form>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

export function OrderPage(props: {
  user: User | null;
  order: Order & { wishlist_slug: string; owner_name: string; card_holder: string; shop_name: string };
  errors?: string[];
}) {
  const o = props.order;
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
                زمان رزرو تمام شده. اگر هنوز واریز نکرده‌اید، ممکن است شخص دیگری این آرزو را بخرد؛ اگر واریز کرده‌اید، عکس فیش را بفرستید.
              </div>
            )}
            <div class="card" style="background:var(--bg)">
              <h2>۱. مبلغ را کارت به کارت کنید</h2>
              <p>مبلغ: <b class="price" style="font-size:20px">{toman(o.amount)}</b></p>
              <p class="small muted" style="margin-top:0">
                {toman(o.item_price)} محصول{o.size && <> (سایز {o.size})</>}
                {o.package_name && <> + {toman(o.package_price)} بسته‌بندی ({o.package_name})</>}
                {o.delivery_method && <> + {toman(o.delivery_fee)} ارسال با {DELIVERY_LABEL[o.delivery_method]}</>}
              </p>
              <p>
                به کارت:
                <br />
                <b class="dt" style="font-size:22px;letter-spacing:1px">{formatCard(o.pay_card_number)}</b>
                <br />
                به نام: <b>{o.card_holder}</b>
              </p>
              {!expired && <p class="small muted">این آرزو تا <span class="dt">{formatJalali(o.expires_at)}</span> برای شما رزرو است.</p>}
            </div>
            <form method="post" action={`/order/${o.token}/receipt`} enctype="multipart/form-data">
              <h2>۲. عکس فیش واریز را بفرستید</h2>
              <Errors errors={props.errors} />
              <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp" required />
              <p><button>ارسال فیش</button></p>
            </form>
          </>
        )}

        {o.status === "awaiting" && (
          <div class="okbox">
            فیش شما برای فروشگاه ارسال شد. بعد از اینکه فروشگاه دریافت مبلغ را تأیید کند، کادو برای {o.owner_name} ارسال می‌شود.
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
