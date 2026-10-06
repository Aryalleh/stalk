import { formatJalali } from "../../../lib/jalali";
import { CITIES } from "../cities";
import { STATUS_LABEL, orderStatusLabel, toman, type ItemView, type Order, type Wishlist } from "../db";
import type { User } from "../../session";
import { useSite } from "../../render";
import { Avatar, Errors, FilePicker, Layout, MenuButton, Thumb, TitleBar } from "./layout";
import { variantLabel } from "../variants";
import { JALALI_MONTHS, birthdayLabel, currentJalaliYear } from "../../../lib/people";

/** Centered dark card for the account flows (login, setup). */
function AuthShell(props: { title: string; icon: string; subtitle: string; children?: unknown }) {
  return (
    <Layout title={props.title} user={null} nav="none" bare header={<div class="md:hidden px-4 pt-4"><MenuButton /></div>}>
      <div class="min-h-screen flex flex-col justify-center px-6 py-12 max-w-sm mx-auto">
        <div class="text-center mb-10">
          <div class="w-20 h-20 bg-brand rounded-[24px] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-brand/20 text-white text-3xl">
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

/** First name, last name and Jalali birth date — form values by field name. */
export function ProfileFields(props: { values: Record<string, string> }) {
  const v = props.values;
  const thisYear = currentJalaliYear();
  const years = Array.from({ length: 96 }, (_, i) => thisYear - 5 - i);
  const fa = (n: number) => n.toLocaleString("fa-IR", { useGrouping: false });
  return (
    <>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label>نام</label>
          <input name="first_name" value={v.first_name ?? ""} required maxlength={40} autocomplete="given-name" />
        </div>
        <div>
          <label>نام خانوادگی</label>
          <input name="last_name" value={v.last_name ?? ""} required maxlength={40} autocomplete="family-name" />
        </div>
      </div>
      <label>نام مستعار (نمایش عمومی)</label>
      <input name="nickname" value={v.nickname ?? ""} required maxlength={30} placeholder="مثلاً سارا، سارینا یا مینو" />
      <p class="small muted" style="margin-top:4px">در پروفایل عمومی و لیست‌های آرزو فقط همین نام نمایش داده می‌شود، نه نام و نام خانوادگی شما.</p>
      <label>تاریخ تولد</label>
      <div class="grid grid-cols-3 gap-2">
        <select name="birth_day" required aria-label="روز تولد">
          <option value="">روز</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option value={String(d)} selected={v.birth_day === String(d)}>{fa(d)}</option>)}
        </select>
        <select name="birth_month" required aria-label="ماه تولد">
          <option value="">ماه</option>
          {JALALI_MONTHS.map((m, i) => <option value={String(i + 1)} selected={v.birth_month === String(i + 1)}>{m}</option>)}
        </select>
        <select name="birth_year" required aria-label="سال تولد">
          <option value="">سال</option>
          {years.map((y) => <option value={String(y)} selected={v.birth_year === String(y)}>{fa(y)}</option>)}
        </select>
      </div>
    </>
  );
}

/** Accent color and dark/light theme picker (values: accent = blue|pink, theme = dark|light). */
export function LookFields(props: { values: Record<string, string> }) {
  const accent = props.values.accent === "blue" ? "blue" : "pink";
  const theme = props.values.theme === "dark" ? "dark" : "light";
  const option = (name: string, value: string, checked: boolean, swatch: string, label: string) => (
    <label class="flex-1 !flex items-center gap-2 p-3 rounded-xl cursor-pointer border-2 border-transparent bg-card has-[:checked]:border-brand" style="margin:0">
      <input type="radio" name={name} value={value} checked={checked} class="sr-only" />
      <span class="block w-6 h-6 rounded-full shrink-0" style={swatch}></span>
      <span class="text-sm" style="color:var(--fg)">{label}</span>
    </label>
  );
  return (
    <>
      <label>رنگ دلخواه</label>
      <div class="flex gap-2">
        {option("accent", "pink", accent === "pink", "background:#ff5c93", "صورتی")}
        {option("accent", "blue", accent === "blue", "background:#3b82f6", "آبی")}
      </div>
      <label>تم</label>
      <div class="flex gap-2">
        {option("theme", "light", theme === "light", "background:#f4f6fa;border:2px solid #cbd5e1", "روشن")}
        {option("theme", "dark", theme === "dark", "background:#0d1320;border:2px solid #334155", "تیره")}
      </div>
      <p class="small muted" style="margin:4px 0 0">بعداً هم از تنظیمات حساب قابل تغییر است.</p>
    </>
  );
}

/** Form values of a user's profile fields. */
export function profileValues(u: Pick<User, "first_name" | "last_name" | "nickname" | "birth_date" | "username" | "accent" | "theme">): Record<string, string> {
  const [y, m, d] = (u.birth_date || "").split("-");
  return {
    first_name: u.first_name,
    last_name: u.last_name,
    nickname: u.nickname,
    birth_year: y ?? "",
    birth_month: m ? String(Number(m)) : "",
    birth_day: d ? String(Number(d)) : "",
    username: u.username ?? "",
    accent: u.accent,
    theme: u.theme,
  };
}

/** Accounts made before names and birth date were required finish their profile here. */
export function CompleteProfilePage(props: { user: User; next: string; values: Record<string, string>; origin: string; error?: string }) {
  return (
    <AuthShell title="تکمیل پروفایل" icon="fa-user-pen" subtitle="برای ادامه، نام، نام خانوادگی، نام مستعار و تاریخ تولدتان را وارد کنید.">
      <Errors errors={[props.error]} />
      <form method="post" action="/me/complete" class="space-y-2">
        <input type="hidden" name="next" value={props.next} />
        <ProfileFields values={props.values} />
        <LookFields values={props.values} />
        <button class="w-full py-4 mt-4 rounded-2xl text-base font-bold shadow-lg shadow-brand/20">ذخیره و ادامه</button>
      </form>
    </AuthShell>
  );
}

export function CodeLoginPage(props: {
  next: string;
  step: "phone" | "code" | "unavailable";
  phone?: string;
  isNew?: boolean;
  values?: Record<string, string>;
  error?: string;
  setupOpen?: boolean;
}) {
  const subtitle =
    props.step === "code"
      ? "کد ۶ رقمی را که در پیام‌رسان بله برایتان آمد وارد کنید."
      : "با شماره موبایل وارد شوید؛ کد ورود در پیام‌رسان بله برایتان ارسال می‌شود. اگر حساب ندارید، همین‌جا ساخته می‌شود.";
  const big = "w-full py-4 rounded-2xl text-base font-bold shadow-lg shadow-brand/20";
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
            <div>
              <p class="text-xs text-muted text-center">حساب جدید — مشخصات خود را وارد کنید:</p>
              <ProfileFields values={props.values ?? {}} />
              <LookFields values={props.values ?? {}} />
            </div>
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
    <Layout title="اتصال به ربات" user={props.user} nav="none" bare header={<div class="md:hidden px-4 pt-4 flex justify-end"><MenuButton /></div>}>
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
              <div class={`w-8 h-8 rounded-full ${n === 0 ? "bg-brand text-white" : "bg-card border border-muted/20 text-muted"} flex items-center justify-center text-sm font-bold shrink-0`}>
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
              <button type="button" data-copy={`@${l.username}`} data-copied="کپی شد ✓" class="text-[10px] font-bold text-brand bg-brand/10 px-3 py-1.5 rounded-lg">کپی نام</button>
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
            اتصال امن است و ربات به گفتگوهای خصوصی شما دسترسی ندارد. <a class="text-brand" href={`/connect?next=${encodeURIComponent(props.next)}`}>بررسی دوباره</a>
          </p>
        </footer>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

const fa = (n: number) => n.toLocaleString("fa-IR");

/** /me: the whole account on one page (UX Pilot "حساب من"): drawer on mobile, sidebar on desktop. */
export function AccountPage(props: {
  changes?: { id: number; product_title: string }[];
  settings: SettingsProps;
  user: User;
  stats: { wishes: number; gifts: number };
  shareUrl: string;
}) {
  const u = props.user;
  const site = useSite();
  const publicUrl = props.shareUrl;
  return (
    <Layout
      title="حساب من"
      user={u}
      nav="profile"
      bare
      wide
      stats={props.stats}
      header={
        <>
          <header class="md:hidden sticky top-0 z-40 bg-ink/80 backdrop-blur-xl border-b border-card px-4 py-3 flex items-center justify-between">
            <MenuButton />
            <a href="/" class="text-xl font-black text-brand">{site.site_name}</a>
            {publicUrl ? (
              <button type="button" data-share={publicUrl} aria-label="اشتراک‌گذاری پروفایل" class="w-10 h-10 flex items-center justify-center bg-brand text-white rounded-full shadow-lg shadow-brand/20">
                <i class="fa-solid fa-share-nodes"></i>
              </button>
            ) : (
              <span class="w-10"></span>
            )}
          </header>
        </>
      }
    >
      <div class="px-4 md:px-10 pt-5 md:pt-10">
        <div class="hidden md:flex items-center justify-between gap-4 mb-2">
          <div>
            <h1 class="text-3xl font-black text-fg mb-1">حساب من</h1>
            <p class="text-sm font-bold text-muted">مدیریت اطلاعات کاربری، حریم خصوصی و تنظیمات شخصی</p>
          </div>
          {publicUrl && (
            <button type="button" data-share={publicUrl} class="px-6 py-3.5 bg-brand text-white rounded-2xl font-black text-sm shadow-xl shadow-brand/30 flex items-center gap-2">
              <i class="fa-solid fa-share-nodes"></i>لینک عمومی من
            </button>
          )}
        </div>
        <PendingChanges items={props.changes ?? []} />
      </div>
      <div class="px-4 md:px-10 py-6">
        <SettingsBody user={u} {...props.settings} />
      </div>
    </Layout>
  );
}

export interface SettingsProps {
  bots: { kind: string; connected: boolean; link: string }[];
  origin: string;
  values?: Record<string, string>;
  error?: string;
  saved?: boolean;
}

const FIELD =
  "w-full bg-ink border border-fg/10 rounded-2xl py-3.5 px-4 md:py-4 md:px-5 text-sm font-bold text-fg outline-none transition-all focus:border-brand focus:ring-4 focus:ring-brand/15";
const LABEL = "block text-xs font-black text-fg/70 px-1 mb-2";

function AccountCard(props: { icon: string; tint: string; title: string; id?: string; children?: unknown }) {
  return (
    <section id={props.id} class="bg-card rounded-[28px] md:rounded-[40px] border border-fg/5 p-5 md:p-8 space-y-5 scroll-mt-24">
      <div class="flex items-center gap-3 border-b border-fg/5 pb-4">
        <div class={`w-10 h-10 md:w-12 md:h-12 ${props.tint} rounded-xl md:rounded-2xl flex items-center justify-center text-lg md:text-xl`}>
          <i class={`fa-solid ${props.icon}`}></i>
        </div>
        <h3 class="text-base md:text-xl font-black text-fg">{props.title}</h3>
      </div>
      {props.children as never}
    </section>
  );
}

/** A select in the account design: custom chevron instead of the browser's arrow. */
function Pick(props: { name: string; label: string; children?: unknown }) {
  return (
    <div class="relative">
      <select name={props.name} required aria-label={props.label} class={`${FIELD} appearance-none !px-4 !text-xs md:!text-sm`}>
        {props.children as never}
      </select>
      <i class="fa-solid fa-chevron-down absolute left-4 top-1/2 -translate-y-1/2 text-muted text-[10px] pointer-events-none"></i>
    </div>
  );
}

/** The "حساب من" tab of /me (UX Pilot design): avatar, user info, look, bots, privacy, sticky save bar. */
function SettingsBody(props: SettingsProps & { user: User }) {
  const u = props.user;
  const v = props.values ?? profileValues(u);
  const accent = v.accent === "blue" ? "blue" : "pink";
  const theme = v.theme === "dark" ? "dark" : "light";
  const thisYear = currentJalaliYear();
  const years = Array.from({ length: 96 }, (_, i) => thisYear - 5 - i);
  const num = (n: number) => n.toLocaleString("fa-IR", { useGrouping: false });
  const publicUrl = u.username ? `${props.origin}/u/${u.username}` : "";
  const connectedCount = props.bots.filter((b) => b.connected).length;
  const toggle = (name: string, on: number, label: string, hint: string) => (
    <label class="flex items-center justify-between gap-4 p-4 md:p-5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 cursor-pointer transition-colors">
      <span>
        <span class="block text-xs md:text-sm font-bold text-white/90">{label}</span>
        <span class="block text-[10px] md:text-[11px] text-white/45 mt-1">{hint}</span>
      </span>
      <input type="checkbox" name={name} value="1" checked={!!on} class="switch" />
    </label>
  );
  const accentOption = (value: string, color: string, label: string) => (
    <label class="flex-1 cursor-pointer">
      <input type="radio" name="accent" value={value} checked={accent === value} class="sr-only peer" />
      <span class="flex items-center justify-center gap-2 py-3 md:py-4 border-2 border-fg/10 rounded-2xl peer-checked:border-brand peer-checked:bg-brand/5 peer-focus-visible:ring-4 peer-focus-visible:ring-brand/20 transition-all">
        <span class="w-5 h-5 rounded-full shadow-md" style={`background:${color}`}></span>
        <span class="text-xs font-black text-fg">{label}</span>
      </span>
    </label>
  );
  const themeOption = (value: string, icon: string, label: string) => (
    <label class="flex-1 cursor-pointer">
      <input type="radio" name="theme" value={value} checked={theme === value} class="sr-only peer" />
      <span class="py-2.5 md:py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 text-muted peer-checked:bg-card peer-checked:text-brand peer-checked:shadow-md peer-focus-visible:ring-4 peer-focus-visible:ring-brand/20 transition-all">
        <i class={`fa-solid ${icon}`}></i> {label}
      </span>
    </label>
  );
  return (
    <div class="pb-28 md:pb-32">
      {props.saved && (
        <div class="mb-5 flex items-center gap-2 rounded-2xl bg-ok/15 text-ok px-4 py-3 text-sm font-bold" role="status">
          <i class="fa-solid fa-circle-check"></i>ذخیره شد.
        </div>
      )}
      {props.error && (
        <div class="mb-5 flex items-center gap-2 rounded-2xl bg-red-500/10 text-red-500 px-4 py-3 text-sm font-bold" role="alert">
          <i class="fa-solid fa-circle-exclamation"></i>{props.error}
        </div>
      )}
      <form id="me-form" method="post" action="/me/settings" enctype="multipart/form-data" class="space-y-6 md:space-y-8">
        <section class="bg-card rounded-[28px] md:rounded-[40px] border border-fg/5 p-3 md:p-4">
          <div id="banner-preview" class="relative h-32 md:h-44 rounded-[22px] md:rounded-[32px] overflow-hidden bg-gradient-to-br from-brand/40 via-plum to-ink">
            {u.banner_key && <img src={`/img/${u.banner_key}`} alt="بنر پروفایل" class="absolute inset-0 w-full h-full object-cover" />}
            <div class="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent"></div>
            <div class="absolute bottom-3 right-4 left-4 flex items-end justify-between gap-3 on-photo">
              <div>
                <p class="text-sm font-black">بنر پروفایل</p>
                <p class="text-[10px] text-white/75">بالای پروفایل عمومی و همه لیست‌های آرزوی شما نمایش داده می‌شود.</p>
              </div>
              <label for="banner-input" class="shrink-0 cursor-pointer px-3 py-2 rounded-xl bg-white/90 text-slate-900 text-xs font-black flex items-center gap-1.5 shadow-lg">
                <i class="fa-solid fa-image"></i>{u.banner_key ? "تغییر بنر" : "افزودن بنر"}
              </label>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-[11px] text-muted">
            <label class="file-pick !border-0 !p-0 !bg-transparent gap-2">
              <input type="file" name="banner" id="banner-input" accept="image/jpeg,image/png,image/webp" class="sr-only" />
              <span class="file-pick-name" data-empty="عکس افقی، حداکثر ۵ مگابایت (بهترین: ۱۶۰۰×۵۰۰)">عکس افقی، حداکثر ۵ مگابایت (بهترین: ۱۶۰۰×۵۰۰)</span>
            </label>
            {u.banner_key && (
              <label class="inline-flex items-center gap-2 font-bold text-red-500 cursor-pointer">
                <input type="checkbox" name="remove_banner" value="1" class="accent-red-500" /> حذف بنر
              </label>
            )}
          </div>
        </section>
        <header class="flex flex-col items-center text-center md:flex-row md:text-right md:items-center md:gap-6 md:bg-card md:rounded-[40px] md:border md:border-fg/5 md:p-8">
          <div class="relative mb-4 md:mb-0">
            <div id="avatar-preview"><Avatar user={u} size="w-28 h-28" ring /></div>
            <label
              for="avatar-input"
              aria-label="انتخاب عکس پروفایل"
              class="absolute -bottom-1 -left-1 w-11 h-11 bg-card border border-fg/10 rounded-xl flex items-center justify-center text-brand text-lg shadow-lg cursor-pointer active:scale-95 transition-transform"
            >
              <i class="fa-solid fa-camera"></i>
            </label>
          </div>
          <div class="md:flex-1">
            <h1 class="md:hidden text-2xl font-black text-fg mb-1">حساب من</h1>
            <p class="md:hidden text-xs font-bold text-muted mb-3">مدیریت اطلاعات کاربری و حریم خصوصی</p>
            <p class="hidden md:block text-lg font-black text-fg mb-1">عکس پروفایل</p>
            <p class="hidden md:block text-xs text-muted mb-3">JPG، PNG یا WebP، حداکثر ۲ مگابایت. با دکمه دوربین عوض کنید.</p>
            <label class="file-pick !border-0 !p-0 !bg-transparent justify-center md:justify-start gap-2">
              <input type="file" name="avatar" id="avatar-input" accept="image/jpeg,image/png,image/webp" class="sr-only" />
              <span class="file-pick-name" data-empty="عکس جدیدی انتخاب نشده">عکس جدیدی انتخاب نشده</span>
            </label>
            {u.avatar_key && (
              <label class="inline-flex items-center gap-2 mt-2 text-xs font-bold text-red-500 cursor-pointer">
                <input type="checkbox" name="remove_avatar" value="1" class="accent-red-500" /> حذف عکس فعلی
              </label>
            )}
          </div>
        </header>

        <AccountCard icon="fa-id-card" tint="bg-brand/10 text-brand" title="اطلاعات کاربری">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
            <div>
              <label class={LABEL} for="f-first">نام</label>
              <input id="f-first" name="first_name" value={v.first_name ?? ""} required maxlength={40} autocomplete="given-name" class={FIELD} />
            </div>
            <div>
              <label class={LABEL} for="f-last">نام خانوادگی</label>
              <input id="f-last" name="last_name" value={v.last_name ?? ""} required maxlength={40} autocomplete="family-name" class={FIELD} />
            </div>
            <div class="sm:col-span-2">
              <label class={LABEL} for="f-nick">نام مستعار (نمایش عمومی)</label>
              <input id="f-nick" name="nickname" value={v.nickname ?? ""} required maxlength={30} placeholder="مثلاً سارا، سارینا یا مینو" class={FIELD} />
              <p class="text-[11px] text-muted font-bold px-2 mt-2">
                در پروفایل عمومی و لیست‌های آرزو فقط همین نام نمایش داده می‌شود، نه نام و نام خانوادگی شما.
              </p>
            </div>
          </div>
          <div>
            <span class={LABEL}>تاریخ تولد</span>
            <div class="grid grid-cols-3 gap-2 md:gap-4">
              <Pick name="birth_day" label="روز تولد">
                <option value="">روز</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option value={String(d)} selected={v.birth_day === String(d)}>{num(d)}</option>)}
              </Pick>
              <Pick name="birth_month" label="ماه تولد">
                <option value="">ماه</option>
                {JALALI_MONTHS.map((m, i) => <option value={String(i + 1)} selected={v.birth_month === String(i + 1)}>{m}</option>)}
              </Pick>
              <Pick name="birth_year" label="سال تولد">
                <option value="">سال</option>
                {years.map((y) => <option value={String(y)} selected={v.birth_year === String(y)}>{num(y)}</option>)}
              </Pick>
            </div>
          </div>
          <div>
            <label class={LABEL} for="f-phone">شماره موبایل (ورود با کد ربات)</label>
            <div class="relative">
              <input id="f-phone" value={u.phone} disabled class={`${FIELD} ltr text-left !text-muted cursor-not-allowed opacity-80`} />
              <i class="fa-solid fa-lock absolute right-5 top-1/2 -translate-y-1/2 text-muted/50"></i>
            </div>
          </div>
        </AccountCard>

        <div class="grid gap-6 md:gap-8 lg:grid-cols-2">
          <AccountCard icon="fa-palette" tint="bg-amber-500/10 text-amber-500" title="ظاهر کادوچی">
            <div>
              <span class={LABEL}>رنگ دلخواه</span>
              <div class="flex gap-3">
                {accentOption("pink", "#ff5c93", "صورتی")}
                {accentOption("blue", "#3b82f6", "آبی")}
              </div>
            </div>
            <div>
              <span class={LABEL}>تم محیط</span>
              <div class="flex p-1 bg-ink rounded-2xl border border-fg/10">
                {themeOption("light", "fa-sun", "روشن")}
                {themeOption("dark", "fa-moon", "تیره")}
              </div>
            </div>
          </AccountCard>

          <AccountCard id="bot" icon="fa-robot" tint="bg-emerald-500/10 text-emerald-500" title="ربات‌های متصل">
            <p class="text-[11px] text-muted leading-relaxed -mt-1">
              کد ورود، کادوها و سفارش‌ها به ربات‌های وصل‌شده می‌رسد. برای وصل کردن حساب دیگری «تغییر حساب» را بزنید و ربات را با همان حساب باز کنید.
            </p>
            <div class="space-y-3">
              {props.bots.map((b) => {
                const style = BOT_STYLE[b.kind];
                const canDrop = b.connected && props.bots.some((o) => o.kind !== b.kind && o.connected);
                return (
                  <div class="p-3 md:p-4 bg-ink rounded-2xl border border-fg/5 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class={`w-10 h-10 bg-card rounded-xl flex items-center justify-center ${style.text} text-xl shadow-sm shrink-0`}>
                        <i class={style.icon}></i>
                      </div>
                      <div class="min-w-0">
                        <p class="text-xs font-black text-fg">{style.name}</p>
                        <p class={`text-[10px] font-bold ${b.connected ? "text-emerald-500" : "text-muted"}`}>{b.connected ? "متصل شده" : "متصل نیست"}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      {b.link && (
                        <a
                          href={b.link}
                          target="_blank"
                          rel="noopener"
                          class={`px-3 h-9 rounded-xl text-[11px] font-black flex items-center gap-1.5 ${b.connected ? "bg-card text-fg border border-fg/10" : `${style.bg} text-white`}`}
                        >
                          {b.connected ? <><i class="fa-solid fa-arrows-rotate"></i>تغییر حساب</> : <><i class="fa-solid fa-link"></i>اتصال</>}
                        </a>
                      )}
                      {canDrop && (
                        <button
                          type="submit"
                          form={`bot-off-${b.kind}`}
                          aria-label={`قطع اتصال ${style.name}`}
                          title="قطع اتصال"
                          onclick={`return confirm('اتصال ${style.name} قطع شود؟')`}
                          class="w-9 h-9 bg-card text-red-500 border border-red-500/20 rounded-xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                        >
                          <i class="fa-solid fa-link-slash"></i>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {connectedCount === 1 && props.bots.length > 1 && (
              <p class="text-[11px] text-muted">برای قطع اتصال، اول ربات دیگر را وصل کنید؛ حساب باید دست‌کم به یکی وصل بماند.</p>
            )}
            {!props.bots.length && <p class="text-[11px] text-muted">ربات سایت هنوز راه‌اندازی نشده است.</p>}
          </AccountCard>
        </div>

        <section class="bg-slate-900 text-white rounded-[28px] md:rounded-[40px] p-5 md:p-8 space-y-5 relative overflow-hidden shadow-xl shadow-slate-900/30">
          <div class="absolute top-0 right-0 w-48 h-48 bg-brand/25 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
          <div class="flex items-center gap-3 relative">
            <i class="fa-solid fa-shield-halved text-2xl text-brand"></i>
            <h3 class="text-base md:text-xl font-black">حریم خصوصی و نمایش</h3>
          </div>
          {publicUrl && (
            <div class="relative p-4 bg-white/5 rounded-2xl border border-white/10">
              <p class="text-[11px] text-white/60 mb-2">لینک ثابت پروفایل عمومی شما (قابل تغییر نیست) — همه لیست‌های آرزوی باز شما اینجا دیده می‌شوند:</p>
              <div class="flex items-center gap-2">
                <input
                  readonly
                  value={publicUrl}
                  onclick="this.select()"
                  aria-label="لینک پروفایل عمومی"
                  class="ltr flex-1 min-w-0 bg-white/10 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                />
                <button type="button" data-copy={publicUrl} data-copied="کپی شد ✓" class="h-10 px-3 rounded-xl bg-brand text-white text-xs font-black shrink-0">
                  <i class="fa-regular fa-copy"></i> کپی
                </button>
                <a href={`/u/${u.username}`} aria-label="مشاهده پروفایل عمومی" class="w-10 h-10 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
                  <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                </a>
              </div>
            </div>
          )}
          <div class="space-y-3 relative">
            {toggle("show_received", u.show_received, "نمایش کادوهای دریافتی در پروفایل عمومی", "کادوهایی که گرفته‌اید زیر پروفایلتان دیده می‌شوند.")}
            {toggle("show_givers", u.show_givers, "نمایش نام هدیه‌دهندگان", "فقط کسانی که خودشان اجازه داده‌اند، با نام مستعارشان.")}
            {toggle("show_birthday", u.show_birthday, "نمایش روز تولد در پروفایل", "فقط روز و ماه؛ سال تولد هرگز نمایش داده نمی‌شود.")}
            {toggle("show_given_count", u.show_given_count, "نمایش تعداد کسانی که به آن‌ها کادو داده‌ام", "در پروفایل عمومی نوشته می‌شود «به چند نفر کادو داده»؛ نام کسی نمایش داده نمی‌شود.")}
          </div>
        </section>

        <div class="fixed inset-x-0 bottom-[4.75rem] md:bottom-6 z-40 px-4 md:pr-[17rem] md:pl-10 pointer-events-none">
          <div class="max-w-md md:max-w-5xl mx-auto flex gap-3 md:justify-end p-3 md:p-4 bg-card/90 backdrop-blur-2xl rounded-2xl md:rounded-[28px] border border-fg/10 shadow-2xl pointer-events-auto">
            <button type="reset" class="flex-1 md:flex-none md:px-8 py-3.5 bg-ink text-fg font-black rounded-xl md:rounded-2xl text-sm">انصراف</button>
            <button type="submit" class="flex-[2.5] md:flex-none md:px-12 py-3.5 bg-brand text-white font-black rounded-xl md:rounded-2xl text-sm shadow-lg shadow-brand/25 flex items-center justify-center gap-2">
              <i class="fa-solid fa-floppy-disk"></i>ذخیره تغییرات
            </button>
          </div>
        </div>
      </form>
      {props.bots
        .filter((b) => b.connected && props.bots.some((o) => o.kind !== b.kind && o.connected))
        .map((b) => <form id={`bot-off-${b.kind}`} method="post" action={`/me/bot/${b.kind}/disconnect`} class="hidden"></form>)}
      <div class="mt-6 grid gap-3 sm:grid-cols-2">
        {!u.shop_id && (
          <a href="/panel/register" class="flex items-center justify-center gap-2 p-3.5 bg-brand/10 text-brand font-black text-sm rounded-2xl hover:bg-brand/15">
            <i class="fa-solid fa-store"></i>ساخت فروشگاه
          </a>
        )}
        <form method="post" action="/logout" class={`m-0 ${u.shop_id ? "sm:col-span-2" : ""}`}>
          <button class="w-full flex items-center justify-center gap-2 p-3.5 text-red-500 font-black text-sm bg-red-500/10 hover:bg-red-500/15 rounded-2xl">
            <i class="fa-solid fa-arrow-right-from-bracket"></i>خروج از حساب
          </button>
        </form>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var input=document.getElementById('avatar-input'),box=document.querySelector('#avatar-preview > div'),orig=box.innerHTML;
            input.addEventListener('change',function(){var f=this.files[0];if(!f)return;box.innerHTML='';var img=document.createElement('img');
            img.className='w-full h-full rounded-full object-cover';img.alt='';img.src=URL.createObjectURL(f);box.appendChild(img);});
            var bIn=document.getElementById('banner-input'),bBox=document.getElementById('banner-preview'),bOrig=bBox.innerHTML;
            bIn.addEventListener('change',function(){var f=this.files[0];if(!f)return;var old=bBox.querySelector('img');if(old)old.remove();var img=document.createElement('img');
            img.className='absolute inset-0 w-full h-full object-cover';img.alt='';img.src=URL.createObjectURL(f);bBox.insertBefore(img,bBox.firstChild);});
            document.getElementById('me-form').addEventListener('reset',function(){box.innerHTML=orig;bBox.innerHTML=bOrig;setTimeout(function(){window.updateFilePick&&window.updateFilePick(bIn);});setTimeout(function(){window.updateFilePick&&window.updateFilePick(input);});});})();`,
        }}
      />
    </div>
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
                <div class="small muted">{it.bought} از {it.quantity} خریده شده{variantLabel(it.size, it.color) && ` · ${variantLabel(it.size, it.color)}`}{it.note && ` · یادداشت: ${it.note}`}</div>
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

export interface GiftRow {
  token: string;
  product_id: number;
  product_code: string;
  product_title: string;
  image_key: string;
  status: Order["status"];
  cancel_kind: string;
  at: string;
  tracking_code: string;
  gift_message: string;
  person: string; // the giver (received) or the recipient (given); "" = anonymous
  person_username: string | null;
}

/** "کادوهای من": gifts I received and gifts I gave, as two tabs. */
export function MyGiftsPage(props: { user: User; tab: "received" | "given"; received: GiftRow[]; given: GiftRow[] }) {
  const given = props.tab === "given";
  const rows = given ? props.given : props.received;
  const tab = (key: "received" | "given", icon: string, label: string, n: number) => (
    <a
      href={key === "given" ? "/me/gifts?tab=given" : "/me/gifts"}
      aria-current={props.tab === key ? "page" : undefined}
      class={`flex-1 py-2.5 rounded-xl text-xs font-bold text-center ${props.tab === key ? "bg-brand text-white shadow-lg shadow-brand/20" : "text-muted"}`}
    >
      <i class={`fa-solid ${icon} ml-1`}></i>
      {label} <span class="opacity-70">({fa(n)})</span>
    </a>
  );
  const person = (g: GiftRow) =>
    !g.person ? <span>یک دوست ناشناس</span> : g.person_username ? <a href={`/u/${g.person_username}`} class="text-brand font-bold">{g.person}</a> : <b class="text-fg">{g.person}</b>;
  return (
    <Layout title="کادوهای من" user={props.user} nav="wishes" bare wide>
      <div class="px-4 md:px-10 py-6 md:py-10">
        <h1 class="text-2xl md:text-3xl font-black text-fg mb-1">کادوهای من</h1>
        <p class="text-sm text-muted mb-5">کادوهایی که از لیست آرزویتان برایتان خریده‌اند و کادوهایی که شما به دیگران داده‌اید.</p>
        <div class="flex gap-1 p-1 bg-card rounded-2xl border border-fg/5 mb-6 max-w-md">
          {tab("received", "fa-gift", "دریافتی", props.received.length)}
          {tab("given", "fa-hand-holding-heart", "داده‌شده", props.given.length)}
        </div>
        {rows.length === 0 ? (
          <div class="bg-card rounded-3xl p-8 text-center text-sm text-muted">
            {given ? (
              <>هنوز به کسی کادو نداده‌اید. لینک لیست آرزوی دوستانتان را باز کنید و کادو بدهید.</>
            ) : (
              <>هنوز کادویی نگرفته‌اید. <a href="/me/wishlists" class="text-brand font-bold">لیست آرزویتان</a> را برای دوستانتان بفرستید.</>
            )}
          </div>
        ) : (
          <div class="grid gap-3 md:grid-cols-2">
            {rows.map((g) => (
              <div class="bg-card rounded-2xl p-3 flex gap-3 items-center">
                <a href={g.product_code ? `/p/${g.product_code}` : `/p/${g.product_id}`} class="w-16 h-16 rounded-xl overflow-hidden bg-ink shrink-0 flex items-center justify-center text-2xl">
                  {g.image_key ? <img src={`/img/${g.image_key}`} alt={g.product_title} loading="lazy" class="w-full h-full object-cover" /> : "🎁"}
                </a>
                <div class="flex-1 min-w-0 text-xs leading-6">
                  <h3 class="text-sm font-bold text-fg truncate">{g.product_title}</h3>
                  <p class="text-muted truncate">{given ? <>برای {person(g)}</> : <>از طرف {person(g)}</>}</p>
                  <p class="text-muted">
                    <span class="inline-block px-2 rounded-md bg-ink text-fg/80">{orderStatusLabel(g)}</span>
                    <span class="mr-2 dt">{formatJalali(g.at, false)}</span>
                    {g.tracking_code && <span class="mr-2">کد رهگیری: <span class="dt ltr">{g.tracking_code}</span></span>}
                  </p>
                </div>
                {given && (
                  <a href={`/order/${g.token}`} aria-label="جزئیات سفارش" class="w-9 h-9 rounded-full bg-ink text-muted flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-chevron-left"></i>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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
              <p class="text-xs font-bold text-brand mt-1">{toman(o.amount)}</p>
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
            <p class="text-[11px] text-muted">فروشگاه {o.shop_name}{variantLabel(o.size, o.color) && <> · سفارش: <b class="text-fg">{variantLabel(o.size, o.color)}</b></>}</p>
          </div>
        </section>
        {pending ? (
          <>
            <section class="p-5 bg-brand/5 border border-brand/20 rounded-2xl space-y-2">
              <p class="text-sm text-fg leading-7">
                کالایی که خواسته بودید{variantLabel(o.size, o.color) ? ` (${variantLabel(o.size, o.color)})` : ""} تمام شده. فروشگاه پیشنهاد می‌دهد:
              </p>
              {variantLabel(o.change_size, o.change_color) && <p class="text-lg font-bold text-brand">{variantLabel(o.change_size, o.change_color)}</p>}
              {o.change_message && <p class="text-sm text-fg leading-7 whitespace-pre-wrap">{o.change_message}</p>}
            </section>
            <form method="post" class="space-y-4">
              <label class="block text-xs text-muted">توضیح شما برای فروشگاه (مثلاً رنگ انتخابی) — اختیاری</label>
              <input name="reply" maxlength={200} class="w-full bg-card border border-muted/10 rounded-xl px-4 py-3 text-sm text-fg outline-hidden focus:border-brand" />
              <button name="answer" value="accept" class="w-full py-4 bg-brand text-white rounded-2xl font-bold">✓ قبول می‌کنم</button>
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
              <>✅ پیشنهاد را پذیرفتید{variantLabel(o.size, o.color) ? ` (${variantLabel(o.size, o.color)})` : ""}؛ فروشگاه کادو را با همین مشخصات می‌فرستد.</>
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
        <a href={`/me/changes/${c.id}`} class="flex items-center gap-3 p-4 rounded-2xl bg-brand/10 border border-brand/30 text-sm">
          <i class="fa-solid fa-arrows-rotate text-brand"></i>
          <span class="flex-1">«{c.product_title}» تمام شده؛ فروشگاه پیشنهاد تغییر داده. پاسخ دهید</span>
          <i class="fa-solid fa-chevron-left text-muted text-xs"></i>
        </a>
      ))}
    </section>
  );
}
