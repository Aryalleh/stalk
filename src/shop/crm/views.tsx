import type { Child } from "hono/jsx";
import { formatJalali } from "../../../lib/jalali";
import { JALALI_MONTHS, birthdayLabel, currentJalaliYear } from "../../../lib/people";
import type { User } from "../../session";
import { toman, type Shop } from "../db";
import { variantLabel } from "../variants";
import { Errors } from "../views/layout";
import { PANEL_SECTIONS, PanelShell, isShopAdmin } from "../views/panel";
import { RULE_LABEL, type Rule } from "./automation";
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
  offer_sent: "bg-blue-50 text-blue-700",
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
    <div class={`${props.size ?? "w-10 h-10"} rounded-full bg-blue-50 text-blue-600 font-bold flex items-center justify-center shrink-0`}>
      {(props.name.replace(/^@/, "").trim()[0] ?? "؟").toUpperCase()}
    </div>
  );
}

function Chip(props: { href: string; on: boolean; children: Child }) {
  return (
    <a
      href={props.href}
      class={`px-3 py-1.5 text-[11px] font-bold rounded-lg border whitespace-nowrap ${props.on ? "bg-blue-50 !text-blue-600 border-blue-100" : "bg-white !text-slate-500 border-slate-200"}`}
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
          <a href={href} class="card !mb-0 flex items-center gap-3 !text-slate-900">
            <span class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><i class={`fa-solid ${icon}`}></i></span>
            <span class="text-sm font-bold">{label}</span>
          </a>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- inbox ----------

function ConversationList(props: { rows: InboxRow[]; active?: number; query: string }) {
  if (!props.rows.length) return <Empty icon="fa-comments">گفتگویی نیست. پیام‌های دایرکت اینستاگرام اینجا می‌آیند.</Empty>;
  return (
    <div class="card !p-0 overflow-hidden divide-y divide-slate-100">
      {props.rows.map((r) => (
        <a href={`/panel/inbox/${r.id}${props.query}`} class={`flex items-center gap-3 p-3 !text-slate-900 hover:bg-slate-50 ${props.active === r.id ? "bg-blue-50/60" : ""}`}>
          <Initial name={displayName(r)} />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class={`text-sm truncate ${r.unread ? "font-black" : "font-bold"}`}>{displayName(r)}</span>
              <StageBadge stage={r.stage} />
            </div>
            <p class={`text-xs truncate ${r.unread ? "text-slate-900" : "text-slate-500"}`}>
              {r.last_direction === "out" && <i class="fa-solid fa-reply text-[10px] ml-1 text-slate-400"></i>}
              {r.last_body || "—"}
            </p>
          </div>
          <div class="text-left shrink-0">
            <div class="text-[10px] text-slate-400 dt">{r.last_message_at ? formatJalali(r.last_message_at) : ""}</div>
            {r.unread > 0 && <span class="inline-block mt-1 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-[10px] text-center">{fa(r.unread)}</span>}
          </div>
        </a>
      ))}
    </div>
  );
}

export function InboxPage(
  props: Ctx & {
    rows: InboxRow[];
    filter: { status: string; mine: boolean; q: string };
    thread?: {
      conversation: Conversation;
      customer: Customer;
      tags: Tag[];
      messages: (Message & { sender_name: string | null })[];
      quickReplies: { id: number; title: string; body: string }[];
      members: Member[];
      connected: boolean;
      error?: string;
    };
  },
) {
  const f = props.filter;
  const qs = (o: Partial<typeof f>) => {
    const p = new URLSearchParams();
    const v = { ...f, ...o };
    if (v.status) p.set("status", v.status);
    if (v.mine) p.set("mine", "1");
    if (v.q) p.set("q", v.q);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const t = props.thread;
  const list = (
    <div class={t ? "hidden md:block" : ""}>
      <form method="get" class="mb-3">
        <input name="q" value={f.q} placeholder="جستجوی نام، آیدی یا تلفن" />
        {f.status && <input type="hidden" name="status" value={f.status} />}
      </form>
      <div class="flex gap-2 overflow-x-auto no-scrollbar mb-3">
        <Chip href={`/panel/inbox${qs({ status: "" })}`} on={!f.status}>همه</Chip>
        {Object.entries(CONVERSATION_STATUS).map(([k, l]) => <Chip href={`/panel/inbox${qs({ status: k })}`} on={f.status === k}>{l}</Chip>)}
        <Chip href={`/panel/inbox${qs({ mine: !f.mine })}`} on={f.mine}>مال من</Chip>
      </div>
      <ConversationList rows={props.rows} active={t?.conversation.id} query={qs({})} />
    </div>
  );
  return (
    <PanelShell title="گفتگوها" user={props.user} shop={props.shop} on="inbox" unread={props.unread} wide>
      {!t && <h1>گفتگوها</h1>}
      <div class={t ? "grid md:grid-cols-[320px_1fr] gap-4" : ""}>
        {list}
        {t && <Thread {...t} back={`/panel/inbox${qs({})}`} />}
      </div>
    </PanelShell>
  );
}

function Thread(props: NonNullable<Parameters<typeof InboxPage>[0]["thread"]> & { back: string }) {
  const c = props.customer;
  const v = props.conversation;
  const script = `(function(){var s=document.getElementById('qr'),t=document.getElementById('reply');if(s)s.addEventListener('change',function(){if(s.value){t.value=(t.value?t.value+'\\n':'')+s.value;s.value='';t.focus();}});
    var box=document.getElementById('msgs');if(box)box.scrollTop=box.scrollHeight;})();`;
  return (
    <section class="min-w-0">
      <div class="card !p-3 flex items-center gap-3">
        <a href={props.back} class="md:hidden w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 !text-slate-500" aria-label="بازگشت"><i class="fa-solid fa-chevron-right"></i></a>
        <Initial name={displayName(c)} />
        <div class="flex-1 min-w-0">
          <a href={`/panel/customers/${c.id}`} class="text-sm font-bold">{displayName(c)}</a>
          <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
            {c.username && <span class="ltr">@{c.username}</span>}
            <StageBadge stage={c.stage} />
            <TagChips tags={props.tags} />
          </div>
        </div>
        <form method="post" action={`/panel/inbox/${v.id}/status`} class="flex gap-1">
          {(["open", "pending", "closed"] as const).map((st) => (
            <button name="status" value={st} class={`small ${v.status === st ? "" : "secondary"}`}>{CONVERSATION_STATUS[st]}</button>
          ))}
        </form>
      </div>
      <div id="msgs" class="card !p-3 space-y-2 overflow-y-auto" style="max-height:55vh;min-height:240px">
        {props.messages.length === 0 && <p class="muted small text-center">پیامی نیست.</p>}
        {props.messages.map((m) => (
          <div class={`flex ${m.direction === "out" ? "justify-start" : "justify-end"}`}>
            <div class={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-blue-600 text-white rounded-bl-sm" : "bg-slate-100 text-slate-900 rounded-br-sm"}`}>
              {m.type !== "text" && <div class="text-[10px] opacity-70 mb-1">{m.type === "story_reply" ? "پاسخ به استوری" : m.type}</div>}
              <div class="whitespace-pre-wrap break-words">{m.body}</div>
              <div class={`text-[9px] mt-1 ${m.direction === "out" ? "text-blue-100" : "text-slate-400"}`}>
                <span class="dt">{formatJalali(m.created_at)}</span>
                {m.direction === "out" && <> · {m.sender_name ?? "خودکار / اینستاگرام"}</>}
                {m.status === "failed" && <> · <b class="text-red-200">ارسال نشد: {m.error}</b></>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Errors errors={[props.error]} />
      <form method="post" action={`/panel/inbox/${v.id}/send`} class="card !p-3">
        {!props.connected && <div class="warnbox small">اینستاگرام فروشگاه وصل نیست؛ پیام فقط در تاریخچه ثبت می‌شود. اتصال در <a href="/panel/settings#instagram">تنظیمات</a>.</div>}
        {props.quickReplies.length > 0 && (
          <select id="qr" aria-label="پاسخ آماده" class="mb-2">
            <option value="">پاسخ آماده…</option>
            {props.quickReplies.map((q) => <option value={q.body}>{q.title}</option>)}
          </select>
        )}
        <textarea id="reply" name="body" required maxlength={1000} placeholder="پیام…" style="min-height:70px"></textarea>
        <div class="row" style="margin-top:8px">
          <button><i class="fa-solid fa-paper-plane"></i> ارسال</button>
          <span class="sp" />
          <a class="btn small secondary" href={`/panel/sales/new?customer=${c.id}`}><i class="fa-solid fa-cart-plus"></i> ثبت سفارش</a>
        </div>
      </form>
      <div class="grid md:grid-cols-2 gap-3">
        <form method="post" action={`/panel/inbox/${v.id}/assign`} class="card !mb-0">
          <label style="margin-top:0">مسئول گفتگو</label>
          <div class="row">
            <select name="user_id" style="flex:1">
              <option value="">بدون مسئول</option>
              {props.members.map((m) => <option value={String(m.id)} selected={v.assigned_to === m.id}>{m.name}</option>)}
            </select>
            <button class="small">ذخیره</button>
          </div>
        </form>
        <form method="post" action={`/panel/customers/${c.id}/stage`} class="card !mb-0">
          <label style="margin-top:0">مرحله مشتری</label>
          <input type="hidden" name="back" value={`/panel/inbox/${v.id}`} />
          <div class="row">
            <select name="stage" style="flex:1">
              {STAGES.map((st) => <option value={st} selected={c.stage === st}>{STAGE_LABEL[st]}</option>)}
            </select>
            <button class="small">ذخیره</button>
          </div>
        </form>
      </div>
      <TaskForm customerId={c.id} conversationId={v.id} members={props.members} back={`/panel/inbox/${v.id}`} />
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </section>
  );
}

// ---------- customers ----------

export function CustomersPage(props: Ctx & { rows: CustomerRow[]; tags: Tag[]; filter: { q: string; stage: string; tag: number }; page: number; hasNext: boolean }) {
  const f = props.filter;
  const qs = (o: Partial<typeof f & { page: number }>) => {
    const v = { ...f, page: 1, ...o };
    const p = new URLSearchParams();
    if (v.q) p.set("q", v.q);
    if (v.stage) p.set("stage", v.stage);
    if (v.tag) p.set("tag", String(v.tag));
    if (v.page > 1) p.set("page", String(v.page));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  return (
    <PanelShell title="مشتریان" user={props.user} shop={props.shop} on="customers" unread={props.unread}>
      <div class="flex items-center justify-between mb-4">
        <h1 class="!mb-0">مشتریان</h1>
        <a class="btn small" href="/panel/customers/new"><i class="fa-solid fa-user-plus"></i> مشتری جدید</a>
      </div>
      <form method="get" class="mb-3">
        <input name="q" value={f.q} placeholder="جستجوی نام، آیدی، تلفن یا شهر" />
        {f.stage && <input type="hidden" name="stage" value={f.stage} />}
      </form>
      <div class="flex gap-2 overflow-x-auto no-scrollbar mb-2">
        <Chip href={`/panel/customers${qs({ stage: "" })}`} on={!f.stage}>همه</Chip>
        {STAGES.map((st) => <Chip href={`/panel/customers${qs({ stage: st })}`} on={f.stage === st}>{STAGE_LABEL[st]}</Chip>)}
      </div>
      {props.tags.length > 0 && (
        <div class="flex gap-2 overflow-x-auto no-scrollbar mb-4">
          {props.tags.map((t) => (
            <a href={`/panel/customers${qs({ tag: f.tag === t.id ? 0 : t.id })}`} class={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap border ${f.tag === t.id ? "!text-white" : "!text-slate-600"}`} style={f.tag === t.id ? `background:${t.color};border-color:${t.color}` : `border-color:${t.color}`}>
              {t.name}
            </a>
          ))}
        </div>
      )}
      {props.rows.length === 0 ? (
        <Empty icon="fa-users">مشتری‌ای پیدا نشد. هر کس در اینستاگرام پیام بدهد یا از سایت بخرد، اینجا اضافه می‌شود.</Empty>
      ) : (
        <div class="card !p-0 overflow-hidden divide-y divide-slate-100">
          {props.rows.map((c) => (
            <a href={`/panel/customers/${c.id}`} class="flex items-center gap-3 p-3 !text-slate-900 hover:bg-slate-50">
              <Initial name={displayName(c)} />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-bold truncate">{displayName(c)}</span>
                  <StageBadge stage={c.stage} />
                  <TagChips tags={parseTags(c.tags)} />
                </div>
                <div class="text-[11px] text-slate-500 truncate">
                  {[c.username && `@${c.username}`, c.phone, c.city].filter(Boolean).join(" · ") || c.source}
                </div>
              </div>
              <div class="text-left shrink-0">
                {c.orders_count > 0 && <div class="text-xs font-bold">{toman(c.total_spent)}</div>}
                <div class="text-[10px] text-slate-400">{c.orders_count ? `${fa(c.orders_count)} سفارش` : ""}</div>
                {c.unread > 0 && <span class="inline-block min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-[10px] text-center">{fa(c.unread)}</span>}
              </div>
            </a>
          ))}
        </div>
      )}
      <div class="row" style="justify-content:center;margin-top:12px">
        {props.page > 1 && <a class="btn small secondary" href={`/panel/customers${qs({ page: props.page - 1 })}`}>قبلی</a>}
        {props.hasNext && <a class="btn small secondary" href={`/panel/customers${qs({ page: props.page + 1 })}`}>بعدی</a>}
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
    <div class="divide-y divide-slate-100">
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
                    <span class="absolute -right-[29px] top-0 w-6 h-6 rounded-full bg-white border-2 border-slate-200 text-slate-500 flex items-center justify-center text-[10px]">
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

export function LeadsPage(props: Ctx & { columns: Record<Stage, (Customer & { last_body: string })[]>; counts: Record<Stage, number> }) {
  return (
    <PanelShell title="سرنخ‌ها" user={props.user} shop={props.shop} on="leads" unread={props.unread} wide>
      <h1>قیف فروش</h1>
      <p class="muted small" style="margin-top:-8px">هر کس در دایرکت پیام بدهد سرنخ است؛ با اولین سفارش خودکار «خریدار» می‌شود.</p>
      <div class="flex gap-3 overflow-x-auto pb-3 snap-x">
        {STAGES.map((st, i) => (
          <section class="w-72 shrink-0 snap-start">
            <div class="flex items-center justify-between mb-2 px-1">
              <h2 class="!mb-0">{STAGE_LABEL[st]}</h2>
              <span class="text-xs text-slate-500">{fa(props.counts[st])}</span>
            </div>
            <div class="space-y-2 bg-slate-100/70 rounded-2xl p-2 min-h-[120px]">
              {props.columns[st].map((c) => (
                <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
                  <a href={`/panel/customers/${c.id}`} class="text-sm font-bold block truncate">{displayName(c)}</a>
                  <p class="text-[11px] text-slate-500 truncate">{c.last_body || c.phone || c.source}</p>
                  {c.total_spent > 0 && <p class="text-[11px] font-bold">{toman(c.total_spent)}</p>}
                  <form method="post" action={`/panel/customers/${c.id}/stage`} class="flex justify-between mt-2">
                    <input type="hidden" name="back" value="/panel/leads" />
                    {i > 0 ? <button name="stage" value={STAGES[i - 1]} class="small secondary !px-2" aria-label="مرحله قبل"><i class="fa-solid fa-arrow-right"></i></button> : <span />}
                    {i < STAGES.length - 1 ? <button name="stage" value={STAGES[i + 1]} class="small !px-2" aria-label="مرحله بعد">{STAGE_LABEL[STAGES[i + 1]]} <i class="fa-solid fa-arrow-left"></i></button> : <span />}
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

export function SalesPage(props: Ctx & { orders: (CrmOrder & { customer_name: string; customer_username: string })[]; status: string }) {
  return (
    <PanelShell title="فروش دایرکت" user={props.user} shop={props.shop} on="sales" unread={props.unread}>
      <div class="flex items-center justify-between mb-4">
        <h1 class="!mb-0">فروش دایرکت</h1>
        <a class="btn small" href="/panel/sales/new"><i class="fa-solid fa-plus"></i> سفارش جدید</a>
      </div>
      <div class="flex gap-2 overflow-x-auto no-scrollbar mb-3">
        <Chip href="/panel/sales" on={!props.status}>همه</Chip>
        {Object.entries(CRM_ORDER_STATUS).map(([k, l]) => <Chip href={`/panel/sales?status=${k}`} on={props.status === k}>{l}</Chip>)}
      </div>
      {props.orders.length === 0 ? (
        <Empty icon="fa-cash-register">سفارشی نیست. سفارش‌هایی که در دایرکت می‌گیرید را اینجا ثبت کنید.</Empty>
      ) : (
        <div class="card !p-0 overflow-hidden divide-y divide-slate-100">
          {props.orders.map((o) => (
            <a href={`/panel/sales/${o.id}`} class="flex items-center gap-3 p-3 !text-slate-900 hover:bg-slate-50">
              <div class="w-12 text-center text-xs font-bold text-slate-500">#{fa(o.number)}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-bold truncate">{o.customer_name || (o.customer_username ? `@${o.customer_username}` : "مشتری")}</div>
                <div class="text-[11px] text-slate-500"><span class="dt">{date(o.created_at)}</span> · {CRM_ORDER_STATUS[o.status]}</div>
              </div>
              <div class="text-left">
                <div class="text-sm font-bold">{toman(o.total)}</div>
                <span class={`text-[10px] px-1.5 py-0.5 rounded ${PAY_STYLE[o.payment_status]}`}>{PAYMENT_STATUS[o.payment_status]}</span>
              </div>
            </a>
          ))}
        </div>
      )}
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

export function AutomationPage(props: Ctx & { rules: (Rule & { tag_name: string | null })[]; replies: { id: number; title: string; body: string }[]; tags: Tag[]; saved?: string; error?: string }) {
  return (
    <PanelShell title="اتوماسیون" user={props.user} shop={props.shop} on="automation" unread={props.unread}>
      <h1>اتوماسیون و پاسخ‌های آماده</h1>
      {props.saved && <div class="okbox">{props.saved}</div>}
      <Errors errors={[props.error]} />
      <div class="card">
        <h2>قانون‌ها</h2>
        {props.rules.length === 0 && <p class="muted small">هنوز قانونی نساخته‌اید.</p>}
        {props.rules.map((r) => (
          <div class="flex items-start gap-3 py-2 border-b border-slate-100">
            <div class="flex-1 min-w-0 text-sm">
              <b>{RULE_LABEL[r.kind]}</b>
              {r.kind === "keyword" && <> — وقتی پیام شامل «{r.keyword}» باشد</>}
              {r.kind === "offer_followup" && <> — {fa(r.hours)} ساعت بعد از «پیشنهاد داده شد»</>}
              {r.reply && <div class="small muted whitespace-pre-wrap">{r.kind === "offer_followup" ? "عنوان وظیفه: " : "پاسخ: "}{r.reply}</div>}
              {(r.set_stage || r.tag_name) && (
                <div class="small muted">
                  {r.set_stage && <>مرحله ← {STAGE_LABEL[r.set_stage as Stage]} </>}
                  {r.tag_name && <>برچسب ← {r.tag_name}</>}
                </div>
              )}
            </div>
            <form method="post" action={`/panel/automation/rules/${r.id}`} class="flex gap-1">
              <button name="do" value="toggle" class={`small ${r.active ? "" : "secondary"}`}>{r.active ? "فعال" : "غیرفعال"}</button>
              <button name="do" value="delete" class="small secondary" onclick="return confirm('حذف شود؟')"><i class="fa-solid fa-trash"></i></button>
            </form>
          </div>
        ))}
        <form method="post" action="/panel/automation/rules" style="margin-top:12px">
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
        <p class="muted small" style="margin-top:0">در صفحه گفتگو با یک انتخاب داخل متن پیام قرار می‌گیرند.</p>
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
export function InstagramSettings(props: { shop: Shop; webhookUrl: string; platformReady: boolean }) {
  const s = props.shop;
  return (
    <form method="post" action="/panel/settings/instagram" class="card" id="instagram">
      <h2>اتصال اینستاگرام (دایرکت)</h2>
      <p class="muted small" style="margin-top:0">
        پیام‌های دایرکت صفحه اینستاگرام فروشگاه در «گفتگوها» می‌آیند و از همان‌جا جواب داده می‌شوند. شناسه حساب و توکن دسترسی (long-lived) را
        از پنل توسعه‌دهندگان متا (Instagram API with Instagram Login) وارد کنید.
        {!props.platformReady && <b> مدیر سایت هنوز اپ متا را در تنظیمات سایت وصل نکرده است.</b>}
      </p>
      {s.ig_access_token && <p class="small"><span class="tag ok">وصل</span> حساب <span class="dt">{s.ig_account_id}</span></p>}
      <div class="two">
        <div><label>شناسه حساب اینستاگرام (IG User ID)</label><input name="ig_account_id" value={s.ig_account_id} class="ltr" inputmode="numeric" maxlength={30} /></div>
        <div><label>{s.ig_access_token ? "توکن جدید (خالی = بدون تغییر)" : "توکن دسترسی"}</label><input name="ig_access_token" class="ltr" autocomplete="off" maxlength={600} /></div>
      </div>
      <p class="row" style="margin-bottom:0">
        <button class="small">ذخیره</button>
        {s.ig_access_token && <button class="small secondary" name="disconnect" value="1" onclick="return confirm('اتصال قطع شود؟')">قطع اتصال</button>}
      </p>
    </form>
  );
}
