import type { Child } from "hono/jsx";
import type { User } from "../../session";
import type { BaleLink } from "../../bale/links";
import type { ContactRow, CrmMessage, FieldDef } from "../db";
import type { Dossier, Gift } from "../dossier";
import { CONTACT_KEY, CORE_FIELDS, SECTIONS, contactName, type ContactData } from "../fields";
import type { Extras, LogRow, Snapshot } from "../history";
import { formatJalali } from "../../../lib/jalali";
import { birthdayLabel } from "../../../lib/people";
import { toman } from "../../shop/db";
import { Errors, Layout, Stat } from "./layout";

// Super-admin CRM screens, after the UX Pilot "Super Admin CRM" designs: client list, client profile
// (with everything the site knows about the person), activity log, custom fields, operations team.

const ACTION_LABEL: Record<string, string> = { create: "ایجاد", update: "ویرایش", delete: "حذف" };
const fa = (n: number) => n.toLocaleString("fa-IR");
const date = (iso: string | null | undefined, time = true) => (iso ? formatJalali(iso, time) : "—");
const clientId = (id: number) => `KDC-${id}`;

const GIFT_STATUS: Record<string, [string, string]> = {
  awaiting: ["منتظر تأیید واریز", "bg-amber-50 text-amber-700"],
  paid: ["پرداخت‌شده", "bg-sky-50 text-sky-700"],
  shipped: ["ارسال‌شده", "bg-emerald-50 text-emerald-700"],
  delivered: ["تحویل‌شده", "bg-emerald-50 text-emerald-700"],
};

function Initial(props: { name: string; size?: string }) {
  return (
    <span class={`${props.size ?? "w-10 h-10"} rounded-xl bg-sky-50 text-sky-600 font-black flex items-center justify-center shrink-0`}>
      {(props.name.replace(/^@/, "").trim()[0] ?? "؟").toUpperCase()}
    </span>
  );
}

function Badge(props: { tone: string; children: Child }) {
  return <span class={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${props.tone}`}>{props.children}</span>;
}

function Card(props: { id?: string; icon: string; title: string; note?: Child; children?: Child; flush?: boolean }) {
  return (
    <section id={props.id} class="bg-white rounded-[28px] border border-sky-100 shadow-sm overflow-hidden mb-6">
      <div class="px-6 md:px-8 py-4 border-b border-sky-50 bg-sky-50/30 flex items-center justify-between gap-3">
        <h2 class="!mb-0 !text-sm font-black text-sky-900 flex items-center gap-2"><i class={`fa-solid ${props.icon} text-sky-500`}></i> {props.title}</h2>
        {props.note && <span class="text-[10px] font-bold text-slate-400">{props.note}</span>}
      </div>
      <div class={props.flush ? "" : "p-6 md:p-8"}>{props.children}</div>
    </section>
  );
}

function Pager(props: { page: number; hasNext: boolean; base: string }) {
  const sep = props.base.includes("?") ? "&" : "?";
  if (props.page <= 1 && !props.hasNext) return null;
  return (
    <div class="px-6 py-4 border-t border-sky-50 flex items-center justify-between">
      <span class="text-[11px] font-bold text-slate-400">صفحه {fa(props.page)}</span>
      <div class="flex gap-2">
        {props.page > 1 && <a class="btn small secondary" href={`${props.base}${sep}page=${props.page - 1}`}>قبلی</a>}
        {props.hasNext && <a class="btn small secondary" href={`${props.base}${sep}page=${props.page + 1}`}>بعدی</a>}
      </div>
    </div>
  );
}

// ---------- client list ----------

export interface ListStats {
  total: number;
  newMonth: number;
  accounts: number;
  buyers: number;
}

export interface ListFacts {
  accounts: Set<string>;
  buyers: Set<string>;
  last: Map<number, string>;
}

export function ListPage(props: { user: User; q: string; page: number; rows: ContactRow[]; hasNext: boolean; stats: ListStats; facts: ListFacts }) {
  const base = props.q ? `/crm?q=${encodeURIComponent(props.q)}` : "/crm";
  const st = props.stats;
  const f = props.facts;
  return (
    <Layout
      title="لیست مشتریان"
      sub="مدیریت و جستجوی همه مشتریان و کاربران پلتفرم"
      user={props.user}
      on="clients"
      wide
      actions={
        <>
          <a class="btn small secondary" href={`/crm/export.csv${props.q ? `?q=${encodeURIComponent(props.q)}` : ""}`}><i class="fa-solid fa-download"></i> خروجی اکسل</a>
          <a class="btn small" href="/crm/contacts/new"><i class="fa-solid fa-plus"></i> مشتری جدید</a>
        </>
      }
    >
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat icon="fa-users" tone="bg-sky-50 text-sky-500" label="کل مشتریان" value={`${fa(st.total)} نفر`} />
        <Stat icon="fa-user-plus" tone="bg-emerald-50 text-emerald-500" label="مشتریان جدید (۳۰ روز)" value={`${fa(st.newMonth)} نفر`} />
        <Stat icon="fa-id-card" tone="bg-violet-50 text-violet-500" label="دارای حساب در سایت" value={`${fa(st.accounts)} نفر`} />
        <Stat icon="fa-gift" tone="bg-amber-50 text-amber-500" label="خریدار کادو" value={`${fa(st.buyers)} نفر`} />
      </div>
      <div class="bg-white rounded-[28px] border border-sky-100 shadow-sm overflow-hidden">
        <form method="get" action="/crm" class="p-4 md:p-6 border-b border-sky-50 flex gap-2">
          <input name="q" value={props.q} placeholder="جستجو بر اساس نام، موبایل، کد ملی، آیدی یا هر فیلد…" class="flex-1" />
          <button><i class="fa-solid fa-magnifying-glass"></i><span class="hidden sm:inline">جستجو</span></button>
        </form>
        {props.rows.length === 0 ? (
          <p class="muted small text-center py-12">{props.q ? "موردی پیدا نشد." : "هنوز مشتری‌ای ثبت نشده. اولین مشتری را اضافه کنید."}</p>
        ) : (
          <>
            <table class="hidden md:table w-full text-sm">
              <thead class="bg-sky-50/40 text-[11px] text-slate-400">
                <tr>
                  <th class="text-right font-black px-6 py-4">نام و مشخصات</th>
                  <th class="text-right font-black px-6 py-4">شناسه</th>
                  <th class="text-right font-black px-6 py-4">شماره تماس</th>
                  <th class="text-right font-black px-6 py-4">آخرین فعالیت</th>
                  <th class="text-right font-black px-6 py-4">وضعیت</th>
                  <th class="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-sky-50">
                {props.rows.map((c) => {
                  const hasAccount = f.accounts.has(c.phone) || f.accounts.has(c.phone2);
                  const buyer = f.buyers.has(c.phone) || f.buyers.has(c.phone2);
                  return (
                    <tr class="hover:bg-sky-50/30">
                      <td class="px-6 py-4">
                        <a href={`/crm/contacts/${c.id}`} class="flex items-center gap-3 !text-sky-900">
                          <Initial name={contactName(c)} />
                          <span class="min-w-0">
                            <b class="block truncate">{contactName(c)} {buyer && <i class="fa-solid fa-gift text-amber-500 text-xs" title="خریدار کادو"></i>}</b>
                            <span class="text-[10px] font-bold text-slate-400 ltr block text-right">{c.instagram_id ? `@${c.instagram_id}` : c.telegram_id ? `@${c.telegram_id}` : c.national_code}</span>
                          </span>
                        </a>
                      </td>
                      <td class="px-6 py-4"><span class="text-xs font-bold text-sky-600 bg-sky-50 px-2 py-1 rounded-lg ltr inline-block">{clientId(c.id)}</span></td>
                      <td class="px-6 py-4"><span class="dt text-xs font-bold">{c.phone || "—"}</span></td>
                      <td class="px-6 py-4">
                        <p class="text-xs font-bold"><span class="dt">{date(c.updated_at, false)}</span></p>
                        <p class="text-[10px] text-slate-400">{f.last.get(c.id) ?? ""}</p>
                      </td>
                      <td class="px-6 py-4">
                        <div class="flex flex-wrap gap-1">
                          {hasAccount ? <Badge tone="bg-emerald-50 text-emerald-600">حساب سایت</Badge> : <Badge tone="bg-slate-100 text-slate-500">فقط CRM</Badge>}
                          {c.bale_linked ? <Badge tone="bg-sky-50 text-sky-600">بله ✓</Badge> : null}
                        </div>
                      </td>
                      <td class="px-6 py-4">
                        <div class="flex gap-1.5 justify-end">
                          <a href={`/crm/contacts/${c.id}`} title="پرونده" aria-label="پرونده" class="w-9 h-9 rounded-xl bg-sky-50 !text-sky-600 flex items-center justify-center hover:bg-sky-500 hover:!text-white"><i class="fa-solid fa-eye"></i></a>
                          <a href={`/crm/contacts/${c.id}/history`} title="تاریخچه" aria-label="تاریخچه" class="w-9 h-9 rounded-xl bg-slate-50 !text-slate-500 flex items-center justify-center hover:bg-slate-200"><i class="fa-solid fa-clock-rotate-left"></i></a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div class="md:hidden divide-y divide-sky-50">
              {props.rows.map((c) => (
                <a href={`/crm/contacts/${c.id}`} class="flex items-center gap-3 p-4 !text-sky-900">
                  <Initial name={contactName(c)} />
                  <div class="flex-1 min-w-0">
                    <b class="text-sm block truncate">{contactName(c)}</b>
                    <span class="text-[11px] text-slate-400"><span class="dt">{c.phone}</span> · {clientId(c.id)}</span>
                  </div>
                  <span class="text-[10px] text-slate-400 dt">{date(c.updated_at, false)}</span>
                </a>
              ))}
            </div>
          </>
        )}
        <Pager page={props.page} hasNext={props.hasNext} base={base} />
      </div>
    </Layout>
  );
}

// ---------- client profile ----------

const SECTION_ICON: Record<string, string> = {
  "مشخصات": "fa-user",
  "تماس": "fa-phone",
  "شبکه‌های اجتماعی": "fa-at",
  "آدرس": "fa-location-dot",
  "سایر": "fa-note-sticky",
};

function FieldInput(props: { name: string; label: string; kind: string; value: string; error?: string; history?: string }) {
  const ltr = ["phone", "handle", "national", "postal"].includes(props.kind);
  return (
    <div class={props.kind === "textarea" ? "md:col-span-2" : ""}>
      <div class="flex items-center justify-between">
        <label for={props.name} class="!mt-0">{props.label}</label>
        {props.history && (
          <a href={props.history} title="تاریخچه این فیلد" aria-label={`تاریخچه ${props.label}`} class="text-[11px] !text-slate-300 hover:!text-sky-500">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </a>
        )}
      </div>
      {props.kind === "textarea" ? (
        <textarea id={props.name} name={props.name}>{props.value}</textarea>
      ) : (
        <input
          id={props.name}
          name={props.name}
          value={props.value}
          class={ltr ? "ltr" : ""}
          inputmode={props.kind === "text" ? undefined : props.kind === "handle" ? "text" : "tel"}
        />
      )}
      {props.error && <div class="text-xs text-red-600 mt-1">{props.error}</div>}
    </div>
  );
}

export interface Messaging {
  phones: { field: string; label: string; phone: string; link: BaleLink | null }[];
  botReady: boolean;
  safirReady: boolean;
  invite: string;
  messages: CrmMessage[];
}

export function ContactPage(props: {
  user: User;
  contact: ContactRow | null;
  data: ContactData;
  extras: Extras;
  defs: FieldDef[];
  errors?: Record<string, string>;
  formErrors?: string[];
  logs?: LogRow[];
  saved?: boolean;
  messaging?: Messaging;
  notice?: { ok: boolean; text: string };
  dossier?: Dossier;
}) {
  const c = props.contact;
  const title = c ? contactName(c) : "مشتری جدید";
  const d = props.dossier;
  const sections = [...SECTIONS, ...(props.defs.length ? ["فیلدهای منعطف"] : [])];
  const form = (
    <form method="post" action={c ? `/crm/contacts/${c.id}` : "/crm/contacts/new"} id="client-form">
      {SECTIONS.map((section, i) => (
        <Card icon={SECTION_ICON[section] ?? "fa-circle"} title={section} note={`بخش ${fa(i + 1)} از ${fa(sections.length)}`}>
          <div class="grid md:grid-cols-2 gap-x-6 gap-y-4">
            {CORE_FIELDS.filter((f) => f.section === section).map((f) => (
              <FieldInput
                name={f.name}
                label={f.label}
                kind={f.kind}
                value={props.data[f.name] ?? ""}
                error={props.errors?.[f.name]}
                history={c ? `/crm/contacts/${c.id}/history?field=${encodeURIComponent(f.name)}` : undefined}
              />
            ))}
          </div>
        </Card>
      ))}
      {props.defs.length > 0 && (
        <Card icon="fa-list" title="فیلدهای منعطف" note={<a href="/crm/fields">مدیریت فیلدها</a>}>
          <div class="grid md:grid-cols-2 gap-x-6 gap-y-4">
            {props.defs.map((df) => (
              <FieldInput name={`extra_${df.id}`} label={df.name} kind="text" value={props.extras.get(df.id) ?? ""} />
            ))}
          </div>
        </Card>
      )}
      <div class="flex items-center gap-3">
        <button><i class="fa-solid fa-floppy-disk"></i> {c ? "ثبت نهایی تغییرات" : "ثبت مشتری"}</button>
        {c && <span class="text-[11px] text-slate-400">ایجاد: <span class="dt">{date(c.created_at)}</span> · آخرین ویرایش: <span class="dt">{date(c.updated_at)}</span></span>}
      </div>
    </form>
  );
  if (!c) {
    return (
      <Layout title="مشتری جدید" sub={<a href="/crm">لیست مشتریان</a>} user={props.user} on="clients">
        <Errors errors={props.formErrors} />
        <div class="max-w-3xl mx-auto">{form}</div>
      </Layout>
    );
  }
  return (
    <Layout
      title="پروفایل مشتری"
      sub={<><a href="/crm">لیست مشتریان</a> <i class="fa-solid fa-chevron-left text-[8px] mx-1"></i> <span class="text-sky-500">{title}</span></>}
      user={props.user}
      on="clients"
      wide
      actions={
        <>
          <a class="btn small secondary" href={`/crm/contacts/${c.id}/snapshot`}><i class="fa-solid fa-camera"></i> اسنپ‌شات تاریخ</a>
          <button form="client-form" class="small"><i class="fa-solid fa-floppy-disk"></i> ثبت نهایی تغییرات</button>
        </>
      }
    >
      {props.saved && <div class="okbox">ذخیره شد.</div>}
      <Errors errors={props.formErrors} />
      <div class="grid xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        <div class="min-w-0">
          <ClientHeader c={c} d={d} />
          {d && <DossierView c={c} d={d} />}
          {form}
          <form method="post" action={`/crm/contacts/${c.id}/delete`} onsubmit="return confirm('این مشتری حذف شود؟ سابقه تغییراتش باقی می‌ماند.')" class="mt-6">
            <button class="danger small"><i class="fa-solid fa-trash"></i> حذف مشتری</button>
          </form>
        </div>
        <aside class="space-y-6 xl:sticky xl:top-28">
          {props.messaging && <MessagingCard contactId={c.id} m={props.messaging} notice={props.notice} name={title} />}
          <HistoryTimeline contactId={c.id} logs={props.logs ?? []} />
        </aside>
      </div>
    </Layout>
  );
}

function ClientHeader(props: { c: ContactRow; d?: Dossier }) {
  const c = props.c;
  const a = props.d?.account;
  const name = contactName(c);
  const vip = (props.d?.totals.spent ?? 0) > 0 && (props.d?.bought.length ?? 0) >= 3;
  return (
    <div class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-6 md:p-8 mb-6 flex flex-wrap items-center gap-5">
      <div class="relative">
        <Initial name={name} size="w-20 h-20 text-3xl !rounded-[24px] border-4 border-sky-50" />
        {a && <span class="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 border-2 border-white rounded-full" title="حساب سایت دارد"></span>}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="!mb-0 !text-2xl font-black text-sky-900">{name}</h2>
          {vip && <Badge tone="bg-amber-50 text-amber-600"><i class="fa-solid fa-crown"></i> مشتری ویژه</Badge>}
          {a?.shop_name && <Badge tone="bg-violet-50 text-violet-600">صاحب فروشگاه «{a.shop_name}»</Badge>}
          {a?.is_admin ? <Badge tone="bg-sky-50 text-sky-600">مدیر پلتفرم</Badge> : null}
        </div>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 text-xs font-bold text-slate-500">
          <span><i class="fa-solid fa-fingerprint text-sky-500 ml-1"></i>شناسه: <span class="ltr">{clientId(c.id)}</span></span>
          <span><i class="fa-solid fa-calendar text-sky-500 ml-1"></i>ثبت در CRM: <span class="dt">{date(c.created_at, false)}</span></span>
          {a && <span><i class="fa-solid fa-id-card text-sky-500 ml-1"></i>عضو سایت از <span class="dt">{date(a.created_at, false)}</span></span>}
          {c.phone && <a href={`tel:${c.phone}`}><i class="fa-solid fa-phone text-sky-500 ml-1"></i><span class="dt">{c.phone}</span></a>}
        </div>
      </div>
    </div>
  );
}

function GiftTable(props: { gifts: Gift[]; kind: "bought" | "received" }) {
  if (!props.gifts.length) return <p class="muted small text-center py-8">{props.kind === "bought" ? "کادویی نخریده است." : "کادویی دریافت نکرده است."}</p>;
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-sky-50/40 text-[11px] text-slate-400">
          <tr>
            <th class="text-right font-black px-6 py-3">کادو</th>
            <th class="text-right font-black px-6 py-3">{props.kind === "bought" ? "برای" : "از طرف"}</th>
            <th class="text-right font-black px-6 py-3">مبلغ</th>
            <th class="text-right font-black px-6 py-3">وضعیت</th>
            <th class="text-right font-black px-6 py-3">تاریخ</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-sky-50">
          {props.gifts.map((g) => {
            const [label, tone] = GIFT_STATUS[g.status] ?? [g.status, "bg-slate-100 text-slate-500"];
            return (
              <tr>
                <td class="px-6 py-3">
                  <b class="block">{g.product_title}</b>
                  <span class="text-[10px] text-slate-400">{g.shop_name}{g.wishlist_title && !g.is_direct ? ` · لیست «${g.wishlist_title}»` : ""}</span>
                </td>
                <td class="px-6 py-3">
                  {props.kind === "bought" && g.is_direct ? (
                    <Badge tone="bg-slate-100 text-slate-500">برای خودش</Badge>
                  ) : (
                    <>
                      <b class="block text-xs">{g.other_name || "—"} {g.is_anonymous ? <Badge tone="bg-slate-100 text-slate-500">ناشناس</Badge> : null}</b>
                      <span class="text-[10px] text-slate-400 dt">{g.other_phone}</span>
                    </>
                  )}
                </td>
                <td class="px-6 py-3 font-bold whitespace-nowrap">{toman(g.amount)}</td>
                <td class="px-6 py-3"><Badge tone={tone}>{label}</Badge></td>
                <td class="px-6 py-3 text-xs whitespace-nowrap"><a href={`/order/${g.token}`} target="_blank" rel="noopener" class="dt">{date(g.created_at, false)}</a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DossierView(props: { c: ContactRow; d: Dossier }) {
  const d = props.d;
  const a = d.account;
  const tabs: [string, string, number][] = [
    ["#addresses", "آدرس‌ها", d.addresses.length],
    ["#friends", "ارتباطات", d.friends.length],
    ["#bought", "کادوهای خریده", d.bought.length],
    ["#received", "کادوهای دریافتی", d.received.length],
    ["#wishlists", "لیست‌ها", d.wishlists.length],
    ["#shops", "فروشگاه‌ها", d.shops.length],
    ["#client-form", "اطلاعات پرونده", 0],
  ];
  return (
    <>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat icon="fa-bag-shopping" tone="bg-amber-50 text-amber-500" label="خرید کادو" value={toman(d.totals.spent)} note={`${fa(d.bought.length)} کادو`} />
        <Stat icon="fa-gift" tone="bg-rose-50 text-rose-500" label="کادوی دریافتی" value={toman(d.totals.received)} note={`${fa(d.received.length)} کادو`} />
        <Stat icon="fa-user-group" tone="bg-sky-50 text-sky-500" label="ارتباطات از کادوها" value={`${fa(d.friends.length)} نفر`} />
        <Stat icon="fa-location-dot" tone="bg-emerald-50 text-emerald-500" label="آدرس‌ها" value={`${fa(d.addresses.length)} آدرس`} />
      </div>
      <nav class="flex gap-2 overflow-x-auto no-scrollbar mb-6" aria-label="بخش‌های پرونده">
        {tabs.map(([href, label, n]) => (
          <a href={href} class="px-4 py-2 rounded-xl bg-white border border-sky-100 text-xs font-bold !text-slate-600 whitespace-nowrap hover:!text-sky-600 hover:border-sky-300">
            {label}{n ? <span class="mr-1.5 px-1.5 rounded-md bg-sky-50 text-sky-600 text-[10px]">{fa(n)}</span> : null}
          </a>
        ))}
      </nav>

      <Card icon="fa-id-card" title="حساب کاربری در سایت" note={d.phones.length ? `جستجو با ${d.phones.map((p) => p).join("، ")}` : "شماره موبایل ندارد"}>
        {!a ? (
          <p class="muted small">با این شماره‌ها حسابی در سایت ساخته نشده است.</p>
        ) : (
          <dl class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><dt class="text-[10px] font-black text-slate-400">نام در سایت</dt><dd class="font-bold">{a.name}</dd></div>
            <div><dt class="text-[10px] font-black text-slate-400">پروفایل عمومی</dt><dd class="font-bold">{a.username ? <a href={`/u/${a.username}`} target="_blank" rel="noopener" class="ltr">@{a.username}</a> : "—"}</dd></div>
            <div><dt class="text-[10px] font-black text-slate-400">تولد</dt><dd class="font-bold">{a.birth_date ? `${birthdayLabel(a.birth_date)} ${a.birth_date.slice(0, 4)}` : "—"}</dd></div>
            <div><dt class="text-[10px] font-black text-slate-400">عضویت</dt><dd class="font-bold dt">{date(a.created_at, false)}</dd></div>
            <div><dt class="text-[10px] font-black text-slate-400">بات‌ها</dt><dd class="flex gap-1 mt-0.5">{a.bale_chat_id ? <Badge tone="bg-emerald-50 text-emerald-600">بله ✓</Badge> : null}{a.telegram_chat_id ? <Badge tone="bg-emerald-50 text-emerald-600">تلگرام ✓</Badge> : null}{!a.bale_chat_id && !a.telegram_chat_id ? "—" : null}</dd></div>
            {a.shop_slug && <div><dt class="text-[10px] font-black text-slate-400">فروشگاه</dt><dd class="font-bold"><a href={`/s/${a.shop_slug}`} target="_blank" rel="noopener">{a.shop_name}</a></dd></div>}
          </dl>
        )}
      </Card>

      <Card id="addresses" icon="fa-location-dot" title="همه آدرس‌ها" note="از پرونده، لیست‌ها، ارسال کادوها و فروشگاه‌ها">
        {d.addresses.length === 0 ? (
          <p class="muted small">آدرسی ثبت نشده است.</p>
        ) : (
          <div class="grid md:grid-cols-2 gap-3">
            {d.addresses.map((ad) => (
              <div class="rounded-2xl border border-sky-100 p-4">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <Badge tone="bg-sky-50 text-sky-600">{ad.source}</Badge>
                  {ad.at && <span class="text-[10px] text-slate-400 dt">{date(ad.at, false)}</span>}
                </div>
                <p class="text-sm font-bold leading-7">{[ad.city, ad.address].filter(Boolean).join("، ")}</p>
                <p class="text-[11px] text-slate-500">
                  {ad.name && <>گیرنده: {ad.name} </>}
                  {ad.phone && <span class="dt">{ad.phone}</span>}
                  {ad.postal && <> · کد پستی <span class="dt">{ad.postal}</span></>}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card id="friends" icon="fa-user-group" title="ارتباطات از کادوها" note="کسانی که برایشان کادو خریده یا از آن‌ها کادو گرفته" flush>
        {d.friends.length === 0 ? (
          <p class="muted small text-center py-8">هنوز از طریق کادو با کسی در ارتباط نبوده است.</p>
        ) : (
          <div class="divide-y divide-sky-50">
            {d.friends.map((f) => (
              <div class="flex flex-wrap items-center gap-3 px-6 py-3">
                <Initial name={f.name || f.phone} />
                <div class="flex-1 min-w-[160px]">
                  <b class="text-sm">{f.contactId ? <a href={`/crm/contacts/${f.contactId}`}>{f.name || "بی‌نام"}</a> : f.name || "بی‌نام"}</b>
                  {f.anonymous && <Badge tone="bg-slate-100 text-slate-500">ناشناس داده</Badge>}
                  <div class="text-[11px] text-slate-400">
                    <span class="dt">{f.phone}</span>
                    {f.username && <> · <a href={`/u/${f.username}`} target="_blank" rel="noopener" class="ltr">@{f.username}</a></>}
                    {" · آخرین: "}<span class="dt">{date(f.last, false)}</span>
                  </div>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {f.gaveCount > 0 && <Badge tone="bg-amber-50 text-amber-700"><i class="fa-solid fa-arrow-left"></i> برایش {fa(f.gaveCount)} کادو · {toman(f.gaveAmount)}</Badge>}
                  {f.gotCount > 0 && <Badge tone="bg-rose-50 text-rose-600"><i class="fa-solid fa-arrow-right"></i> از او {fa(f.gotCount)} کادو · {toman(f.gotAmount)}</Badge>}
                  {!f.contactId && <Badge tone="bg-slate-50 text-slate-400">در CRM نیست</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card id="bought" icon="fa-bag-shopping" title="کادوهایی که خریده" note={toman(d.totals.spent)} flush>
        <GiftTable gifts={d.bought} kind="bought" />
      </Card>
      <Card id="received" icon="fa-gift" title="کادوهایی که دریافت کرده" note={toman(d.totals.received)} flush>
        <GiftTable gifts={d.received} kind="received" />
      </Card>

      <Card id="wishlists" icon="fa-heart" title="لیست‌های آرزو">
        {d.wishlists.length === 0 ? (
          <p class="muted small">لیستی ندارد.</p>
        ) : (
          <div class="grid md:grid-cols-2 gap-3">
            {d.wishlists.map((w) => (
              <a href={`/w/${w.slug}`} target="_blank" rel="noopener" class="rounded-2xl border border-sky-100 p-4 flex items-center gap-3 !text-sky-900 hover:border-sky-300">
                <span class="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center"><i class="fa-solid fa-heart"></i></span>
                <div class="flex-1 min-w-0">
                  <b class="text-sm block truncate">{w.title}</b>
                  <span class="text-[11px] text-slate-400">{fa(w.items)} آرزو{w.occasion_date ? ` · مناسبت ${w.occasion_date}` : ""} · <span class="dt">{date(w.created_at, false)}</span></span>
                </div>
                <Badge tone={w.is_open ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}>{w.is_open ? "باز" : "بسته"}</Badge>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card id="shops" icon="fa-store" title="پرونده در فروشگاه‌ها" note="CRM فروشگاه‌ها (دایرکت و فروش)" flush>
        {d.shops.length === 0 ? (
          <p class="muted small text-center py-8">در CRM هیچ فروشگاهی ثبت نشده است.</p>
        ) : (
          <div class="divide-y divide-sky-50">
            {d.shops.map((s) => (
              <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                <div>
                  <b>{s.shop_name}</b>
                  <span class="text-[11px] text-slate-400"> · منبع: {s.source || "—"}</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <Badge tone="bg-sky-50 text-sky-600">{STAGE_FA[s.stage] ?? s.stage}</Badge>
                  <Badge tone="bg-slate-50 text-slate-600">{fa(s.orders_count)} سفارش · {toman(s.total_spent)}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

const STAGE_FA: Record<string, string> = { lead: "سرنخ", interested: "علاقه‌مند", offer_sent: "پیشنهاد داده شد", purchased: "خریدار" };

function MessagingCard(props: { contactId: number; m: Messaging; notice?: { ok: boolean; text: string }; name: string }) {
  const { m } = props;
  const anyLinked = m.phones.some((p) => p.link);
  const canSend = (m.botReady && anyLinked) || m.safirReady;
  return (
    <section id="messages" class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-6">
      <h2 class="!text-sm font-black text-sky-900 flex items-center gap-2"><i class="fa-solid fa-comment-dots text-sky-500"></i> ارتباط با مشتری</h2>
      {props.notice && <div class={props.notice.ok ? "okbox" : "errbox"}>{props.notice.text}</div>}
      {m.phones.length === 0 ? (
        <p class="muted small">این مشتری شماره موبایل ندارد.</p>
      ) : (
        <div class="space-y-1.5 mb-3">
          {m.phones.map((p) => (
            <div class="flex items-center justify-between gap-2 text-xs">
              <span>{p.label}: <span class="dt font-bold">{p.phone}</span></span>
              {p.link ? <Badge tone="bg-emerald-50 text-emerald-600">بله ✓ رایگان</Badge> : <Badge tone="bg-slate-100 text-slate-500">به بات وصل نیست</Badge>}
            </div>
          ))}
        </div>
      )}
      {m.messages.length > 0 && (
        <div class="rounded-[20px] bg-sky-50/50 border border-sky-100 p-3 space-y-2 max-h-[260px] overflow-y-auto mb-3">
          {[...m.messages].reverse().map((x) => (
            <div class="flex flex-col items-end">
              <div class={`max-w-[90%] px-3 py-2 rounded-2xl rounded-bl-sm text-[11px] leading-6 whitespace-pre-wrap ${x.status === "sent" ? "bg-sky-500 text-white" : "bg-red-50 text-red-700 border border-red-100"}`}>{x.text}</div>
              <span class="text-[9px] text-slate-400 mt-0.5">
                <span class="dt">{date(x.sent_at)}</span> · {x.channel === "bot" ? "بات بله" : "سفیر"} · {x.username}
                {x.status !== "sent" && <> · ناموفق: {x.error}</>}
              </span>
            </div>
          ))}
        </div>
      )}
      {m.invite && m.phones.some((p) => !p.link) && (
        <p class="text-[10px] text-slate-400 leading-5">برای پیام رایگان، این لینک را برای مشتری بفرستید: <span class="dt">{m.invite}</span></p>
      )}
      {!m.botReady && !m.safirReady && <p class="muted small">بات بله یا سفیر در تنظیمات سایت فعال نشده است.</p>}
      {m.phones.length > 0 && canSend && (
        <form method="post" action={`/crm/contacts/${props.contactId}/message`}>
          <select name="phone" aria-label="شماره">
            {m.phones.map((p) => (
              <option value={p.phone}>{p.label}: {p.phone}{p.link ? " (بات)" : ""}</option>
            ))}
          </select>
          <textarea name="text" required maxlength={4000} placeholder="پیام خود را بنویسید…" style="min-height:70px;margin-top:8px"></textarea>
          <div class="flex gap-2 mt-2">
            {m.botReady && anyLinked && <button name="channel" value="bot" class="flex-1 small"><i class="fa-solid fa-paper-plane"></i> بله (رایگان)</button>}
            {m.safirReady && (
              <button name="channel" value="safir" class="flex-1 small secondary" onclick="return confirm('ارسال از طریق سفیر هزینه دارد. ادامه می‌دهید؟')">
                پیامک سفیر
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function HistoryTimeline(props: { contactId: number; logs: LogRow[] }) {
  const rows = props.logs.slice(0, 12);
  return (
    <section class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="!mb-0 !text-sm font-black text-sky-900 flex items-center gap-2"><i class="fa-solid fa-clock-rotate-left text-sky-500"></i> تاریخچه تغییرات و اسنپ‌شات‌ها</h2>
        <a href={`/crm/contacts/${props.contactId}/history`} class="text-[10px] font-black">مشاهده همه</a>
      </div>
      {rows.length === 0 ? (
        <p class="muted small">تغییری ثبت نشده است.</p>
      ) : (
        <ol class="relative space-y-4 pr-5 border-r-2 border-sky-100">
          {rows.map((l, i) => (
            <li class={`relative ${i ? "opacity-80" : ""}`}>
              <span class={`absolute -right-[27px] top-1 w-4 h-4 rounded-full ring-4 ring-sky-50 ${i ? "bg-slate-300" : "bg-sky-500"}`}></span>
              <div class="rounded-2xl border border-sky-100 p-3">
                <p class="text-xs font-black text-sky-900">
                  {l.field_name === CONTACT_KEY ? l.field_label : `${ACTION_LABEL[l.action]} ${l.field_label}`}
                </p>
                {l.field_name !== CONTACT_KEY && (
                  <p class="text-[11px] text-slate-500 mt-1 break-words">
                    <span class="line-through text-slate-400">{l.old_value || "—"}</span> ← <b>{l.new_value || "—"}</b>
                  </p>
                )}
                <div class="flex items-center justify-between mt-2 text-[10px] text-slate-400">
                  <span>توسط <b class="text-sky-900">{l.username || "سیستم"}</b></span>
                  <span class="dt">{date(l.changed_at)}</span>
                </div>
                <a href={`/crm/contacts/${props.contactId}/snapshot?at=${encodeURIComponent(formatJalali(l.changed_at))}`} class="block mt-2 pt-2 border-t border-sky-50 text-[10px] font-black">
                  <i class="fa-solid fa-eye ml-1"></i> مشاهده اسنپ‌شات
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- field history, snapshot ----------

export function LogTable(props: { logs: LogRow[]; showContact: boolean }) {
  const rows = props.logs.filter((l) => props.showContact || l.field_name !== CONTACT_KEY);
  if (!rows.length) return <p class="muted small text-center py-8">تغییری ثبت نشده است.</p>;
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-sky-50/40 text-[11px] text-slate-400">
          <tr>
            <th class="text-right font-black px-5 py-3">زمان</th>
            {props.showContact && <th class="text-right font-black px-5 py-3">مشتری</th>}
            <th class="text-right font-black px-5 py-3">فیلد</th>
            <th class="text-right font-black px-5 py-3">عملیات</th>
            <th class="text-right font-black px-5 py-3">مقدار قبلی</th>
            <th class="text-right font-black px-5 py-3">مقدار جدید</th>
            <th class="text-right font-black px-5 py-3">کاربر</th>
            <th class="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-sky-50">
          {rows.map((l) => (
            <tr>
              <td class="px-5 py-3 whitespace-nowrap text-xs"><span class="dt">{date(l.changed_at)}</span></td>
              {props.showContact && <td class="px-5 py-3"><a href={`/crm/contacts/${l.contact_id}`}>{l.contact_repr}</a></td>}
              <td class="px-5 py-3">
                {l.field_name === CONTACT_KEY ? l.field_label : <a href={`/crm/contacts/${l.contact_id}/history?field=${encodeURIComponent(l.field_name)}`}>{l.field_label}</a>}
              </td>
              <td class="px-5 py-3"><Badge tone="bg-sky-50 text-sky-600">{ACTION_LABEL[l.action]}</Badge></td>
              <td class="px-5 py-3 text-slate-400">{l.old_value || "—"}</td>
              <td class="px-5 py-3 font-bold">{l.new_value || "—"}</td>
              <td class="px-5 py-3 text-slate-500">{l.username || "سیستم"}</td>
              <td class="px-5 py-3 whitespace-nowrap text-xs"><a href={`/crm/contacts/${l.contact_id}/snapshot?at=${encodeURIComponent(formatJalali(l.changed_at))}`}>اسنپ‌شات</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FieldHistoryPage(props: { user: User; contactId: number; name: string; label: string; logs: LogRow[] }) {
  return (
    <Layout title={`تاریخچه «${props.label}»`} sub={<a href={`/crm/contacts/${props.contactId}`}>{props.name}</a>} user={props.user} on="clients">
      <div class="bg-white rounded-[28px] border border-sky-100 shadow-sm overflow-hidden"><LogTable logs={props.logs} showContact={false} /></div>
    </Layout>
  );
}

export function SnapshotPage(props: { user: User; contactId: number; name: string; atText: string; snap: Snapshot | null; error?: string }) {
  const s = props.snap;
  return (
    <Layout title="اسنپ‌شات پرونده" sub={<a href={`/crm/contacts/${props.contactId}`}>{props.name}</a>} user={props.user} on="clients">
      <form method="get" class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-5 mb-6 flex flex-wrap items-center gap-3">
        <label class="!m-0">تاریخ و ساعت شمسی</label>
        <input name="at" value={props.atText} class="ltr" placeholder="1405/07/09 14:30" style="max-width:220px" />
        <button class="small"><i class="fa-solid fa-camera"></i> نمایش</button>
      </form>
      <Errors errors={props.error ? [props.error] : []} />
      {s && (
        <div class="bg-white rounded-[28px] border border-sky-100 shadow-sm overflow-hidden">
          <div class="px-8 py-4 border-b border-sky-50 bg-sky-50/30 text-sm font-black text-sky-900">وضعیت پرونده در {props.atText}</div>
          {!s.exists && !s.deleted ? (
            <p class="muted small p-8">در این تاریخ هنوز این مشتری ثبت نشده بود.</p>
          ) : (
            <>
              {s.deleted && <div class="errbox m-6">در این تاریخ مشتری حذف شده بود. آخرین مقادیر قبل از حذف:</div>}
              <dl class="grid md:grid-cols-2 gap-x-8 gap-y-4 p-8">
                {[...s.fields, ...s.extras].map(([label, value]) => (
                  <div class="border-b border-sky-50 pb-2">
                    <dt class="text-[10px] font-black text-slate-400">{label}</dt>
                    <dd class="text-sm font-bold whitespace-pre-wrap">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}

// ---------- activity log ----------

export interface HistoryFilter {
  q: string;
  user: string;
  type: string;
}

export function HistoryPage(props: { user: User; logs: LogRow[]; page: number; hasNext: boolean; filter: HistoryFilter; staff: string[] }) {
  const f = props.filter;
  const qs = (o: Partial<HistoryFilter>) => {
    const p = new URLSearchParams();
    const v = { ...f, ...o };
    if (v.q) p.set("q", v.q);
    if (v.user) p.set("user", v.user);
    if (v.type) p.set("type", v.type);
    const s = p.toString();
    return `/crm/history${s ? `?${s}` : ""}`;
  };
  const icon = (l: LogRow): [string, string] =>
    l.action === "create" ? ["fa-user-plus", "bg-amber-50 text-amber-600"] : l.action === "delete" ? ["fa-trash", "bg-red-50 text-red-500"] : ["fa-pen-to-square", "bg-sky-50 text-sky-500"];
  const days = new Map<string, LogRow[]>();
  for (const l of props.logs) {
    const d = formatJalali(l.changed_at, false);
    days.set(d, [...(days.get(d) ?? []), l]);
  }
  return (
    <Layout
      title="لاگ‌های فعالیت سیستم"
      sub="ردیابی همه تغییرات پرونده‌های مشتریان"
      user={props.user}
      on="history"
      actions={
        <div class="flex p-1 rounded-xl bg-sky-50 border border-sky-100">
          {[["", "همه لاگ‌ها"], ["update", "تغییرات داده"], ["create", "ثبت"], ["delete", "حذف"]].map(([k, l]) => (
            <a href={qs({ type: k })} class={`px-3 py-1.5 rounded-lg text-xs font-bold ${f.type === k ? "bg-white shadow-sm !text-sky-600" : "!text-slate-500"}`}>{l}</a>
          ))}
        </div>
      }
    >
      <form method="get" class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-5 mb-6 flex flex-wrap gap-3">
        <input name="q" value={f.q} placeholder="جستجو در لاگ‌ها (نام مشتری، فیلد، مقدار…)" class="flex-1 min-w-[200px]" />
        <select name="user" style="max-width:200px" aria-label="کاربر">
          <option value="">همه کاربران</option>
          {props.staff.map((s) => <option value={s} selected={f.user === s}>{s}</option>)}
        </select>
        {f.type && <input type="hidden" name="type" value={f.type} />}
        <button class="small"><i class="fa-solid fa-magnifying-glass"></i> فیلتر</button>
      </form>
      {props.logs.length === 0 && <p class="muted small text-center py-10">لاگی پیدا نشد.</p>}
      {[...days.entries()].map(([day, logs]) => (
        <div class="mb-6">
          <div class="flex items-center gap-4 mb-4">
            <div class="h-px bg-sky-100 flex-1"></div>
            <span class="text-[10px] font-black text-slate-400 px-4 py-1.5 bg-sky-50 rounded-full border border-sky-100 dt">{day}</span>
            <div class="h-px bg-sky-100 flex-1"></div>
          </div>
          <div class="space-y-3">
            {logs.map((l) => {
              const [ic, tone] = icon(l);
              return (
                <div class={`bg-white rounded-2xl border p-4 flex items-center gap-4 shadow-sm ${l.action === "delete" ? "border-red-100 bg-red-50/20" : "border-sky-100"}`}>
                  <span class={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tone}`}><i class={`fa-solid ${ic}`}></i></span>
                  <div class="flex-1 min-w-0 text-sm leading-7">
                    <b class="text-sky-600">{l.username || "سیستم"}</b>{" "}
                    {l.field_name === CONTACT_KEY ? (
                      <>{l.action === "create" ? "مشتری" : "پرونده"} <b>{l.contact_repr}</b> را {l.action === "create" ? "ثبت کرد" : "حذف کرد"}.</>
                    ) : (
                      <>
                        فیلد <span class="text-sky-600">{l.field_label}</span> را برای <a href={`/crm/contacts/${l.contact_id}`} class="font-black">{l.contact_repr}</a> <span class="text-[11px] text-slate-400 ltr">({clientId(l.contact_id)})</span> تغییر داد:
                        <span class="text-slate-400 line-through mx-1">{l.old_value || "—"}</span>←<b class="mx-1">{l.new_value || "—"}</b>
                      </>
                    )}
                    <div class="flex items-center gap-3 text-[10px] text-slate-400">
                      <span><i class="fa-solid fa-clock ml-1"></i><span class="dt">{formatJalali(l.changed_at).slice(-5)}</span></span>
                      <Badge tone="bg-emerald-50 text-emerald-600">اسنپ‌شات ثبت شد</Badge>
                    </div>
                  </div>
                  <a href={`/crm/contacts/${l.contact_id}/snapshot?at=${encodeURIComponent(formatJalali(l.changed_at))}`} class="hidden sm:inline text-xs font-black shrink-0">مشاهده جزئیات <i class="fa-solid fa-arrow-left"></i></a>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div class="flex justify-center gap-2">
        {props.page > 1 && <a class="btn small secondary" href={`${qs({})}${qs({}).includes("?") ? "&" : "?"}page=${props.page - 1}`}>جدیدتر</a>}
        {props.hasNext && <a class="btn small secondary" href={`${qs({})}${qs({}).includes("?") ? "&" : "?"}page=${props.page + 1}`}>مشاهده لاگ‌های قدیمی‌تر</a>}
      </div>
    </Layout>
  );
}

// ---------- custom fields ----------

export function FieldsPage(props: { user: User; defs: (FieldDef & { used?: number })[]; error?: string }) {
  const admin = !!props.user.is_admin;
  return (
    <Layout
      title="مدیریت فیلدهای منعطف (Custom Fields)"
      sub="فیلدهای اختصاصی پرونده مشتریان، علاوه بر فیلدهای اصلی"
      user={props.user}
      on="fields"
    >
      <Errors errors={props.error ? [props.error] : []} />
      <div class="grid lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-3">
          <h2 class="!text-sm font-black text-sky-900 px-2"><i class="fa-solid fa-folder text-sky-500 ml-1"></i> فیلدهای تعریف‌شده ({fa(props.defs.length)})</h2>
          {props.defs.length === 0 && <p class="muted small">هنوز فیلدی تعریف نشده است.</p>}
          {props.defs.map((d) => (
            <div class="bg-white rounded-2xl border border-sky-100 p-4 flex flex-wrap items-center gap-4 shadow-sm">
              <span class="w-12 h-12 rounded-2xl bg-sky-50 text-sky-500 flex items-center justify-center shrink-0 text-lg"><i class="fa-solid fa-font"></i></span>
              <div class="flex-1 min-w-[140px]">
                <b class="text-sm text-sky-900">{d.name}</b>
                <p class="text-[10px] text-slate-400">نوع: متن · در {fa(d.used ?? 0)} پرونده پر شده</p>
              </div>
              {admin && (
                <form method="post" action={`/crm/fields/${d.id}/rename`} class="flex gap-2">
                  <input name="name" value={d.name} required style="max-width:200px" aria-label="نام جدید" />
                  <button class="small secondary">تغییر نام</button>
                </form>
              )}
            </div>
          ))}
        </div>
        <div class="space-y-6">
          <div class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-6">
            <h3 class="!text-sm font-black text-sky-900 mb-4"><i class="fa-solid fa-gear text-sky-500 ml-1"></i> تنظیمات فیلد جدید</h3>
            {admin ? (
              <form method="post" action="/crm/fields">
                <label class="!mt-0">عنوان فیلد (برچسب)</label>
                <input name="name" required maxlength={60} placeholder="مثلاً: نام معرف" />
                <button class="w-full mt-4">تأیید و ایجاد فیلد</button>
              </form>
            ) : (
              <p class="muted small">فقط مدیر پلتفرم می‌تواند فیلد جدید تعریف کند.</p>
            )}
          </div>
          <div class="bg-sky-900 rounded-[28px] p-6 text-white shadow-xl">
            <i class="fa-solid fa-circle-info text-sky-300 text-2xl mb-3"></i>
            <h4 class="text-sm font-black mb-2">راهنمای فیلدهای منعطف</h4>
            <p class="text-[11px] text-sky-100 leading-6">
              هر فیلد جدید در فرم همه پرونده‌ها ظاهر می‌شود؛ تغییر مقدارش مثل فیلدهای اصلی در تاریخچه و اسنپ‌شات‌ها ثبت می‌شود. تغییر نام، مقادیر و سابقه را
              نگه می‌دارد.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ---------- operations team ----------

export function UsersPage(props: {
  user: User;
  users: (User & { created_at: string; changes?: number; last_change?: string | null })[];
  error?: string;
  ok?: string;
}) {
  const admins = props.users.filter((u) => u.is_admin).length;
  const staff = props.users.length - admins;
  const today = props.users.reduce((s, u) => s + (u.changes ?? 0), 0);
  return (
    <Layout
      title="تیم عملیات و سطوح دسترسی"
      sub="اعضای پنل CRM، نقش‌ها و فعالیت"
      user={props.user}
      on="team"
      actions={<a class="btn small" href="#add"><i class="fa-solid fa-user-plus"></i> افزودن عضو جدید</a>}
    >
      <Errors errors={props.error ? [props.error] : []} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat icon="fa-id-card" tone="bg-sky-50 text-sky-500" label="کل اعضا" value={`${fa(props.users.length)} نفر`} />
        <Stat icon="fa-shield-halved" tone="bg-emerald-50 text-emerald-500" label="مدیران پلتفرم" value={`${fa(admins)} نفر`} />
        <Stat icon="fa-user-pen" tone="bg-blue-50 text-blue-500" label="کارشناسان CRM" value={`${fa(staff)} نفر`} />
        <Stat icon="fa-pen-to-square" tone="bg-amber-50 text-amber-500" label="تغییرات امروز" value={fa(today)} />
      </div>
      <div class="grid lg:grid-cols-4 gap-6">
        <div class="lg:col-span-3 bg-white rounded-[28px] border border-sky-100 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-sky-50"><h3 class="!mb-0 !text-sm font-black text-sky-900">لیست اعضای تیم</h3></div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-sky-50/40 text-[11px] text-slate-400">
                <tr>
                  <th class="text-right font-black px-6 py-3">نام</th>
                  <th class="text-right font-black px-6 py-3">نقش سیستم</th>
                  <th class="text-right font-black px-6 py-3">آخرین تغییر در CRM</th>
                  <th class="text-right font-black px-6 py-3">عضویت</th>
                  <th class="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-sky-50">
                {props.users.map((u) => (
                  <tr>
                    <td class="px-6 py-3">
                      <div class="flex items-center gap-3">
                        <Initial name={u.name} />
                        <div><b class="block">{u.name}</b><span class="text-[10px] text-slate-400 dt">{u.phone}</span></div>
                      </div>
                    </td>
                    <td class="px-6 py-3">{u.is_admin ? <Badge tone="bg-emerald-50 text-emerald-600">مدیر پلتفرم</Badge> : <Badge tone="bg-blue-50 text-blue-600">کارشناس CRM</Badge>}</td>
                    <td class="px-6 py-3 text-xs text-slate-500">{u.last_change ? <span class="dt">{date(u.last_change)}</span> : "—"}</td>
                    <td class="px-6 py-3 text-xs text-slate-500"><span class="dt">{date(u.created_at, false)}</span></td>
                    <td class="px-6 py-3">
                      {!u.is_admin && u.id !== props.user.id && (
                        <form method="post" action={`/crm/users/${u.id}/revoke`} onsubmit="return confirm('دسترسی CRM گرفته شود؟')">
                          <button class="small danger"><i class="fa-solid fa-lock"></i> گرفتن دسترسی</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div class="space-y-6">
          <div class="bg-white rounded-[28px] border border-sky-100 shadow-sm p-6">
            <h3 class="!text-sm font-black text-sky-900 mb-4"><i class="fa-solid fa-shield-halved text-sky-500 ml-1"></i> سطوح دسترسی</h3>
            <div class="space-y-2 text-xs">
              <div class="flex items-center justify-between p-3 rounded-2xl bg-sky-50 border border-sky-100"><span><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 ml-2"></span><b>مدیر پلتفرم</b></span><span class="text-slate-400">{fa(admins)} عضو</span></div>
              <div class="flex items-center justify-between p-3 rounded-2xl border border-sky-50"><span><span class="inline-block w-2 h-2 rounded-full bg-blue-500 ml-2"></span><b>کارشناس CRM</b></span><span class="text-slate-400">{fa(staff)} عضو</span></div>
            </div>
            <p class="text-[10px] text-slate-400 leading-5 mt-3">کارشناس: جستجو، ثبت، ویرایش، پیام و خروجی. مدیر: به‌علاوه فیلدها و تیم.</p>
          </div>
          <form id="add" method="post" action="/crm/users" class="bg-sky-50 border border-sky-100 rounded-[28px] p-6">
            <h4 class="text-sm font-black text-sky-900 mb-2">افزودن عضو</h4>
            <p class="text-[10px] text-slate-500 leading-5">اگر شماره در سایت حساب دارد فقط دسترسی داده می‌شود؛ وگرنه با این نام حساب ساخته می‌شود.</p>
            <input name="phone" placeholder="شماره موبایل" class="ltr" required style="margin-top:8px" />
            <input name="name" placeholder="نام (برای حساب جدید)" style="margin-top:8px" />
            <button class="w-full mt-3">افزودن</button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
