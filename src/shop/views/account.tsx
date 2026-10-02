import { formatJalali } from "../../../lib/jalali";
import { CITIES } from "../cities";
import { STATUS_LABEL, orderStatusLabel, toman, type ItemView, type Order, type Wishlist } from "../db";
import type { User } from "../../session";
import { Avatar, Errors, Layout, Thumb, TitleBar } from "./layout";

/** Centered dark card for the account flows (login, setup). */
function AuthShell(props: { title: string; icon: string; subtitle: string; children?: unknown }) {
  return (
    <Layout title={props.title} user={null} nav="none" bare header={<div></div>}>
      <div class="min-h-screen flex flex-col justify-center px-6 py-12 max-w-sm mx-auto">
        <div class="text-center mb-10">
          <div class="w-20 h-20 bg-pink rounded-[24px] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-pink/20 text-white text-3xl">
            <i class={`fa-solid ${props.icon}`}></i>
          </div>
          <h1 class="text-2xl font-black text-fg mb-3">{props.title}</h1>
          <p class="text-sm text-muted leading-relaxed">{props.subtitle}</p>
        </div>
        <div class="ui">{props.children as never}</div>
      </div>
    </Layout>
  );
}

export function CodeLoginPage(props: {
  next: string;
  step: "phone" | "code" | "unavailable";
  phone?: string;
  isNew?: boolean;
  name?: string;
  error?: string;
  setupOpen?: boolean;
}) {
  const subtitle =
    props.step === "code"
      ? "کد ۶ رقمی را که در پیام‌رسان بله برایتان آمد وارد کنید."
      : "با شماره موبایل وارد شوید؛ کد ورود در پیام‌رسان بله برایتان ارسال می‌شود. اگر حساب ندارید، همین‌جا ساخته می‌شود.";
  const big = "w-full py-4 rounded-2xl text-base font-bold shadow-lg shadow-pink/20";
  return (
    <AuthShell title="ورود / ثبت‌نام" icon="fa-gift" subtitle={subtitle}>
      <Errors errors={[props.error]} />
      {props.step === "unavailable" ? (
        <div class="warnbox">
          ورود فعلاً ممکن نیست: سرویس ارسال کد بله (سفیر) هنوز راه‌اندازی نشده است.
          {props.setupOpen && <> مدیر سایت: <a href="/setup">راه‌اندازی</a></>}
        </div>
      ) : props.step === "phone" ? (
        <form method="post" action="/login" class="space-y-4">
          <input type="hidden" name="next" value={props.next} />
          <label>شماره موبایل</label>
          <input name="phone" value={props.phone ?? ""} class="ltr text-center text-lg tracking-widest" inputmode="tel" autocomplete="tel" placeholder="09xx xxx xxxx" required autofocus />
          <button class={big}>ارسال کد <i class="fa-solid fa-arrow-left"></i></button>
        </form>
      ) : (
        <form method="post" action="/login/verify" class="space-y-4">
          <input type="hidden" name="next" value={props.next} />
          <input type="hidden" name="phone" value={props.phone} />
          <p class="text-xs text-muted text-center">
            ارسال‌شده به <span class="dt text-fg">{props.phone}</span> · <a href={`/login?next=${encodeURIComponent(props.next)}`}>تغییر شماره</a>
          </p>
          <input name="code" class="ltr text-center text-2xl tracking-[0.6em] font-bold" inputmode="numeric" autocomplete="one-time-code" maxlength={6} placeholder="------" required autofocus />
          {props.isNew && (
            <>
              <label>نام و نام خانوادگی (حساب جدید)</label>
              <input name="name" value={props.name ?? ""} required maxlength={80} />
            </>
          )}
          <button class={big}>{props.isNew ? "ساخت حساب و ورود" : "ورود"}</button>
        </form>
      )}
    </AuthShell>
  );
}

const BOT_STYLE: Record<string, { name: string; icon: string; bg: string; shadow: string; text: string }> = {
  bale: { name: "بله", icon: "fa-solid fa-comment-dots", bg: "bg-bale", shadow: "shadow-bale/20", text: "text-bale" },
  telegram: { name: "تلگرام", icon: "fa-brands fa-telegram", bg: "bg-tg", shadow: "shadow-tg/20", text: "text-tg" },
};

/** html/bot.html: connect the account to the site's bot (required after sign-up). */
export function ConnectPage(props: { user: User; next: string; links: { kind: string; url: string; username: string }[] }) {
  const script = `
    (function poll(){
      fetch('/connect/status',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{
        if(d.connected){location.href=${JSON.stringify(props.next)};}
        else if(${props.links.length ? "false" : "d.bots>0"}){location.reload();}
        else{setTimeout(poll,3000);}
      }).catch(()=>setTimeout(poll,5000));
    })();`;
  const first = props.links[0];
  const style = BOT_STYLE[first?.kind ?? "bale"];
  const steps: [string, string][] = [
    ["ورود به ربات", "دکمه پایین را لمس کنید تا ربات در پیام‌رسان باز شود."],
    ["شروع فعالیت (Start)", "در ربات دکمه «شروع» یا Start را بزنید تا حسابتان وصل شود."],
    ["دریافت اعلان‌ها", "تمام! این صفحه خودکار ادامه می‌دهد و از این به بعد سفارش‌ها و اعلان‌ها را در ربات می‌گیرید."],
  ];
  return (
    <Layout title="اتصال به ربات" user={props.user} nav="none" bare header={<div></div>}>
      <div class="min-h-screen flex flex-col px-8 py-12 max-w-md mx-auto">
        <header class="mb-12 text-center relative">
          <form method="post" action="/logout" class="absolute -top-4 right-0">
            <button aria-label="خروج" class="w-10 h-10 flex items-center justify-center rounded-full bg-card text-muted"><i class="fa-solid fa-xmark"></i></button>
          </form>
          <div class={`w-20 h-20 ${style.bg} rounded-[24px] flex items-center justify-center mx-auto mb-6 shadow-xl ${style.shadow}`}>
            <i class={`${style.icon} text-white text-4xl`}></i>
          </div>
          <h1 class="text-2xl font-black text-fg mb-3">اتصال به ربات {style.name}</h1>
          <p class="text-sm text-muted leading-relaxed">
            سفارش‌ها، فیش‌های واریز و اعلان‌های کادو از طریق ربات برایتان ارسال می‌شود. برای ادامه، حسابتان را یک‌بار وصل کنید.
          </p>
        </header>
        <main class="flex-1 space-y-8">
          {steps.map(([title, text], n) => (
            <div class="flex gap-4">
              <div class={`w-8 h-8 rounded-full ${n === 0 ? "bg-pink text-white" : "bg-card border border-muted/20 text-muted"} flex items-center justify-center text-sm font-bold shrink-0`}>
                {(n + 1).toLocaleString("fa-IR")}
              </div>
              <div>
                <h3 class="text-sm font-bold text-fg mb-1">{title}</h3>
                <p class="text-xs text-muted">{text}</p>
              </div>
            </div>
          ))}
          {!props.links.length && (
            <div class="rounded-2xl p-4 bg-amber-500/10 text-amber-200 text-sm">
              ربات سایت هنوز راه‌اندازی نشده است. کمی بعد دوباره سر بزنید؛ این صفحه خودکار ادامه می‌دهد.
            </div>
          )}
          {props.links.map((l) => (
            <div class="p-5 bg-card rounded-3xl border border-muted/5 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class={`w-10 h-10 rounded-full bg-ink flex items-center justify-center ${BOT_STYLE[l.kind].text}`}><i class="fa-solid fa-at"></i></div>
                <span class="text-sm font-mono tracking-wider text-fg ltr">{l.username}</span>
              </div>
              <button type="button" data-copy={`@${l.username}`} data-copied="کپی شد ✓" class="text-[10px] font-bold text-pink bg-pink/10 px-3 py-1.5 rounded-lg">کپی نام</button>
            </div>
          ))}
        </main>
        <footer class="mt-auto pt-8 space-y-3">
          {props.links.map((l) => (
            <a href={l.url} target="_blank" rel="noopener" class={`w-full py-4 ${BOT_STYLE[l.kind].bg} text-white rounded-2xl font-bold shadow-lg ${BOT_STYLE[l.kind].shadow} flex items-center justify-center gap-2 active:scale-95 transition-all`}>
              باز کردن در {BOT_STYLE[l.kind].name} <i class={BOT_STYLE[l.kind].icon}></i>
            </a>
          ))}
          <p class="text-center text-[10px] text-muted">
            اتصال امن است و ربات به گفتگوهای خصوصی شما دسترسی ندارد. <a class="text-pink" href={`/connect?next=${encodeURIComponent(props.next)}`}>بررسی دوباره</a>
          </p>
        </footer>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

export interface ProfileItem {
  id: number;
  wishlist_id: number;
  title: string;
  image_key: string;
  quantity: number;
  bought: number;
  givers: number;
}

const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
const fa = (n: number) => n.toLocaleString("fa-IR");

/** html/profile.html */
export function ProfilePage(props: {
  changes?: { id: number; product_title: string }[];
  user: User;
  stats: { wishes: number; gifts: number };
  items: ProfileItem[];
  shareUrl: string;
  bots: { kind: string; connected: boolean }[];
}) {
  const u = props.user;
  const first = u.name.trim().split(/\s+/)[0] ?? u.name;
  const action = (href: string, icon: string, label: string, accent = false, attrs: Record<string, string> = {}) => (
    <a href={href} class="flex flex-col items-center gap-2 min-w-[80px]" {...attrs}>
      <div class={`w-14 h-14 rounded-2xl ${accent ? "bg-pink/10 text-pink" : "bg-card text-muted"} flex items-center justify-center text-xl`}>
        <i class={`fa-solid ${icon}`}></i>
      </div>
      <span class="text-[10px] text-muted">{label}</span>
    </a>
  );
  const connected = props.bots.filter((b) => b.connected);
  return (
    <Layout
      title="پروفایل"
      user={u}
      nav="profile"
      bare
      header={
        <header class="sticky top-0 z-40 bg-ink/80 backdrop-blur-md border-b border-card">
          <div class="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <Avatar user={u} />
              <div>
                <h1 class="text-sm font-bold text-fg">سلام {first} 👋</h1>
                <p class="text-[10px] text-muted">مدیریت لیست آرزوهای من</p>
              </div>
            </div>
            <a href="/me/settings" aria-label="تنظیمات حساب" class="w-10 h-10 flex items-center justify-center rounded-full bg-card text-muted">
              <i class="fa-solid fa-gear"></i>
            </a>
          </div>
        </header>
      }
    >
      <div class="px-6 py-6">
        <PendingChanges items={props.changes ?? []} />
        <section class="grid grid-cols-2 gap-4 mb-8">
          <div class="bg-card p-4 rounded-2xl border border-muted/5">
            <span class="text-[10px] text-muted block mb-1">کل آرزوها</span>
            <span class="text-xl font-bold text-fg">{fa(props.stats.wishes)}</span>
          </div>
          <div class="bg-card p-4 rounded-2xl border border-muted/5">
            <span class="text-[10px] text-muted block mb-1">کادوهای دریافتی</span>
            <span class="text-xl font-bold text-pink">{fa(props.stats.gifts)}</span>
          </div>
        </section>

        <section class="flex gap-4 mb-10 overflow-x-auto no-scrollbar">
          {action("/me/wishlists/new", "fa-plus", "لیست جدید", true)}
          {props.shareUrl ? action("#", "fa-share-nodes", "اشتراک‌گذاری", false, { "data-share": props.shareUrl }) : null}
          {action("/me/wishlists", "fa-list", "لیست‌ها")}
          {action("/me/orders", "fa-bag-shopping", "خریدهای من")}
          {action("/me/settings", "fa-robot", "اتصال ربات")}
          {action("#", "fa-download", "نصب اپ", false, { "data-install": "", class: "hidden flex flex-col items-center gap-2 min-w-[80px]" })}
          {action("/panel", "fa-store", "فروشگاه من")}
        </section>

        <section>
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-bold text-fg">آرزوهای فعال</h2>
            <a href="/me/wishlists" class="text-[10px] text-pink font-bold">مشاهده همه</a>
          </div>
          {props.items.length === 0 && (
            <div class="bg-card rounded-2xl p-6 text-center text-sm text-muted">
              هنوز آرزویی ندارید. از <a href="/" class="text-pink">فروشگاه</a> محصولی را به لیستتان اضافه کنید.
            </div>
          )}
          <div class="space-y-4">
            {props.items.map((it) => (
              <div class="bg-card p-3 rounded-2xl flex items-center gap-4">
                <div class="w-16 h-16 rounded-xl overflow-hidden bg-ink flex-shrink-0 flex items-center justify-center text-2xl">
                  {it.image_key ? <img class="w-full h-full object-cover" src={`/img/${it.image_key}`} alt={it.title} loading="lazy" /> : "🎁"}
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-xs font-bold text-fg truncate mb-1">{it.title}</h3>
                  <div class="flex items-center gap-2 mb-2">
                    <div class="flex-1 h-1.5 bg-ink rounded-full overflow-hidden">
                      <div class="h-full bg-pink rounded-full" style={`width:${pct(it.bought, it.quantity)}%`}></div>
                    </div>
                    <span class="text-[9px] text-muted">{fa(pct(it.bought, it.quantity))}٪</span>
                  </div>
                  <span class="text-[9px] text-muted bg-ink px-2 py-0.5 rounded-md">
                    {it.givers ? `${fa(it.givers)} نفر کادو داده‌اند` : "هنوز خریداری نشده"}
                  </span>
                </div>
                <a href={`/me/wishlists/${it.wishlist_id}`} aria-label="مدیریت" class="w-8 h-8 rounded-full bg-ink text-muted flex items-center justify-center">
                  <i class="fa-solid fa-ellipsis-vertical"></i>
                </a>
              </div>
            ))}
          </div>
        </section>

        <section class="mt-10 p-5 bg-pink/5 border border-pink/20 rounded-[24px]">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-pink flex items-center justify-center text-white"><i class="fa-solid fa-robot text-lg"></i></div>
              <div>
                <h3 class="text-sm font-bold text-pink">ربات اطلاع‌رسانی</h3>
                <p class="text-[10px] text-muted">
                  وضعیت: {connected.length ? `متصل (${connected.map((b) => BOT_STYLE[b.kind].name).join("، ")})` : "متصل نیست"}
                </p>
              </div>
            </div>
            <div class={`w-12 h-6 ${connected.length ? "bg-ok" : "bg-plum"} rounded-full relative flex items-center px-1`}>
              <div class={`w-4 h-4 bg-white rounded-full ${connected.length ? "mr-auto" : "ml-auto"}`}></div>
            </div>
          </div>
          <p class="text-[10px] text-muted leading-relaxed">
            اعلان هر کادو، فیش‌های واریز و پیام‌های سفارش از طریق ربات برایتان ارسال می‌شود.
          </p>
        </section>
      </div>
    </Layout>
  );
}

export function ProfileSettingsPage(props: { user: User; bots: { kind: string; connected: boolean; link: string }[]; error?: string; saved?: boolean }) {
  const u = props.user;
  return (
    <Layout title="تنظیمات حساب" user={u} nav="profile">
      <h1>تنظیمات حساب</h1>
      {props.saved && <div class="okbox">ذخیره شد.</div>}
      <Errors errors={[props.error]} />
      <form method="post" action="/me/settings" enctype="multipart/form-data" class="card">
        <div class="flex items-center gap-4">
          <Avatar user={u} size="w-20 h-20" ring />
          <div class="flex-1">
            <label style="margin-top:0">عکس پروفایل (JPG، PNG یا WebP، حداکثر ۲ مگابایت)</label>
            <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" id="avatar-input" />
            {u.avatar_key && (
              <label class="row" style="color:var(--fg)"><input type="checkbox" name="remove_avatar" value="1" /> حذف عکس</label>
            )}
          </div>
        </div>
        <label>نام و نام خانوادگی</label>
        <input name="name" value={u.name} required maxlength={80} />
        <label>شماره موبایل (ورود با کد بله)</label>
        <input value={u.phone} class="ltr" disabled />
        <p><button>ذخیره</button></p>
      </form>
      <div class="card" id="bot">
        <h2>اتصال ربات</h2>
        {props.bots.map((b) => (
          <div class="row" style="margin-bottom:8px">
            <span>{BOT_STYLE[b.kind].name}</span>
            {b.connected ? <span class="tag ok">متصل ✓</span> : <span class="tag">متصل نیست</span>}
            <span class="sp" />
            {!b.connected && b.link && <a class="btn small secondary" href={b.link} target="_blank" rel="noopener">اتصال</a>}
          </div>
        ))}
        {!props.bots.length && <p class="muted small">ربات سایت هنوز راه‌اندازی نشده است.</p>}
      </div>
      <form method="post" action="/logout">
        <button class="secondary">خروج از حساب</button>
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.getElementById('avatar-input').addEventListener('change',function(){var f=this.files[0];if(!f)return;var img=document.querySelector('form img')||document.createElement('img');img.src=URL.createObjectURL(f);});`,
        }}
      />
    </Layout>
  );
}

export function MyWishlistsPage(props: { user: User; lists: (Wishlist & { items: number; cover: string })[]; siteUrl: string }) {
  return (
    <Layout title="لیست‌های آرزوی من" user={props.user} nav="wishes">
      <div class="row" style="margin-bottom:16px">
        <h1 style="margin:0">لیست‌های آرزوی من</h1>
        <span class="sp" />
        <a class="btn small" href="/me/wishlists/new"><i class="fa-solid fa-plus"></i> لیست جدید</a>
      </div>
      {props.lists.length === 0 && <div class="card muted">هنوز لیستی نساخته‌اید. یک لیست بسازید و از صفحه محصولات آرزوهایتان را اضافه کنید.</div>}
      {props.lists.map((w) => (
        <div class="card" style="display:flex;gap:14px;align-items:center">
          <a href={`/me/wishlists/${w.id}`} class="w-16 h-16 rounded-xl overflow-hidden bg-ink flex items-center justify-center text-2xl shrink-0">
            {w.cover ? <img src={`/img/${w.cover}`} alt="" class="w-full h-full object-cover" /> : "🎁"}
          </a>
          <div style="flex:1;min-width:0">
            <a href={`/me/wishlists/${w.id}`} class="font-bold text-fg">{w.title}</a>
            <div class="small muted">{fa(w.items)} آرزو{!w.is_open && " · بسته"}</div>
          </div>
          <button type="button" class="small secondary" data-share={`${props.siteUrl}/w/${w.slug}`}><i class="fa-solid fa-share-nodes"></i></button>
          <a class="btn small secondary" href={`/w/${w.slug}`}><i class="fa-solid fa-eye"></i></a>
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
    <Layout title={w ? w.title : "لیست جدید"} user={props.user} nav="wishes">
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
              <label class="row" style="color:var(--fg)">
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

export interface MyOrder {
  cancel_kind: string;
  token: string;
  id: number;
  product_title: string;
  amount: number;
  status: Order["status"];
  created_at: string;
  image_key: string;
  owner_name: string;
  is_direct: number;
}

/** Everything the signed-in person has bought: gifts for others and direct purchases for themselves. */
export function MyOrdersPage(props: { user: User; orders: MyOrder[] }) {
  return (
    <Layout title="خریدهای من" user={props.user} nav="profile" header={<TitleBar title="خریدهای من" back="/me" />} bare>
      <div class="px-6 pb-10 space-y-4">
        {props.orders.length === 0 && (
          <div class="bg-card rounded-2xl p-6 text-center text-sm text-muted">
            هنوز خریدی ثبت نکرده‌اید. در صفحه هر محصول «خرید مستقیم» را بزنید یا از لیست آرزوی دوستانتان کادو بخرید.
          </div>
        )}
        {props.orders.map((o) => (
          <a href={`/order/${o.token}`} class="flex items-center gap-4 p-4 bg-card rounded-2xl border border-muted/5">
            <div class="w-16 h-16 rounded-xl overflow-hidden bg-ink shrink-0 flex items-center justify-center text-2xl">
              {o.image_key ? <img src={`/img/${o.image_key}`} alt="" class="w-full h-full object-cover" loading="lazy" /> : "🎁"}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-fg truncate">{o.product_title}</h3>
              <p class="text-[10px] text-muted">{o.is_direct ? "برای خودم" : `کادو برای ${o.owner_name}`} · <span class="dt">{formatJalali(o.created_at, false)}</span></p>
              <p class="text-xs font-bold text-pink mt-1">{toman(o.amount)}</p>
            </div>
            <span class="text-[10px] text-muted text-left max-w-[90px]">{orderStatusLabel(o)}</span>
          </a>
        ))}
      </div>
    </Layout>
  );
}

/** The recipient answers a shop's "this ran out — how about …?" proposal. */
export function ChangeRequestPage(props: { user: User; order: Order & { image_key: string; shop_name: string }; done?: boolean }) {
  const o = props.order;
  const pending = o.change_status === "pending";
  return (
    <Layout title="پیشنهاد تغییر" user={props.user} nav="profile" header={<TitleBar title="پیشنهاد تغییر کادو" back="/me" />} bare>
      <div class="px-6 pb-12 space-y-6">
        <section class="p-4 bg-card rounded-2xl flex items-center gap-4">
          <div class="w-20 h-20 rounded-xl overflow-hidden bg-ink shrink-0 flex items-center justify-center text-3xl">
            {o.image_key ? <img src={`/img/${o.image_key}`} alt="" class="w-full h-full object-cover" /> : "🎁"}
          </div>
          <div class="min-w-0">
            <h1 class="text-sm font-bold text-fg">{o.product_title}</h1>
            <p class="text-[11px] text-muted">فروشگاه {o.shop_name}{o.size && <> · سایز سفارش: <b class="text-fg">{o.size}</b></>}</p>
          </div>
        </section>
        {pending ? (
          <>
            <section class="p-5 bg-pink/5 border border-pink/20 rounded-2xl space-y-2">
              <p class="text-sm text-fg leading-7">
                کالایی که خواسته بودید {o.size ? `در سایز ${o.size} ` : ""}تمام شده. فروشگاه پیشنهاد می‌دهد:
              </p>
              {o.change_size && <p class="text-lg font-bold text-pink">سایز {o.change_size}</p>}
              {o.change_message && <p class="text-sm text-fg leading-7 whitespace-pre-wrap">{o.change_message}</p>}
            </section>
            <form method="post" class="space-y-4">
              <label class="block text-xs text-muted">توضیح شما برای فروشگاه (مثلاً رنگ انتخابی) — اختیاری</label>
              <input name="reply" maxlength={200} class="w-full bg-card border border-muted/10 rounded-xl px-4 py-3 text-sm text-fg outline-none focus:border-pink" />
              <button name="answer" value="accept" class="w-full py-4 bg-pink text-white rounded-2xl font-bold">✓ قبول می‌کنم</button>
              <button
                name="answer"
                value="decline"
                class="w-full py-3 bg-card text-muted rounded-2xl text-sm"
                onclick="return confirm('سفارش لغو شود؟ مبلغ به خریدار برمی‌گردد و آرزو دوباره در لیست شما فعال می‌شود.')"
              >
                نمی‌خواهم — سفارش لغو شود
              </button>
            </form>
          </>
        ) : (
          <div class="p-5 bg-card rounded-2xl text-sm leading-7">
            {o.change_status === "accepted" ? (
              <>✅ پیشنهاد را پذیرفتید{o.change_size ? ` (سایز ${o.change_size})` : ""}؛ فروشگاه کادو را با همین مشخصات می‌فرستد.</>
            ) : (
              <>سفارش لغو شد و این آرزو دوباره در لیست شما فعال است.</>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

/** Banner on the profile for proposals waiting for an answer. */
export function PendingChanges(props: { items: { id: number; product_title: string }[] }) {
  if (!props.items.length) return null;
  return (
    <section class="mb-6 space-y-2">
      {props.items.map((c) => (
        <a href={`/me/changes/${c.id}`} class="flex items-center gap-3 p-4 rounded-2xl bg-pink/10 border border-pink/30 text-sm">
          <i class="fa-solid fa-arrows-rotate text-pink"></i>
          <span class="flex-1">«{c.product_title}» تمام شده؛ فروشگاه پیشنهاد تغییر داده. پاسخ دهید</span>
          <i class="fa-solid fa-chevron-left text-muted text-xs"></i>
        </a>
      ))}
    </section>
  );
}
