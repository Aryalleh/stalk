import type { Child } from "hono/jsx";
import { formatJalali } from "../../../lib/jalali";
import { JALALI_MONTHS, birthdayLabel, currentJalaliYear } from "../../../lib/people";
import type { User } from "../../session";
import { toman, type Shop } from "../db";
import { variantLabel } from "../variants";
import { Errors } from "../views/layout";
import { PANEL_SECTIONS, PanelShell, isShopAdmin } from "../views/panel";
import { RULE_LABEL, type Rule } from "./automation";
import { DEFAULT_COMMENT_REPLY, DEFAULT_DM, DEFAULT_KEYWORDS, type MediaLink } from "./comments";
import {
  CONVERSATION_STATUS,
  CRM_ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  STAGES,
  STAGE_LABEL,
  TASK_TYPES,
  parseTags,
  type Conversation,
  type CrmOrder,
  type CrmOrderItem,
  type Customer,
  type CustomerRow,
  type InboxRow,
  type Message,
  type Stage,
  type Tag,
  type TaskRow,
  type TimelineEntry,
} from "./db";

// Shop CRM screens (light panel theme). Leads are customers in the early stages; the timeline is
// built from messages, notes, tasks and orders.

export interface Ctx {
  user: User;
  shop: Shop;
  unread: number;
}

export interface Member {
  id: number;
  name: string;
  phone: string;
  shop_role: string;
}

const fa = (n: number) => n.toLocaleString("fa-IR");
const date = (iso: string | null | undefined, time = true) => (iso ? formatJalali(iso, time) : "—");

const STAGE_STYLE: Record<Stage, string> = {
  lead: "bg-slate-100 text-slate-600",
  interested: "bg-amber-50 text-amber-700",
  offer_sent: "bg-sky-50 text-sky-700",
  purchased: "bg-emerald-50 text-emerald-700",
};

export function StageBadge(props: { stage: Stage }) {
  return <span class={`text-[10px] px-2 py-0.5 rounded-md font-bold whitespace-nowrap ${STAGE_STYLE[props.stage]}`}>{STAGE_LABEL[props.stage]}</span>;
}

function TagChips(props: { tags: { name: string; color: string }[] }) {
  return (
    <>
      {props.tags.map((t) => (
        <span class="text-[10px] px-2 py-0.5 rounded-full text-white whitespace-nowrap" style={`background:${t.color}`}>{t.name}</span>
      ))}
    </>
  );
}

const displayName = (c: { name: string; username: string; phone?: string }) => c.name || (c.username ? `@${c.username}` : c.phone || "بی‌نام");

function Initial(props: { name: string; size?: string }) {
  return (
    <div class={`${props.size ?? "w-10 h-10"} rounded-full bg-sky-50 text-sky-600 font-bold flex items-center justify-center shrink-0`}>
      {(props.name.replace(/^@/, "").trim()[0] ?? "؟").toUpperCase()}
    </div>
  );
}

function Chip(props: { href: string; on: boolean; children: Child }) {
  return (
    <a
      href={props.href}
      class={`px-3 py-1.5 text-[11px] font-bold rounded-lg border whitespace-nowrap ${props.on ? "bg-sky-500 !text-white border-sky-500 shadow-sm shadow-sky-500/30" : "bg-white !text-slate-500 border-sky-100 hover:!text-sky-600"}`}
    >
      {props.children}
    </a>
  );
}

function Empty(props: { icon: string; children: Child }) {
  return (
    <div class="card text-center muted py-10">
      <i class={`fa-solid ${props.icon} text-3xl mb-3 block text-slate-300`}></i>
      <div class="text-sm">{props.children}</div>
    </div>
  );
}

// ---------- panel menu (phones) ----------

export function MorePage(props: Ctx) {
  const admin = isShopAdmin(props.user, props.shop);
  return (
    <PanelShell title="منو" user={props.user} shop={props.shop} on="more" unread={props.unread}>
      <h1>منوی پنل</h1>
      <div class="grid grid-cols-2 gap-3">
        {PANEL_SECTIONS.filter(([, , , , onlyAdmin]) => admin || !onlyAdmin).map(([, href, icon, label]) => (
          <a href={href} class="card !mb-0 flex items-center gap-3 !text-sky-900">
            <span class="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center"><i class={`fa-solid ${icon}`}></i></span>
            <span class="text-sm font-bold">{label}</span>
          </a>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- inbox ----------

/** Page title with a subtitle and actions on the left (UX Pilot headers). */
export function PageHead(props: { title: string; sub?: string; children?: Child }) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h1 class="!mb-0.5 !text-xl font-black text-sky-900">{props.title}</h1>
        {props.sub && <p class="text-xs text-slate-500">{props.sub}</p>}
      </div>
      {props.children && <div class="flex flex-wrap items-center gap-2">{props.children}</div>}
    </div>
  );
}

function ConversationList(props: { rows: InboxRow[]; active?: number; query: string }) {
  if (!props.rows.length) return <p class="muted small text-center py-10 px-4">گفتگویی نیست. پیام‌های دایرکت اینستاگرام اینجا می‌آیند.</p>;
  return (
    <div class="divide-y divide-sky-50">
      {props.rows.map((r) => (
        <a
          href={`/panel/inbox/${r.id}${props.query}`}
          class={`relative flex items-center gap-3 p-4 !text-sky-900 hover:bg-sky-50/60 ${props.active === r.id ? "bg-sky-50" : ""}`}
        >
          {props.active === r.id && <span class="absolute right-0 inset-y-0 w-1 bg-sky-500 rounded-l" />}
          <Initial name={displayName(r)} size="w-11 h-11" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class={`text-sm truncate ${r.unread ? "font-black" : "font-bold"}`}>{displayName(r)}</span>
              <StageBadge stage={r.stage} />
            </div>
            <p class={`text-xs truncate mt-0.5 ${r.unread ? "text-sky-600 font-bold" : "text-slate-500"}`}>
              {r.last_direction === "out" && <i class="fa-solid fa-reply text-[10px] ml-1 text-slate-400"></i>}
              {r.last_body || "—"}
            </p>
          </div>
          <div class="text-left shrink-0">
            <div class="text-[10px] text-slate-400 dt">{r.last_message_at ? formatJalali(r.last_message_at) : ""}</div>
            {r.unread > 0 && <span class="inline-block mt-1 min-w-5 px-1.5 rounded-full bg-sky-500 text-white text-[10px] text-center">{fa(r.unread)}</span>}
          </div>
        </a>
      ))}
    </div>
  );
}

export interface ThreadData {
  conversation: Conversation;
  customer: Customer;
  tags: Tag[];
  messages: (Message & { sender_name: string | null })[];
  quickReplies: { id: number; title: string; body: string }[];
  members: Member[];
  orders: CrmOrder[];
  notes: { body: string; created_at: string; user_name: string | null }[];
  connected: boolean;
  error?: string;
}

export function InboxPage(props: Ctx & { rows: InboxRow[]; filter: { status: string; mine: boolean; q: string }; thread?: ThreadData }) {
  const f = props.filter;
  const qs = (o: Partial<typeof f>) => {
    const p = new URLSearchParams();
    const v = { ...f, ...o };
    if (v.status) p.set("status", v.status);
    if (v.mine) p.set("mine", "1");
    if (v.q) p.set("q", v.q);
    const str = p.toString();
    return str ? `?${str}` : "";
  };
  const t = props.thread;
  return (
    <PanelShell title="صندوق پیام‌ها" user={props.user} shop={props.shop} on="inbox" unread={props.unread} full>
      <div class={t ? "hidden lg:block" : ""}>
        <PageHead title="صندوق پیام‌ها" sub="دایرکت‌های اینستاگرام فروشگاه، پاسخ سریع و ثبت سفارش از گفتگو" />
      </div>
      <div class={`grid gap-4 ${t ? "lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_300px]" : "lg:grid-cols-[360px_minmax(0,1fr)]"}`}>
        <section class={`card !p-0 overflow-hidden self-start ${t ? "hidden lg:block" : ""}`}>
          <div class="p-4 border-b border-sky-50">
            <form method="get">
              <input name="q" value={f.q} placeholder="جستجوی نام، آیدی یا تلفن" />
              {f.status && <input type="hidden" name="status" value={f.status} />}
            </form>
            <div class="flex gap-1.5 overflow-x-auto no-scrollbar mt-3">
              <Chip href={`/panel/inbox${qs({ status: "" })}`} on={!f.status}>همه</Chip>
              {Object.entries(CONVERSATION_STATUS).map(([k, l]) => <Chip href={`/panel/inbox${qs({ status: k })}`} on={f.status === k}>{l}</Chip>)}
              <Chip href={`/panel/inbox${qs({ mine: !f.mine })}`} on={f.mine}>مال من</Chip>
            </div>
          </div>
          <ConversationList rows={props.rows} active={t?.conversation.id} query={qs({})} />
        </section>
        {t ? (
          <Thread {...t} back={`/panel/inbox${qs({})}`} />
        ) : (
          <div class="hidden lg:flex card flex-col items-center justify-center text-center min-h-[420px]">
            <span class="w-20 h-20 rounded-3xl border border-sky-100 bg-sky-50 text-sky-400 flex items-center justify-center text-3xl mb-4"><i class="fa-solid fa-comments"></i></span>
            <b class="text-sky-900">یک گفتگو را انتخاب کنید</b>
            <p class="muted small">برای پاسخ، دیدن پرونده مشتری و ثبت سفارش روی یک گفتگو بزنید.</p>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function Thread(props: ThreadData & { back: string }) {
  const c = props.customer;
  const v = props.conversation;
  const script = `(function(){var t=document.getElementById('reply');document.querySelectorAll('[data-qr]').forEach(function(b){b.addEventListener('click',function(){t.value=(t.value?t.value+'\\n':'')+b.getAttribute('data-qr');t.focus();});});
    var box=document.getElementById('msgs');if(box)box.scrollTop=box.scrollHeight;})();`;
  return (
    <>
      <section class="card !p-0 overflow-hidden flex flex-col min-w-0 !mb-0 self-start lg:row-span-2 2xl:row-span-1">
        <div class="p-4 border-b border-sky-50 flex items-center gap-3">
          <a href={props.back} class="lg:hidden w-9 h-9 flex items-center justify-center rounded-full bg-sky-50 !text-sky-600" aria-label="بازگشت"><i class="fa-solid fa-chevron-right"></i></a>
          <Initial name={displayName(c)} size="w-11 h-11" />
          <div class="flex-1 min-w-0">
            <a href={`/panel/customers/${c.id}`} class="text-sm font-black !text-sky-900">{displayName(c)}</a>
            <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
              {c.username && <span class="ltr">@{c.username}</span>}
              <StageBadge stage={c.stage} />
            </div>
          </div>
          <form method="post" action={`/panel/inbox/${v.id}/status`} class="flex p-1 rounded-xl bg-sky-50 border border-sky-100">
            {(["open", "pending", "closed"] as const).map((st) => (
              <button name="status" value={st} class={`!px-3 !py-1.5 !text-[11px] !rounded-lg !shadow-none ${v.status === st ? "" : "!bg-transparent !text-slate-500"}`}>{CONVERSATION_STATUS[st]}</button>
            ))}
          </form>
          <a class="btn small hidden sm:inline-flex !bg-emerald-50 !text-emerald-700 !border-emerald-100 !shadow-none" href={`/panel/sales/new?customer=${c.id}`}><i class="fa-solid fa-cart-plus"></i> ثبت سفارش</a>
        </div>
        <div id="msgs" class="p-4 space-y-3 overflow-y-auto bg-gradient-to-b from-white to-sky-50/40" style="max-height:60vh;min-height:300px">
          {props.messages.length === 0 && <p class="muted small text-center">پیامی نیست.</p>}
          {props.messages.map((m) => (
            <div class={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
              <div
                class={`max-w-[78%] px-4 py-2.5 text-sm shadow-sm ${
                  m.direction === "out" ? "bg-sky-500 text-white rounded-2xl rounded-bl-md shadow-sky-500/20" : "bg-white border border-sky-100 text-sky-900 rounded-2xl rounded-br-md"
                }`}
              >
                {m.type !== "text" && <div class="text-[10px] opacity-70 mb-1">{m.type === "story_reply" ? "پاسخ به استوری" : m.type === "comment" ? "کامنت زیر پست" : m.type}</div>}
                <div class="whitespace-pre-wrap break-words leading-7">{m.body}</div>
                <div class={`text-[9px] mt-1 ${m.direction === "out" ? "text-sky-100" : "text-slate-400"}`}>
                  <span class="dt">{formatJalali(m.created_at)}</span>
                  {m.direction === "out" && <> · {m.sender_name ?? "خودکار / اینستاگرام"}</>}
                  {m.status === "failed" && <> · <b class="text-red-100">ارسال نشد: {m.error}</b></>}
                </div>
              </div>
            </div>
          ))}
        </div>
        <form method="post" action={`/panel/inbox/${v.id}/send`} class="p-4 border-t border-sky-50">
          <Errors errors={[props.error]} />
          {!props.connected && <div class="warnbox small">اینستاگرام فروشگاه وصل نیست؛ پیام فقط در تاریخچه ثبت می‌شود. اتصال در <a href="/panel/settings#instagram">تنظیمات</a>.</div>}
          {props.quickReplies.length > 0 && (
            <div class="flex gap-2 overflow-x-auto no-scrollbar mb-3" aria-label="پاسخ‌های آماده">
              {props.quickReplies.map((q) => (
                <button type="button" data-qr={q.body} class="!rounded-full !px-4 !py-1.5 !text-[11px] whitespace-nowrap !bg-white !text-sky-600 !border-sky-100 !shadow-none">{q.title}</button>
              ))}
            </div>
          )}
          <div class="flex items-end gap-2 p-2 rounded-2xl bg-sky-50/60 border border-sky-100">
            <textarea id="reply" name="body" required maxlength={1000} placeholder="پیام خود را بنویسید…" class="!border-0 !bg-transparent !shadow-none" style="min-height:48px"></textarea>
            <button class="!w-12 !h-12 !p-0 !rounded-xl shrink-0" aria-label="ارسال"><i class="fa-solid fa-paper-plane"></i><span class="sr-only">ارسال</span></button>
          </div>
        </form>
      </section>
      <CustomerSide {...props} />
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}

/** The customer next to the conversation: stats, contact, orders, notes, stage and owner. */
function CustomerSide(props: ThreadData) {
  const c = props.customer;
  const v = props.conversation;
  return (
    <aside class="card !mb-0 self-start lg:col-start-1 lg:row-start-2 2xl:col-start-3 2xl:row-start-1">
      <div class="text-center">
        <Initial name={displayName(c)} size="w-20 h-20 text-2xl mx-auto rounded-3xl" />
        <a href={`/panel/customers/${c.id}`} class="block mt-3 font-black !text-sky-900">{displayName(c)}</a>
        <p class="text-[11px] text-slate-500">مشتری از <span class="dt">{date(c.created_at, false)}</span></p>
        <div class="flex flex-wrap justify-center gap-1.5 mt-2"><StageBadge stage={c.stage} /><TagChips tags={props.tags} /></div>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-4">
        <div class="rounded-2xl border border-sky-100 p-3 text-center"><span class="text-[10px] text-slate-500 block">خرید کل</span><b class="text-sm">{toman(c.total_spent)}</b></div>
        <div class="rounded-2xl border border-sky-100 p-3 text-center"><span class="text-[10px] text-slate-500 block">تعداد سفارش</span><b class="text-sm">{fa(c.orders_count)} مورد</b></div>
      </div>
      {(c.phone || c.city || c.address) && (
        <div class="mt-4 pt-4 border-t border-sky-50 text-xs space-y-2">
          <b class="block text-sky-900">اطلاعات تماس</b>
          {c.phone && <a class="dt block" href={`tel:${c.phone}`}>{c.phone}</a>}
          {(c.city || c.address) && <p class="text-slate-500">{[c.city, c.address].filter(Boolean).join("، ")}</p>}
        </div>
      )}
      {props.orders.length > 0 && (
        <div class="mt-4 pt-4 border-t border-sky-50">
          <b class="block text-xs text-sky-900 mb-2">آخرین سفارش‌ها</b>
          {props.orders.map((o) => (
            <a href={`/panel/sales/${o.id}`} class="flex items-center justify-between gap-2 p-2.5 mb-1.5 rounded-xl border border-sky-100 text-xs !text-sky-900">
              <span>#{fa(o.number)} · {toman(o.total)}</span>
              <span class={`px-2 py-0.5 rounded-md text-[10px] font-bold ${ORDER_STYLE[o.status]}`}>{CRM_ORDER_STATUS[o.status]}</span>
            </a>
          ))}
        </div>
      )}
      {props.notes.length > 0 && (
        <div class="mt-4 pt-4 border-t border-sky-50">
          <b class="block text-xs text-sky-900 mb-2">یادداشت‌های داخلی</b>
          {props.notes.map((n) => (
            <p class="p-3 mb-1.5 rounded-xl bg-amber-50 border border-amber-100 text-[11px] text-amber-900 whitespace-pre-wrap">{n.body}</p>
          ))}
        </div>
      )}
      <div class="mt-4 pt-4 border-t border-sky-50 space-y-3">
        <form method="post" action={`/panel/customers/${c.id}/stage`}>
          <input type="hidden" name="back" value={`/panel/inbox/${v.id}`} />
          <label class="!mt-0">مرحله مشتری</label>
          <div class="flex gap-2">
            <select name="stage" class="flex-1">{STAGES.map((st) => <option value={st} selected={c.stage === st}>{STAGE_LABEL[st]}</option>)}</select>
            <button class="small">ذخیره</button>
          </div>
        </form>
        <form method="post" action={`/panel/inbox/${v.id}/assign`}>
          <label class="!mt-0">مسئول گفتگو</label>
          <div class="flex gap-2">
            <select name="user_id" class="flex-1">
              <option value="">بدون مسئول</option>
              {props.members.map((m) => <option value={String(m.id)} selected={v.assigned_to === m.id}>{m.name}</option>)}
            </select>
            <button class="small">ذخیره</button>
          </div>
        </form>
        <details>
          <summary class="cursor-pointer text-xs font-bold text-sky-600">+ وظیفه برای این گفتگو</summary>
          <TaskForm customerId={c.id} conversationId={v.id} members={props.members} back={`/panel/inbox/${v.id}`} />
        </details>
      </div>
      <a href={`/panel/sales/new?customer=${c.id}`} class="btn w-full mt-4 !bg-sky-900 !py-3.5 !rounded-2xl"><i class="fa-solid fa-cart-plus"></i> ثبت سفارش جدید</a>
    </aside>
  );
}

const ORDER_STYLE: Record<CrmOrder["status"], string> = {
  new: "bg-amber-50 text-amber-700",
  confirmed: "bg-sky-50 text-sky-700",
  shipped: "bg-emerald-50 text-emerald-700",
  delivered: "bg-emerald-50 text-emerald-700",
  canceled: "bg-red-50 text-red-600",
};

// ---------- customers ----------

export interface CustomerStats {
  total: number;
  loyal: number;
  oneTime: number;
  noPurchase: number;
  inactive: number;
}

export function CustomersPage(
  props: Ctx & { rows: CustomerRow[]; tags: Tag[]; stats: CustomerStats; filter: { q: string; stage: string; tag: number }; page: number; hasNext: boolean },
) {
  const f = props.filter;
  const qs = (o: Partial<typeof f & { page: number }>) => {
    const v = { ...f, page: 1, ...o };
    const p = new URLSearchParams();
    if (v.q) p.set("q", v.q);
    if (v.stage) p.set("stage", v.stage);
    if (v.tag) p.set("tag", String(v.tag));
    if (v.page > 1) p.set("page", String(v.page));
    const str = p.toString();
    return str ? `?${str}` : "";
  };
  const st = props.stats;
  const kpi = (icon: string, tone: string, label: string, value: number, note: string) => (
    <div class="card !mb-0">
      <span class={`w-11 h-11 rounded-2xl flex items-center justify-center mb-3 ${tone}`}><i class={`fa-solid ${icon}`}></i></span>
      <span class="text-[11px] text-slate-500 block">{label}</span>
      <b class="text-2xl font-black text-sky-900">{fa(value)} <span class="text-sm">نفر</span></b>
      <span class="text-[10px] text-slate-400 block">{note}</span>
    </div>
  );
  const last = (c: CustomerRow) => c.last_message_at ?? c.last_order_at ?? c.updated_at;
  return (
    <PanelShell title="مشتریان" user={props.user} shop={props.shop} on="customers" unread={props.unread}>
      <PageHead title="پایگاه داده مشتریان" sub={`${fa(st.total)} مشتری از دایرکت، سایت و ثبت دستی`}>
        <a class="btn small secondary" href={`/panel/customers.csv${qs({})}`}><i class="fa-solid fa-file-arrow-down"></i> خروجی اکسل</a>
        <a class="btn small" href="/panel/customers/new"><i class="fa-solid fa-user-plus"></i> مشتری جدید</a>
      </PageHead>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {kpi("fa-crown", "bg-amber-50 text-amber-500", "مشتریان وفادار", st.loyal, "دو خرید یا بیشتر")}
        {kpi("fa-bag-shopping", "bg-sky-50 text-sky-500", "تک‌خرید", st.oneTime, "یک خرید")}
        {kpi("fa-user-clock", "bg-rose-50 text-rose-500", "غیرفعال (۳ ماه+)", st.inactive, "خریدار بدون خرید در ۹۰ روز")}
        {kpi("fa-seedling", "bg-emerald-50 text-emerald-500", "بدون خرید", st.noPurchase, "سرنخ‌ها و علاقه‌مندها")}
      </div>
      <div class="card !p-0 overflow-hidden">
        <div class="p-4 flex flex-wrap items-center gap-3 border-b border-sky-50">
          <form method="get" class="flex-1 min-w-[220px]">
            <input name="q" value={f.q} placeholder="نام، آیدی، شماره تماس یا شهر…" />
            {f.stage && <input type="hidden" name="stage" value={f.stage} />}
            {f.tag > 0 && <input type="hidden" name="tag" value={String(f.tag)} />}
          </form>
          <div class="flex gap-1.5 overflow-x-auto no-scrollbar">
            <Chip href={`/panel/customers${qs({ stage: "" })}`} on={!f.stage}>همه</Chip>
            {STAGES.map((x) => <Chip href={`/panel/customers${qs({ stage: x })}`} on={f.stage === x}>{STAGE_LABEL[x]}</Chip>)}
          </div>
          {props.tags.length > 0 && (
            <div class="flex gap-1.5 overflow-x-auto no-scrollbar w-full">
              {props.tags.map((t) => (
                <a
                  href={`/panel/customers${qs({ tag: f.tag === t.id ? 0 : t.id })}`}
                  class={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap border ${f.tag === t.id ? "!text-white" : "!text-slate-600"}`}
                  style={f.tag === t.id ? `background:${t.color};border-color:${t.color}` : `border-color:${t.color}`}
                >
                  {t.name}
                </a>
              ))}
            </div>
          )}
        </div>
        {props.rows.length === 0 ? (
          <p class="muted small text-center py-10">مشتری‌ای پیدا نشد. هر کس در اینستاگرام پیام بدهد یا از سایت بخرد، اینجا اضافه می‌شود.</p>
        ) : (
          <>
            <table class="hidden md:table w-full text-sm">
              <thead class="bg-sky-50/60 text-[11px] text-slate-500">
                <tr>
                  <th class="text-right font-bold p-4">مشتری</th>
                  <th class="text-right font-bold p-4">آیدی اینستاگرام</th>
                  <th class="text-center font-bold p-4">سفارش</th>
                  <th class="text-right font-bold p-4">مجموع خرید</th>
                  <th class="text-right font-bold p-4">آخرین تعامل</th>
                  <th class="p-4"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-sky-50">
                {props.rows.map((c) => (
                  <tr class="hover:bg-sky-50/40">
                    <td class="p-4">
                      <a href={`/panel/customers/${c.id}`} class="flex items-center gap-3 !text-sky-900">
                        <Initial name={displayName(c)} />
                        <span class="min-w-0">
                          <b class="block truncate">{displayName(c)}</b>
                          <span class="flex flex-wrap gap-1 mt-0.5"><StageBadge stage={c.stage} /><TagChips tags={parseTags(c.tags)} /></span>
                        </span>
                      </a>
                    </td>
                    <td class="p-4 text-slate-500 ltr text-right">{c.username ? `@${c.username}` : c.phone || "—"}</td>
                    <td class="p-4 text-center">
                      <span class={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${c.orders_count > 1 ? "bg-sky-50 text-sky-600" : c.orders_count ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400"}`}>
                        {fa(c.orders_count)} سفارش
                      </span>
                    </td>
                    <td class="p-4 font-bold">{c.total_spent ? toman(c.total_spent) : "—"}</td>
                    <td class="p-4 text-xs">
                      <span class="dt">{date(last(c))}</span>
                      {c.unread > 0 && <span class="block text-[10px] text-emerald-600 font-bold">{fa(c.unread)} پیام خوانده‌نشده</span>}
                    </td>
                    <td class="p-4">
                      <div class="flex gap-1.5 justify-end">
                        {c.conversation_id && <a href={`/panel/inbox/${c.conversation_id}`} title="گفتگو" aria-label="گفتگو" class="w-9 h-9 rounded-xl bg-sky-50 !text-sky-600 flex items-center justify-center"><i class="fa-solid fa-comment"></i></a>}
                        <a href={`/panel/sales/new?customer=${c.id}`} title="ثبت سفارش" aria-label="ثبت سفارش" class="w-9 h-9 rounded-xl bg-sky-50 !text-sky-600 flex items-center justify-center"><i class="fa-solid fa-cart-plus"></i></a>
                        <a href={`/panel/customers/${c.id}`} title="پرونده" aria-label="پرونده" class="w-9 h-9 rounded-xl bg-sky-50 !text-sky-600 flex items-center justify-center"><i class="fa-solid fa-id-card"></i></a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="md:hidden divide-y divide-sky-50">
              {props.rows.map((c) => (
                <a href={`/panel/customers/${c.id}`} class="flex items-center gap-3 p-4 !text-sky-900">
                  <Initial name={displayName(c)} />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-bold truncate">{displayName(c)}</span>
                      <StageBadge stage={c.stage} />
                    </div>
                    <div class="text-[11px] text-slate-500 truncate">{[c.username && `@${c.username}`, c.phone, c.city].filter(Boolean).join(" · ") || c.source}</div>
                  </div>
                  <div class="text-left shrink-0">
                    {c.orders_count > 0 && <div class="text-xs font-bold">{toman(c.total_spent)}</div>}
                    {c.unread > 0 && <span class="inline-block min-w-5 px-1.5 rounded-full bg-sky-500 text-white text-[10px] text-center">{fa(c.unread)}</span>}
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
        <div class="p-4 flex items-center justify-between border-t border-sky-50">
          <span class="text-[11px] text-slate-500">صفحه {fa(props.page)}</span>
          <div class="flex gap-2">
            {props.page > 1 && <a class="btn small secondary" href={`/panel/customers${qs({ page: props.page - 1 })}`}>قبلی</a>}
            {props.hasNext && <a class="btn small secondary" href={`/panel/customers${qs({ page: props.page + 1 })}`}>بعدی</a>}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

function BirthdaySelects(props: { value: string }) {
  const [y, m, d] = (props.value || "").split("-");
  const thisYear = currentJalaliYear();
  return (
    <div class="grid grid-cols-3 gap-2">
      <select name="birth_day" aria-label="روز">
        <option value="">روز</option>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option value={String(n)} selected={Number(d) === n}>{fa(n)}</option>)}
      </select>
      <select name="birth_month" aria-label="ماه">
        <option value="">ماه</option>
        {JALALI_MONTHS.map((name, i) => <option value={String(i + 1)} selected={Number(m) === i + 1}>{name}</option>)}
      </select>
      <select name="birth_year" aria-label="سال">
        <option value="">سال</option>
        {Array.from({ length: 96 }, (_, i) => thisYear - 5 - i).map((n) => <option value={String(n)} selected={Number(y) === n}>{n.toLocaleString("fa-IR", { useGrouping: false })}</option>)}
      </select>
    </div>
  );
}

function CustomerFields(props: { c: Partial<Customer> }) {
  const c = props.c;
  return (
    <>
      <div class="two">
        <div><label>نام</label><input name="name" value={c.name ?? ""} maxlength={80} /></div>
        <div><label>آیدی اینستاگرام</label><input name="username" value={c.username ?? ""} class="ltr" maxlength={60} placeholder="username" /></div>
        <div><label>تلفن</label><input name="phone" value={c.phone ?? ""} class="ltr" inputmode="tel" maxlength={20} /></div>
        <div><label>شهر</label><input name="city" value={c.city ?? ""} maxlength={40} /></div>
      </div>
      <label>آدرس</label>
      <textarea name="address" maxlength={400} style="min-height:60px">{c.address ?? ""}</textarea>
      <label>تاریخ تولد</label>
      <BirthdaySelects value={c.birthday ?? ""} />
      <label>منبع آشنایی</label>
      <input name="source" value={c.source ?? ""} maxlength={40} placeholder="instagram / site / معرفی دوستان / …" />
    </>
  );
}

export function NewCustomerPage(props: Ctx & { values: Partial<Customer>; error?: string }) {
  return (
    <PanelShell title="مشتری جدید" user={props.user} shop={props.shop} on="customers" unread={props.unread}>
      <p class="mb-3"><a href="/panel/customers" class="text-xs"><i class="fa-solid fa-chevron-right ml-1"></i>مشتریان</a></p>
      <h1>مشتری جدید</h1>
      <Errors errors={[props.error]} />
      <form method="post" action="/panel/customers/new" class="card">
        <CustomerFields c={props.values} />
        <p><button>ثبت مشتری</button></p>
      </form>
    </PanelShell>
  );
}

function TaskForm(props: { customerId: number | null; conversationId?: number; members: Member[]; back: string; customers?: { id: number; name: string }[] }) {
  return (
    <form method="post" action="/panel/tasks" class="card">
      <h2>وظیفه جدید</h2>
      <input type="hidden" name="back" value={props.back} />
      {props.customerId && <input type="hidden" name="customer_id" value={String(props.customerId)} />}
      {props.conversationId && <input type="hidden" name="conversation_id" value={String(props.conversationId)} />}
      <input name="title" required maxlength={200} placeholder="مثلاً: تماس برای هماهنگی ارسال" />
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2" style="margin-top:8px">
        <select name="type" aria-label="نوع">
          {Object.entries(TASK_TYPES).map(([k, l]) => <option value={k}>{l}</option>)}
        </select>
        <input type="datetime-local" name="due_at" aria-label="موعد" class="ltr" />
        <select name="assigned_to" aria-label="مسئول">
          <option value="">بدون مسئول</option>
          {props.members.map((m) => <option value={String(m.id)}>{m.name}</option>)}
        </select>
        {props.customers ? (
          <select name="customer_id" aria-label="مشتری">
            <option value="">بدون مشتری</option>
            {props.customers.map((c) => <option value={String(c.id)}>{c.name}</option>)}
          </select>
        ) : (
          <button class="small">افزودن</button>
        )}
      </div>
      {props.customers && <p style="margin-bottom:0"><button class="small">افزودن</button></p>}
    </form>
  );
}

function TaskList(props: { tasks: TaskRow[]; back: string; showCustomer?: boolean }) {
  const nowIso = new Date().toISOString();
  if (!props.tasks.length) return <p class="muted small">وظیفه‌ای نیست.</p>;
  return (
    <div class="divide-y divide-sky-50">
      {props.tasks.map((t) => {
        const overdue = !t.done_at && t.due_at && t.due_at < nowIso;
        return (
          <div class="flex items-center gap-3 py-2.5">
            <form method="post" action={`/panel/tasks/${t.id}/toggle`}>
              <input type="hidden" name="back" value={props.back} />
              <button class={`!w-7 !h-7 !p-0 !rounded-full ${t.done_at ? "" : "secondary"}`} aria-label={t.done_at ? "باز کردن دوباره" : "انجام شد"}>
                {t.done_at ? <i class="fa-solid fa-check"></i> : ""}
              </button>
            </form>
            <div class="flex-1 min-w-0">
              <div class={`text-sm ${t.done_at ? "line-through text-slate-400" : "font-bold"}`}>{t.title}</div>
              <div class="text-[11px] text-slate-500">
                {TASK_TYPES[t.type] ?? t.type}
                {t.due_at && <> · <span class={overdue ? "text-red-600 font-bold" : ""}>موعد <span class="dt">{formatJalali(t.due_at)}</span></span></>}
                {t.assignee && <> · {t.assignee}</>}
                {props.showCustomer && t.customer_name !== null && t.customer_id && <> · <a href={`/panel/customers/${t.customer_id}`}>{t.customer_name || "مشتری"}</a></>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TIMELINE_ICON: Record<TimelineEntry["kind"], string> = {
  message: "fa-comment",
  note: "fa-note-sticky",
  task: "fa-list-check",
  order: "fa-cash-register",
  gift: "fa-gift",
  activity: "fa-clock-rotate-left",
};

function timelineText(e: TimelineEntry) {
  switch (e.kind) {
    case "message":
      return [e.title === "in" ? "پیام مشتری" : `پاسخ${e.extra ? ` ${e.extra}` : ""}`, e.body];
    case "note":
      return [`یادداشت${e.title ? ` ${e.title}` : ""}`, e.body];
    case "task":
      return [`وظیفه (${TASK_TYPES[e.title as keyof typeof TASK_TYPES] ?? e.title})${e.extra === "done" ? " — انجام شد" : ""}`, e.body];
    case "order":
      return [`سفارش دایرکت #${e.extra} — ${CRM_ORDER_STATUS[e.title as keyof typeof CRM_ORDER_STATUS] ?? e.title}`, toman(Number(e.body))];
    case "gift":
      return [`خرید کادو از سایت — ${e.extra}`, toman(Number(e.body))];
    case "activity": {
      if (e.title === "stage") {
        try {
          const ch = JSON.parse(e.body) as { stage: [Stage, Stage] };
          return [`تغییر مرحله${e.extra ? ` توسط ${e.extra}` : ""}`, `${STAGE_LABEL[ch.stage[0]]} ← ${STAGE_LABEL[ch.stage[1]]}`];
        } catch {
          return ["تغییر مرحله", ""];
        }
      }
      return ["ثبت مشتری", e.body === "instagram" ? "از دایرکت اینستاگرام" : e.body];
    }
  }
}

export function CustomerPage(
  props: Ctx & {
    c: Customer;
    tags: Tag[];
    allTags: Tag[];
    tasks: TaskRow[];
    interests: { product_id: number; title: string; source: string }[];
    products: { id: number; title: string }[];
    orders: CrmOrder[];
    timeline: TimelineEntry[];
    members: Member[];
    conversationId: number | null;
    saved?: string;
    error?: string;
  },
) {
  const c = props.c;
  const back = `/panel/customers/${c.id}`;
  const has = new Set(props.tags.map((t) => t.id));
  return (
    <PanelShell title={displayName(c)} user={props.user} shop={props.shop} on="customers" unread={props.unread}>
      <p class="mb-3"><a href="/panel/customers" class="text-xs"><i class="fa-solid fa-chevron-right ml-1"></i>مشتریان</a></p>
      {props.saved && <div class="okbox">{props.saved}</div>}
      <Errors errors={[props.error]} />
      <div class="card flex items-center gap-4">
        <Initial name={displayName(c)} size="w-14 h-14 text-xl" />
        <div class="flex-1 min-w-0">
          <h1 class="!mb-1">{displayName(c)}</h1>
          <div class="text-xs text-slate-500 flex flex-wrap gap-2 items-center">
            {c.username && <a class="ltr" href={`https://instagram.com/${c.username}`} target="_blank" rel="noopener">@{c.username}</a>}
            {c.phone && <a class="dt" href={`tel:${c.phone}`}>{c.phone}</a>}
            {c.city && <span>{c.city}</span>}
            {c.birthday && <span>🎂 {birthdayLabel(c.birthday)}</span>}
            <TagChips tags={props.tags} />
          </div>
        </div>
        <div class="text-left">
          <div class="text-sm font-bold">{toman(c.total_spent)}</div>
          <div class="text-[11px] text-slate-500">{fa(c.orders_count)} سفارش{c.last_order_at ? ` · آخرین ${date(c.last_order_at, false)}` : ""}</div>
        </div>
      </div>

      <div class="card">
        <h2>مرحله</h2>
        <form method="post" action={`/panel/customers/${c.id}/stage`} class="flex flex-wrap gap-2">
          <input type="hidden" name="back" value={back} />
          {STAGES.map((st, i) => (
            <button name="stage" value={st} class={`small ${c.stage === st ? "" : "secondary"}`}>{fa(i + 1)}. {STAGE_LABEL[st]}</button>
          ))}
        </form>
        <div class="row" style="margin-top:10px">
          {props.conversationId && <a class="btn small secondary" href={`/panel/inbox/${props.conversationId}`}><i class="fa-solid fa-comments"></i> گفتگو</a>}
          <a class="btn small secondary" href={`/panel/sales/new?customer=${c.id}`}><i class="fa-solid fa-cart-plus"></i> ثبت سفارش</a>
        </div>
      </div>

      <div class="two">
        <div>
          <form method="post" action={`/panel/customers/${c.id}/notes`} class="card">
            <h2>یادداشت</h2>
            <textarea name="body" required maxlength={2000} placeholder="مثلاً: رنگ آبی را بیشتر دوست دارد" style="min-height:60px"></textarea>
            <p style="margin-bottom:0"><button class="small">افزودن یادداشت</button></p>
          </form>
          <div class="card">
            <h2>وظایف</h2>
            <TaskList tasks={props.tasks} back={back} />
          </div>
          <TaskForm customerId={c.id} members={props.members} back={back} />
          <div class="card">
            <h2>برچسب‌ها</h2>
            <form method="post" action={`/panel/customers/${c.id}/tags`}>
              <div class="flex flex-wrap gap-2">
                {props.allTags.map((t) => (
                  <label class="!m-0 !inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border" style={`border-color:${t.color};color:var(--fg)`}>
                    <input type="checkbox" name="tag" value={String(t.id)} checked={has.has(t.id)} /> {t.name}
                  </label>
                ))}
              </div>
              <div class="row" style="margin-top:8px">
                <input name="new_tag" maxlength={30} placeholder="برچسب تازه (اختیاری)" style="flex:1;min-width:140px" />
                <input type="color" name="new_color" value="#2563eb" aria-label="رنگ برچسب" style="width:44px;height:40px;padding:2px" />
                <button class="small">ذخیره</button>
              </div>
            </form>
          </div>
          <div class="card">
            <h2>علاقه به محصولات</h2>
            {props.interests.length === 0 && <p class="muted small">هنوز ثبت نشده.</p>}
            <div class="flex flex-wrap gap-2 mb-2">
              {props.interests.map((i) => (
                <a href={`/panel/products/${i.product_id}`} class="tag">{i.title}{i.source === "order" ? " (خرید)" : ""}</a>
              ))}
            </div>
            {props.products.length > 0 && (
              <form method="post" action={`/panel/customers/${c.id}/interests`} class="row">
                <select name="product_id" style="flex:1">
                  {props.products.map((p) => <option value={String(p.id)}>{p.title}</option>)}
                </select>
                <button class="small secondary">افزودن</button>
              </form>
            )}
          </div>
        </div>
        <div>
          <form method="post" action={`/panel/customers/${c.id}`} class="card">
            <h2>مشخصات</h2>
            <CustomerFields c={c} />
            <p style="margin-bottom:0"><button class="small">ذخیره مشخصات</button></p>
          </form>
          {props.orders.length > 0 && (
            <div class="card">
              <h2>سفارش‌های دایرکت</h2>
              {props.orders.map((o) => (
                <a href={`/panel/sales/${o.id}`} class="flex justify-between py-1.5 text-sm">
                  <span>#{fa(o.number)} · {CRM_ORDER_STATUS[o.status]}</span>
                  <b>{toman(o.total)}</b>
                </a>
              ))}
            </div>
          )}
          <div class="card">
            <h2>تاریخچه</h2>
            {props.timeline.length === 0 && <p class="muted small">هنوز چیزی ثبت نشده.</p>}
            <ol class="relative space-y-4 pr-5 border-r-2 border-slate-100">
              {props.timeline.map((e) => {
                const [title, body] = timelineText(e);
                return (
                  <li class="relative">
                    <span class="absolute -right-[29px] top-0 w-6 h-6 rounded-full bg-white border-2 border-sky-100 text-slate-500 flex items-center justify-center text-[10px]">
                      <i class={`fa-solid ${TIMELINE_ICON[e.kind]}`}></i>
                    </span>
                    <div class="text-[11px] text-slate-500">{title} · <span class="dt">{formatJalali(e.at)}</span></div>
                    {body && <div class="text-sm whitespace-pre-wrap break-words">{body}</div>}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

// ---------- leads pipeline ----------

const STAGE_DOT: Record<Stage, string> = { lead: "bg-sky-400", interested: "bg-amber-400", offer_sent: "bg-violet-400", purchased: "bg-emerald-400" };

export function LeadsPage(props: Ctx & { columns: Record<Stage, (Customer & { last_body: string })[]>; counts: Record<Stage, number> }) {
  return (
    <PanelShell title="سرنخ‌ها" user={props.user} shop={props.shop} on="leads" unread={props.unread} full>
      <PageHead title="قیف فروش (سرنخ‌ها)" sub="هر کس در دایرکت پیام بدهد سرنخ است؛ با اولین سفارش خودکار «خریدار» می‌شود.">
        <a class="btn small secondary" href="/panel/automation"><i class="fa-solid fa-robot"></i> اتوماسیون</a>
        <a class="btn small" href="/panel/customers/new"><i class="fa-solid fa-plus"></i> سرنخ جدید</a>
      </PageHead>
      <div class="flex gap-4 overflow-x-auto pb-3 snap-x">
        {STAGES.map((st, i) => (
          <section class="w-[270px] shrink-0 snap-start xl:w-auto xl:flex-1 xl:min-w-0">
            <div class="flex items-center gap-2 mb-3 px-1">
              <span class={`w-2.5 h-2.5 rounded-full ${STAGE_DOT[st]}`}></span>
              <h2 class="!mb-0 !text-sm font-black text-sky-900">{STAGE_LABEL[st]}</h2>
              <span class="px-2 rounded-md bg-sky-100 text-sky-600 text-[11px] font-bold">{fa(props.counts[st])}</span>
            </div>
            <div class="space-y-3 min-h-[120px]">
              {props.columns[st].length === 0 && <div class="rounded-[1.5rem] border-2 border-dashed border-sky-100 p-6 text-center text-[11px] text-slate-400">خالی</div>}
              {props.columns[st].map((c) => (
                <div class={`bg-white rounded-[1.5rem] border p-4 shadow-sm ${st === "purchased" ? "border-emerald-100" : "border-sky-100"}`}>
                  <a href={`/panel/customers/${c.id}`} class="flex items-center gap-2.5 !text-sky-900">
                    <Initial name={displayName(c)} size="w-9 h-9 text-sm" />
                    <span class="min-w-0">
                      <b class="text-sm block truncate">{displayName(c)}</b>
                      {c.username && <span class="text-[10px] text-slate-400 ltr block">@{c.username}</span>}
                    </span>
                  </a>
                  <p class="text-xs text-slate-600 mt-3 line-clamp-2">{c.last_body || c.phone || c.source || "—"}</p>
                  {c.total_spent > 0 && (
                    <div class="mt-3 flex justify-between items-center rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs">
                      <span class="font-bold">مجموع خرید:</span><b class="text-emerald-600">{toman(c.total_spent)}</b>
                    </div>
                  )}
                  <form method="post" action={`/panel/customers/${c.id}/stage`} class="flex items-center justify-between mt-3">
                    <input type="hidden" name="back" value="/panel/leads" />
                    <span class="text-[10px] text-slate-400 dt">{date(c.updated_at)}</span>
                    <span class="flex gap-1">
                      {i > 0 && <button name="stage" value={STAGES[i - 1]} class="small secondary !px-2.5" aria-label="مرحله قبل" title={STAGE_LABEL[STAGES[i - 1]]}><i class="fa-solid fa-arrow-right"></i></button>}
                      {i < STAGES.length - 1 && <button name="stage" value={STAGES[i + 1]} class="small !px-2.5" aria-label="مرحله بعد">{STAGE_LABEL[STAGES[i + 1]]} <i class="fa-solid fa-arrow-left"></i></button>}
                    </span>
                  </form>
                </div>
              ))}
              {props.counts[st] > props.columns[st].length && (
                <a href={`/panel/customers?stage=${st}`} class="block text-center text-xs py-1">همه {fa(props.counts[st])} نفر</a>
              )}
            </div>
          </section>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- tasks ----------

export function TasksPage(props: Ctx & { tasks: TaskRow[]; view: string; members: Member[]; customers: { id: number; name: string }[] }) {
  return (
    <PanelShell title="وظایف" user={props.user} shop={props.shop} on="tasks" unread={props.unread}>
      <h1>وظایف و پیگیری‌ها</h1>
      <div class="flex gap-2 mb-3">
        <Chip href="/panel/tasks" on={props.view === "open"}>باز</Chip>
        <Chip href="/panel/tasks?view=mine" on={props.view === "mine"}>مال من</Chip>
        <Chip href="/panel/tasks?view=done" on={props.view === "done"}>انجام‌شده</Chip>
      </div>
      <div class="card"><TaskList tasks={props.tasks} back={`/panel/tasks${props.view === "open" ? "" : `?view=${props.view}`}`} showCustomer /></div>
      <TaskForm customerId={null} members={props.members} back="/panel/tasks" customers={props.customers} />
    </PanelShell>
  );
}

// ---------- direct sales (manual orders) ----------

const PAY_STYLE: Record<string, string> = { unpaid: "bg-amber-50 text-amber-700", paid: "bg-emerald-50 text-emerald-700", refunded: "bg-slate-100 text-slate-600" };

export function SalesPage(
  props: Ctx & { orders: (CrmOrder & { customer_name: string; customer_username: string })[]; status: string; q: string; counts: Record<string, number> },
) {
  const all = Object.values(props.counts).reduce((a, b) => a + b, 0);
  const qs = (status: string) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (props.q) p.set("q", props.q);
    const str = p.toString();
    return `/panel/sales${str ? `?${str}` : ""}`;
  };
  const tab = (key: string, label: string, n: number, tone: string) => (
    <a
      href={qs(key)}
      class={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-sm font-bold whitespace-nowrap ${
        props.status === key ? "bg-white border-sky-500 !text-sky-600 ring-2 ring-sky-100" : "bg-white border-sky-100 !text-slate-500"
      }`}
    >
      {label}
      <span class={`px-2 py-0.5 rounded-lg text-[11px] ${tone}`}>{fa(n)}</span>
    </a>
  );
  const name = (o: (typeof props.orders)[number]) => o.customer_name || (o.customer_username ? `@${o.customer_username}` : "مشتری");
  return (
    <PanelShell title="فروش دایرکت" user={props.user} shop={props.shop} on="sales" unread={props.unread}>
      <PageHead title="مدیریت سفارش‌های دایرکت" sub="ثبت، تأیید، ارسال و رهگیری سفارش‌هایی که در دایرکت می‌گیرید">
        <a class="btn small secondary" href="/panel/orders"><i class="fa-solid fa-globe"></i> سفارش‌های سایت</a>
        <a class="btn small" href="/panel/sales/new"><i class="fa-solid fa-plus"></i> ثبت سفارش دستی</a>
      </PageHead>
      <div class="flex gap-2 overflow-x-auto no-scrollbar mb-4 pb-1">
        {tab("", "همه سفارش‌ها", all, "bg-sky-50 text-sky-600")}
        {tab("new", CRM_ORDER_STATUS.new, props.counts.new ?? 0, "bg-amber-50 text-amber-600")}
        {tab("confirmed", CRM_ORDER_STATUS.confirmed, props.counts.confirmed ?? 0, "bg-sky-50 text-sky-600")}
        {tab("shipped", CRM_ORDER_STATUS.shipped, props.counts.shipped ?? 0, "bg-emerald-50 text-emerald-600")}
        {tab("delivered", CRM_ORDER_STATUS.delivered, props.counts.delivered ?? 0, "bg-emerald-50 text-emerald-600")}
        {tab("canceled", CRM_ORDER_STATUS.canceled, props.counts.canceled ?? 0, "bg-red-50 text-red-600")}
      </div>
      <div class="card !p-0 overflow-hidden">
        <form method="get" class="p-4 border-b border-sky-50">
          <input name="q" value={props.q} placeholder="شماره سفارش، نام یا آیدی مشتری…" />
          {props.status && <input type="hidden" name="status" value={props.status} />}
        </form>
        {props.orders.length === 0 ? (
          <p class="muted small text-center py-10">سفارشی نیست. سفارش‌هایی که در دایرکت می‌گیرید را اینجا ثبت کنید.</p>
        ) : (
          <>
            <table class="hidden md:table w-full text-sm">
              <thead class="bg-sky-50/60 text-[11px] text-slate-500">
                <tr>
                  <th class="text-right font-bold p-4">شماره</th>
                  <th class="text-right font-bold p-4">مشتری</th>
                  <th class="text-right font-bold p-4">تاریخ ثبت</th>
                  <th class="text-right font-bold p-4">مبلغ نهایی</th>
                  <th class="text-right font-bold p-4">پرداخت</th>
                  <th class="text-right font-bold p-4">وضعیت</th>
                  <th class="p-4"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-sky-50">
                {props.orders.map((o) => (
                  <tr class="hover:bg-sky-50/40">
                    <td class="p-4"><a href={`/panel/sales/${o.id}`} class="font-black">#{fa(o.number)}</a></td>
                    <td class="p-4">
                      <a href={`/panel/customers/${o.customer_id}`} class="flex items-center gap-2 !text-sky-900">
                        <Initial name={name(o)} size="w-8 h-8 text-xs" />
                        <span><b class="block text-xs">{name(o)}</b>{o.customer_username && <span class="text-[10px] text-slate-400 ltr">@{o.customer_username}</span>}</span>
                      </a>
                    </td>
                    <td class="p-4 text-xs"><span class="dt">{date(o.created_at)}</span></td>
                    <td class="p-4 font-bold">{toman(o.total)}</td>
                    <td class="p-4"><span class={`text-[11px] font-bold px-2 py-0.5 rounded-md ${PAY_STYLE[o.payment_status]}`}>{PAYMENT_STATUS[o.payment_status]}</span></td>
                    <td class="p-4"><span class={`text-[11px] font-bold px-2 py-0.5 rounded-md ${ORDER_STYLE[o.status]}`}>{CRM_ORDER_STATUS[o.status]}</span></td>
                    <td class="p-4 text-left">
                      <a href={`/panel/sales/${o.id}`} title="جزئیات" aria-label="جزئیات" class="inline-flex w-9 h-9 rounded-xl bg-sky-50 !text-sky-600 items-center justify-center"><i class="fa-solid fa-eye"></i></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="md:hidden divide-y divide-sky-50">
              {props.orders.map((o) => (
                <a href={`/panel/sales/${o.id}`} class="flex items-center gap-3 p-4 !text-sky-900">
                  <div class="w-12 text-center text-xs font-black text-sky-600">#{fa(o.number)}</div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold truncate">{name(o)}</div>
                    <div class="text-[11px] text-slate-500"><span class="dt">{date(o.created_at)}</span></div>
                  </div>
                  <div class="text-left">
                    <div class="text-sm font-bold">{toman(o.total)}</div>
                    <span class={`text-[10px] px-1.5 py-0.5 rounded ${ORDER_STYLE[o.status]}`}>{CRM_ORDER_STATUS[o.status]}</span>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </PanelShell>
  );
}

export interface VariantOption {
  value: string; // productId|size|color
  label: string;
  price: number;
  stock: number | null; // null = not tracked
}

export function NewSalePage(props: Ctx & { customers: { id: number; name: string }[]; customerId: number | null; variants: VariantOption[]; error?: string }) {
  const rows = 4;
  const script = `(function(){var f=document.getElementById('sale');if(!f)return;
    function upd(){var t=0;f.querySelectorAll('[data-row]').forEach(function(r){var s=r.querySelector('select'),q=r.querySelector('input');var o=s.options[s.selectedIndex];if(o&&o.value)t+=Number(o.dataset.price)*Math.max(0,Number(q.value)||0);});
      t+=Number(f.shipping.value||0)-Number(f.discount.value||0);document.getElementById('sale-total').textContent=Math.max(0,t).toLocaleString('fa-IR')+' تومان';}
    f.addEventListener('input',upd);f.addEventListener('change',upd);upd();})();`;
  return (
    <PanelShell title="سفارش جدید" user={props.user} shop={props.shop} on="sales" unread={props.unread}>
      <p class="mb-3"><a href="/panel/sales" class="text-xs"><i class="fa-solid fa-chevron-right ml-1"></i>فروش دایرکت</a></p>
      <h1>ثبت سفارش دایرکت</h1>
      <Errors errors={[props.error]} />
      <form method="post" action="/panel/sales/new" id="sale" class="card">
        <label style="margin-top:0">مشتری</label>
        <select name="customer_id" required>
          <option value="">انتخاب مشتری…</option>
          {props.customers.map((c) => <option value={String(c.id)} selected={props.customerId === c.id}>{c.name}</option>)}
        </select>
        <p class="small muted">مشتری در لیست نیست؟ <a href="/panel/customers/new">مشتری جدید</a></p>
        <h2 style="margin-top:16px">اقلام</h2>
        {Array.from({ length: rows }, (_, n) => (
          <div class="row" data-row style="margin-bottom:6px">
            <select name={`item_${n}`} style="flex:3;min-width:200px" aria-label={`محصول ${n + 1}`}>
              <option value="">{n === 0 ? "انتخاب محصول…" : "—"}</option>
              {props.variants.map((v) => (
                <option value={v.value} data-price={String(v.price)} disabled={v.stock !== null && v.stock <= 0}>
                  {v.label} — {toman(v.price)}{v.stock !== null ? ` (${v.stock > 0 ? `${fa(v.stock)} موجود` : "ناموجود"})` : ""}
                </option>
              ))}
            </select>
            <input name={`qty_${n}`} type="number" min="1" max="99" value="1" style="flex:0 0 80px" aria-label="تعداد" />
          </div>
        ))}
        <div class="two">
          <div><label>تخفیف (تومان)</label><input name="discount" value="0" class="ltr" inputmode="numeric" /></div>
          <div><label>هزینه ارسال (تومان)</label><input name="shipping" value="0" class="ltr" inputmode="numeric" /></div>
          <div>
            <label>روش پرداخت</label>
            <select name="method">{Object.entries(PAYMENT_METHODS).map(([k, l]) => <option value={k}>{l}</option>)}</select>
          </div>
          <div>
            <label>&nbsp;</label>
            <label class="row" style="color:var(--fg);margin:0"><input type="checkbox" name="paid" value="1" /> مبلغ دریافت شده</label>
          </div>
        </div>
        <label>توضیح</label>
        <input name="note" maxlength={300} />
        <p class="row" style="margin-bottom:0">
          <span>جمع: <b id="sale-total">—</b></span>
          <span class="sp" />
          <button>ثبت سفارش</button>
        </p>
      </form>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </PanelShell>
  );
}

export function SalePage(props: Ctx & { o: CrmOrder; items: CrmOrderItem[]; customer: Customer; saved?: string }) {
  const o = props.o;
  const subtotal = props.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const closed = o.status === "canceled";
  return (
    <PanelShell title={`سفارش #${o.number}`} user={props.user} shop={props.shop} on="sales" unread={props.unread}>
      <p class="mb-3"><a href="/panel/sales" class="text-xs"><i class="fa-solid fa-chevron-right ml-1"></i>فروش دایرکت</a></p>
      {props.saved && <div class="okbox">{props.saved}</div>}
      <div class="card">
        <div class="row">
          <h1 class="!mb-0">سفارش #{fa(o.number)}</h1>
          <span class="tag">{CRM_ORDER_STATUS[o.status]}</span>
          <span class={`text-[11px] px-2 py-0.5 rounded ${PAY_STYLE[o.payment_status]}`}>{PAYMENT_STATUS[o.payment_status]}</span>
        </div>
        <p class="small muted">
          <a href={`/panel/customers/${props.customer.id}`}>{displayName(props.customer)}</a> · <span class="dt">{date(o.created_at)}</span> ·{" "}
          {PAYMENT_METHODS[o.payment_method as keyof typeof PAYMENT_METHODS] ?? o.payment_method}
        </p>
        <div class="wrap">
          <table>
            <thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
            <tbody>
              {props.items.map((i) => (
                <tr>
                  <td><a href={`/panel/products/${i.product_id}`}>{i.title}</a>{variantLabel(i.size, i.color) && <div class="small muted">{variantLabel(i.size, i.color)}</div>}</td>
                  <td>{fa(i.qty)}</td>
                  <td>{toman(i.unit_price)}</td>
                  <td>{toman(i.qty * i.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="text-sm space-y-1 mt-3">
          <div class="flex justify-between"><span class="muted">جمع اقلام</span><span>{toman(subtotal)}</span></div>
          {o.discount > 0 && <div class="flex justify-between"><span class="muted">تخفیف</span><span>− {toman(o.discount)}</span></div>}
          {o.shipping_cost > 0 && <div class="flex justify-between"><span class="muted">ارسال</span><span>{toman(o.shipping_cost)}</span></div>}
          <div class="flex justify-between font-bold"><span>مبلغ کل</span><span>{toman(o.total)}</span></div>
        </div>
        {o.note && <p class="small">توضیح: {o.note}</p>}
      </div>
      {!closed && (
        <form method="post" action={`/panel/sales/${o.id}`} class="card">
          <h2>به‌روزرسانی</h2>
          <div class="two">
            <div>
              <label style="margin-top:0">وضعیت</label>
              <select name="status">{Object.entries(CRM_ORDER_STATUS).filter(([k]) => k !== "canceled").map(([k, l]) => <option value={k} selected={o.status === k}>{l}</option>)}</select>
            </div>
            <div>
              <label style="margin-top:0">پرداخت</label>
              <select name="payment_status">{Object.entries(PAYMENT_STATUS).map(([k, l]) => <option value={k} selected={o.payment_status === k}>{l}</option>)}</select>
            </div>
          </div>
          <label>کد رهگیری مرسوله</label>
          <input name="tracking_number" value={o.tracking_number} class="ltr" maxlength={60} />
          <p class="row" style="margin-bottom:0">
            <button class="small">ذخیره</button>
            <span class="sp" />
            {(o.status === "new" || o.status === "confirmed") && (
              <button class="small danger" formaction={`/panel/sales/${o.id}/cancel`} onclick="return confirm('سفارش لغو شود؟ موجودی برمی‌گردد.')">لغو سفارش</button>
            )}
          </p>
        </form>
      )}
    </PanelShell>
  );
}

// ---------- automation, quick replies, tags ----------

function RuleRow(props: { r: Rule & { tag_name: string | null }; soft?: boolean }) {
  const r = props.r;
  return (
    <div class={`flex items-start gap-3 ${props.soft ? "p-4 mb-2.5 rounded-2xl bg-sky-50/70 border border-sky-100" : "py-3 border-b border-sky-50"}`}>
      <div class="flex-1 min-w-0 text-sm">
        <b class="text-sky-900">{r.kind === "keyword" ? <>کلمه: «{r.keyword}»</> : RULE_LABEL[r.kind]}</b>
        {r.kind === "offer_followup" && <div class="text-[11px] text-slate-500">{fa(r.hours)} ساعت بعد از «پیشنهاد ارسال‌شده» یک وظیفه پیگیری ساخته می‌شود.</div>}
        {r.reply && <div class="text-[11px] text-slate-500 whitespace-pre-wrap">{r.kind === "offer_followup" ? "عنوان وظیفه: " : "اقدام: پاسخ «"}{r.reply}{r.kind === "offer_followup" ? "" : "»"}</div>}
        {(r.set_stage || r.tag_name) && (
          <div class="text-[11px] text-slate-500">
            {r.set_stage && <>مرحله ← {STAGE_LABEL[r.set_stage as Stage]} </>}
            {r.tag_name && <>برچسب ← {r.tag_name}</>}
          </div>
        )}
      </div>
      <form method="post" action={`/panel/automation/rules/${r.id}`} class="flex items-center gap-2 shrink-0">
        <button
          name="do"
          value="toggle"
          role="switch"
          aria-checked={r.active ? "true" : "false"}
          aria-label={r.active ? "فعال (غیرفعال کردن)" : "غیرفعال (فعال کردن)"}
          class={`!w-11 !h-6 !p-0.5 !rounded-full !shadow-none !justify-start ${r.active ? "" : "!bg-slate-200"}`}
        >
          <span class={`block w-5 h-5 rounded-full bg-white shadow transition ${r.active ? "" : "-translate-x-5"}`}></span>
        </button>
        <button name="do" value="delete" class="!w-8 !h-8 !p-0 !bg-transparent !text-slate-400 !shadow-none" aria-label="حذف" onclick="return confirm('حذف شود؟')"><i class="fa-solid fa-trash"></i></button>
      </form>
    </div>
  );
}

export function AutomationPage(props: Ctx & { rules: (Rule & { tag_name: string | null })[]; replies: { id: number; title: string; body: string }[]; tags: Tag[]; saved?: string; error?: string }) {
  const connected = !!(props.shop.ig_account_id && props.shop.ig_access_token);
  const general = props.rules.filter((r) => r.kind !== "keyword");
  const keywords = props.rules.filter((r) => r.kind === "keyword");
  return (
    <PanelShell title="اتوماسیون" user={props.user} shop={props.shop} on="automation" unread={props.unread}>
      <PageHead title="اتوماسیون و پاسخ‌های آماده" sub="پاسخ خودکار دایرکت، کلمات کلیدی، پیگیری پیشنهادها و برچسب‌ها" />
      {props.saved && <div class="okbox">{props.saved}</div>}
      <Errors errors={[props.error]} />
      <div class="rounded-[2rem] p-6 mb-4 text-white bg-gradient-to-l from-sky-500 to-sky-400 shadow-xl shadow-sky-500/20 flex items-center gap-4">
        <span class="w-14 h-14 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center text-2xl shrink-0"><i class="fa-brands fa-instagram"></i></span>
        <div class="flex-1">
          <b class="text-lg block">دستیار دایرکت اینستاگرام</b>
          <span class="text-xs text-sky-50">
            {connected ? "حساب اینستاگرام وصل است؛ قانون‌های فعال روی پیام‌های تازه اجرا می‌شوند." : "حساب اینستاگرام وصل نیست؛ قانون‌ها بعد از اتصال اجرا می‌شوند."}
          </span>
        </div>
        {!connected && <a href="/panel/settings#instagram" class="btn small !bg-white !text-sky-600">اتصال</a>}
      </div>
      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <div class="card !mb-0">
          <h2>کلمات کلیدی و محرک‌ها</h2>
          {keywords.length === 0 && <p class="muted small">هنوز کلمه کلیدی‌ای تعریف نشده.</p>}
          {keywords.map((r) => <RuleRow r={r} soft />)}
        </div>
        <div class="card !mb-0">
          <h2>قوانین پاسخ‌دهی خودکار</h2>
          {general.length === 0 && <p class="muted small">پیام خوش‌آمد یا پیگیری پیشنهاد هنوز تعریف نشده.</p>}
          {general.map((r) => <RuleRow r={r} />)}
        </div>
      </div>
      <div class="card">
        <form method="post" action="/panel/automation/rules">
          <h2>قانون جدید</h2>
          <select name="kind">
            {Object.entries(RULE_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}
          </select>
          <label>کلمه‌های کلیدی (برای «پاسخ به کلمه کلیدی»؛ با ویرگول جدا کنید)</label>
          <input name="keyword" maxlength={200} placeholder="قیمت، موجودی، ارسال" />
          <label>متن پاسخ خودکار (برای پیگیری پیشنهاد: عنوان وظیفه)</label>
          <textarea name="reply" maxlength={1000} style="min-height:60px"></textarea>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label>تغییر مرحله به</label>
              <select name="set_stage"><option value="">بدون تغییر</option>{STAGES.map((st) => <option value={st}>{STAGE_LABEL[st]}</option>)}</select>
            </div>
            <div>
              <label>افزودن برچسب</label>
              <select name="tag_id"><option value="">—</option>{props.tags.map((t) => <option value={String(t.id)}>{t.name}</option>)}</select>
            </div>
            <div>
              <label>بعد از (ساعت)</label>
              <input name="hours" type="number" min="1" max="720" value="24" />
            </div>
          </div>
          <p style="margin-bottom:0"><button class="small">افزودن قانون</button></p>
        </form>
      </div>

      <div class="card">
        <h2>پاسخ‌های آماده</h2>
        <p class="muted small" style="margin-top:0">در صفحه گفتگو بالای کادر پیام می‌آیند و با یک لمس داخل متن قرار می‌گیرند.</p>
        {props.replies.map((q) => (
          <form method="post" action={`/panel/automation/replies/${q.id}`} class="border-b border-slate-100 py-2">
            <div class="row">
              <input name="title" value={q.title} maxlength={60} style="flex:1;min-width:140px" aria-label="عنوان" />
              <button name="do" value="save" class="small">ذخیره</button>
              <button name="do" value="delete" class="small secondary" aria-label="حذف"><i class="fa-solid fa-trash"></i></button>
            </div>
            <textarea name="body" maxlength={1000} style="min-height:50px;margin-top:6px" aria-label="متن">{q.body}</textarea>
          </form>
        ))}
        <form method="post" action="/panel/automation/replies" style="margin-top:10px">
          <input name="title" required maxlength={60} placeholder="عنوان (مثلاً: شماره کارت)" />
          <textarea name="body" required maxlength={1000} placeholder="متن پاسخ" style="min-height:50px;margin-top:6px"></textarea>
          <p style="margin-bottom:0"><button class="small">افزودن پاسخ آماده</button></p>
        </form>
      </div>

      <div class="card">
        <h2>برچسب‌ها</h2>
        <div class="flex flex-wrap gap-2 mb-3">
          {props.tags.map((t) => (
            <form method="post" action={`/panel/automation/tags/${t.id}/delete`} class="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full text-white" style={`background:${t.color}`}>
              {t.name}
              <button class="!p-0 !bg-transparent !border-0 text-white" aria-label={`حذف ${t.name}`} onclick="return confirm('برچسب حذف شود؟')"><i class="fa-solid fa-xmark"></i></button>
            </form>
          ))}
        </div>
        <form method="post" action="/panel/automation/tags" class="row">
          <input name="name" required maxlength={30} placeholder="برچسب تازه" style="flex:1;min-width:140px" />
          <input type="color" name="color" value="#2563eb" aria-label="رنگ" style="width:44px;height:40px;padding:2px" />
          <button class="small">افزودن</button>
        </form>
      </div>
    </PanelShell>
  );
}

// ---------- team & activity ----------

export function TeamPage(
  props: Ctx & {
    members: Member[];
    activity: { action: string; entity_type: string; entity_id: number | null; changes: string; created_at: string; user_name: string | null }[];
    error?: string;
    saved?: string;
  },
) {
  return (
    <PanelShell title="تیم" user={props.user} shop={props.shop} on="team" unread={props.unread}>
      <h1>تیم فروشگاه</h1>
      {props.saved && <div class="okbox">{props.saved}</div>}
      <Errors errors={[props.error]} />
      <div class="card">
        {props.members.map((m) => (
          <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <Initial name={m.name} size="w-9 h-9" />
            <div style="flex:1">
              <b class="text-sm">{m.name}</b>
              <div class="small muted dt">{m.phone}</div>
            </div>
            <span class="tag">{m.shop_role === "admin" ? "مدیر" : "پشتیبان"}</span>
            {m.shop_role !== "admin" && (
              <form method="post" action={`/panel/team/${m.id}/remove`}>
                <button class="small secondary" onclick="return confirm('از تیم حذف شود؟')">حذف</button>
              </form>
            )}
          </div>
        ))}
        <form method="post" action="/panel/team" style="margin-top:12px">
          <label style="margin-top:0">افزودن پشتیبان با شماره موبایل (باید در سایت حساب داشته باشد)</label>
          <div class="row">
            <input name="phone" class="ltr" inputmode="tel" required placeholder="09xxxxxxxxx" style="flex:1;min-width:160px" />
            <button class="small">افزودن</button>
          </div>
          <p class="small muted" style="margin-bottom:0">پشتیبان‌ها به گفتگوها، مشتریان، وظایف و فروش دسترسی دارند؛ تنظیمات، تیم و اتوماسیون فقط برای مدیر است.</p>
        </form>
      </div>
      <div class="card">
        <h2>آخرین فعالیت‌ها</h2>
        {props.activity.length === 0 && <p class="muted small">فعالیتی ثبت نشده.</p>}
        {props.activity.map((a) => (
          <div class="text-xs py-1.5 border-b border-slate-100">
            <span class="dt muted">{formatJalali(a.created_at)}</span> · <b>{a.user_name ?? "سیستم"}</b> · {a.action} {a.entity_type}
            {a.entity_id ? ` #${a.entity_id}` : ""}
            {a.changes && <span class="muted"> — {a.changes.slice(0, 120)}</span>}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

/** Instagram connection on the shop settings page (admins only). */
export function InstagramSettings(props: { shop: Shop; webhookUrl: string; platformReady: boolean; ok?: string; error?: string }) {
  const s = props.shop;
  return (
    <form method="post" action="/panel/settings/instagram" class="card" id="instagram">
      <h2><i class="fa-brands fa-instagram ml-1"></i> اتصال اینستاگرام (دایرکت و کامنت)</h2>
      {props.ok && <div class="okbox">{props.ok}</div>}
      <Errors errors={[props.error]} />
      <p class="muted small" style="margin-top:0">
        پیام‌های دایرکت صفحه اینستاگرام فروشگاه در «گفتگوها» می‌آیند و از همان‌جا جواب داده می‌شوند؛ کامنت‌های ریلزهایی که به محصول وصل کنید هم
        خودکار جواب می‌گیرند. توکن دسترسی را از پنل توسعه‌دهندگان متا (Instagram API ← Generate access tokens) کپی کنید؛ شناسه حساب خودکار پیدا
        می‌شود و توکن هر هفته خودکار تمدید می‌شود.
        {!props.platformReady && <b> مدیر سایت هنوز اپ متا را در تنظیمات سایت وصل نکرده است.</b>}
      </p>
      {s.ig_access_token && (
        <p class="small">
          <span class="tag ok">وصل</span> {s.ig_username ? <b class="ltr">@{s.ig_username}</b> : null} · شناسه <span class="dt">{s.ig_account_id}</span>
          {s.ig_token_refreshed_at && <> · تمدید توکن: <span class="dt">{date(s.ig_token_refreshed_at, false)}</span></>}
        </p>
      )}
      <label>{s.ig_access_token ? "توکن جدید (خالی = بدون تغییر)" : "توکن دسترسی (Access token)"}</label>
      <input name="ig_access_token" class="ltr" autocomplete="off" maxlength={2000} placeholder="IGAA…" />
      <details class="mt-2">
        <summary class="cursor-pointer text-xs muted">شناسه حساب دستی (معمولاً لازم نیست)</summary>
        <input name="ig_account_id" value={s.ig_account_id} class="ltr" inputmode="numeric" maxlength={30} aria-label="شناسه حساب اینستاگرام" />
      </details>
      <p class="row" style="margin-bottom:0">
        <button class="small">ذخیره و بررسی</button>
        {s.ig_access_token && <a class="btn small secondary" href="/panel/reels"><i class="fa-solid fa-film"></i> ریلز و کامنت‌ها</a>}
        {s.ig_access_token && <button class="small secondary" name="disconnect" value="1" onclick="return confirm('اتصال قطع شود؟')">قطع اتصال</button>}
      </p>
    </form>
  );
}

// ---------- reels & posts → products (comment automation) ----------

export interface ReelItem {
  mediaId: string;
  permalink: string;
  caption: string;
  thumb: string;
  kind: string; // REELS / FEED / ...
  at: string | null;
  link: MediaLink | null;
  comments: number;
  dms: number;
}

export function ReelsPage(
  props: Ctx & {
    connected: boolean;
    items: ReelItem[];
    products: { id: number; title: string }[];
    recent: { username: string; body: string; action: string; error: string; created_at: string; caption: string; customer_id: number | null }[];
    apiError?: string;
    saved?: string;
  },
) {
  const ACTION: Record<string, [string, string]> = {
    dm: ["دایرکت فرستاده شد", "bg-emerald-50 text-emerald-700"],
    repeat: ["قبلاً فرستاده شده", "bg-slate-100 text-slate-500"],
    error: ["خطا", "bg-red-50 text-red-600"],
    none: ["بدون اقدام", "bg-slate-50 text-slate-400"],
  };
  return (
    <PanelShell title="ریلز و کامنت" user={props.user} shop={props.shop} on="reels" unread={props.unread}>
      <PageHead title="ریلز و پست‌ها ← محصول" sub="هر کس زیر پست بنویسد «چنده؟»، زیر کامنتش جواب می‌گیرد و قیمت و لینک محصول به دایرکتش می‌رود." />
      {props.saved && <div class="okbox">{props.saved}</div>}
      {!props.connected && (
        <div class="warnbox">
          اینستاگرام فروشگاه وصل نیست. اول در <a href="/panel/settings#instagram">تنظیمات</a> توکن را وارد کنید.
        </div>
      )}
      {props.apiError && (
        <div class="errbox">
          دریافت پست‌ها از اینستاگرام ممکن نشد: {props.apiError}
          {/oauth|access token|session|expired/i.test(props.apiError) && (
            <div class="mt-1">
              توکن ذخیره‌شده فروشگاه معتبر نیست (مربوط به تنظیمات مدیر سایت نیست). در <a href="/panel/settings#instagram">تنظیمات ← اتصال اینستاگرام</a> توکن تازه‌ای
              که با IG شروع می‌شود وارد کنید.
            </div>
          )}
        </div>
      )}
      <div class="rounded-[1.5rem] p-4 mb-4 bg-white border border-sky-100 text-xs leading-7 text-slate-600">
        <b class="text-sky-900">چطور کار می‌کند؟</b> برای هر پست یک محصول انتخاب کنید و ذخیره کنید. وقتی کامنتی با یکی از کلمه‌های کلیدی بیاید (یا هر کامنتی
        اگر کلمه‌ای ننوشته باشید): ۱) پاسخ عمومی زیر کامنت گذاشته می‌شود، ۲) متن دایرکت با قیمت و لینک خرید برای همان شخص فرستاده می‌شود (هر نفر
        یک بار برای هر پست)، ۳) شخص به «مشتریان» با مرحله «علاقه‌مند» اضافه می‌شود. در متن‌ها می‌توانید از
        <span class="ltr"> {"{name} {title} {price} {link}"} </span> استفاده کنید.
      </div>
      {props.items.length === 0 && props.connected && !props.apiError && <Empty icon="fa-film">پستی پیدا نشد.</Empty>}
      <div class="grid md:grid-cols-2 gap-4">
        {props.items.map((m) => {
          const l = m.link;
          return (
            <form method="post" action={`/panel/reels/${m.mediaId}`} class="card !mb-0">
              <input type="hidden" name="permalink" value={m.permalink} />
              <input type="hidden" name="caption" value={m.caption.slice(0, 300)} />
              <input type="hidden" name="thumb" value={m.thumb} />
              <div class="flex gap-3">
                <a href={m.permalink || "#"} target="_blank" rel="noopener" class="w-20 h-28 rounded-2xl overflow-hidden bg-sky-50 shrink-0 flex items-center justify-center text-sky-300">
                  {m.thumb ? <img src={m.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover" /> : <i class="fa-solid fa-film text-2xl"></i>}
                </a>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[10px] px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 font-bold">{m.kind === "REELS" ? "ریلز" : "پست"}</span>
                    {l?.active ? (
                      <span class="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold">فعال</span>
                    ) : l ? (
                      <span class="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-bold">خاموش</span>
                    ) : null}
                    {m.at && <span class="text-[10px] text-slate-400 dt">{date(m.at, false)}</span>}
                  </div>
                  <p class="text-xs text-slate-600 mt-1 line-clamp-3 whitespace-pre-wrap">{m.caption || "بدون کپشن"}</p>
                  {(m.comments > 0 || m.dms > 0) && (
                    <p class="text-[11px] text-slate-500 mt-1"><i class="fa-solid fa-comment ml-1"></i>{fa(m.comments)} کامنت · <i class="fa-solid fa-paper-plane ml-1"></i>{fa(m.dms)} دایرکت</p>
                  )}
                </div>
              </div>
              <label>محصول این پست</label>
              <select name="product_id">
                <option value="">— بدون محصول (لینک فروشگاه) —</option>
                {props.products.map((p) => <option value={String(p.id)} selected={l?.product_id === p.id}>{p.title}</option>)}
              </select>
              <details open={!!l}>
                <summary class="cursor-pointer text-xs font-bold text-sky-600 mt-3">متن‌ها و کلمه‌های کلیدی</summary>
                <label>کلمه‌های کلیدی (خالی = هر کامنتی)</label>
                <input name="keywords" value={l ? l.keywords : DEFAULT_KEYWORDS} maxlength={300} />
                <label>پاسخ عمومی زیر کامنت (خالی = بدون پاسخ عمومی)</label>
                <input name="comment_reply" value={l ? l.comment_reply : DEFAULT_COMMENT_REPLY} maxlength={300} />
                <label>متن دایرکت</label>
                <textarea name="dm_text" maxlength={1000} style="min-height:90px">{l ? l.dm_text : DEFAULT_DM}</textarea>
              </details>
              <div class="row" style="margin-top:12px">
                <label class="row !m-0" style="color:var(--fg)"><input type="checkbox" name="active" value="1" checked={l ? !!l.active : true} /> فعال</label>
                <span class="sp" />
                {l && <button class="small secondary" formaction={`/panel/reels/${m.mediaId}/delete`}>حذف اتصال</button>}
                <button class="small">{l ? "ذخیره" : "وصل کردن"}</button>
              </div>
            </form>
          );
        })}
      </div>
      {props.recent.length > 0 && (
        <div class="card mt-4">
          <h2>آخرین کامنت‌ها</h2>
          <div class="divide-y divide-sky-50">
            {props.recent.map((r) => (
              <div class="py-2.5 flex items-start gap-3 text-sm">
                <div class="flex-1 min-w-0">
                  {r.customer_id ? <a href={`/panel/customers/${r.customer_id}`} class="font-bold ltr">@{r.username || "?"}</a> : <b class="ltr">@{r.username || "?"}</b>}
                  <span class="text-slate-600"> : {r.body}</span>
                  <div class="text-[10px] text-slate-400"><span class="dt">{date(r.created_at)}</span>{r.caption ? ` · ${r.caption.slice(0, 40)}` : ""}{r.error ? ` · ${r.error}` : ""}</div>
                </div>
                <span class={`text-[10px] px-2 py-0.5 rounded-md font-bold whitespace-nowrap ${(ACTION[r.action] ?? ACTION.none)[1]}`}>{(ACTION[r.action] ?? ACTION.none)[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PanelShell>
  );
}
