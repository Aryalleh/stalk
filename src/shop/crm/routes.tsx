import { Hono } from "hono";
import { birthDate } from "../../../lib/people";
import { normalizeDigits, normalizePhone } from "../../../lib/normalize";
import type { C, Env } from "../../env";
import { render } from "../../render";
import { now } from "../db";
import { safeNext, currentUser, form, intParam, pageParam } from "../routes/helpers";
import { isShopAdmin } from "../views/panel";
import { variantLabel, variants } from "../variants";
import { onStageChange, type Rule } from "./automation";
import {
  CONVERSATION_STATUS,
  CRM_ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  STAGES,
  STAGE_LABEL,
  addInterest,
  addOutgoing,
  cancelCrmOrder,
  conversationMessages,
  createCrmOrder,
  createTask,
  customerTags,
  diff,
  getCustomer,
  isStage,
  listConversations,
  listCustomers,
  listTasks,
  logActivity,
  orderItems,
  parseTags,
  refreshCustomerStats,
  shopTags,
  timeline,
  type Conversation,
  type CrmOrder,
  type Customer,
  type NewOrderItem,
  type Stage,
} from "./db";
import { fetchAccount, listMedia, sendDm, type IgMedia } from "./instagram";
import type { MediaLink } from "./comments";
import {
  AutomationPage,
  CustomerPage,
  CustomersPage,
  InboxPage,
  LeadsPage,
  MorePage,
  NewCustomerPage,
  NewSalePage,
  ReelsPage,
  SalePage,
  SalesPage,
  TasksPage,
  TeamPage,
  type Ctx,
  type CustomerStats,
  type Member,
  type ReelItem,
  type VariantOption,
} from "./views";

// Panel routes for the shop CRM: inbox, customers/leads, tasks, direct sales, automation, team.
// Mounted inside the panel router, so the shop is already in c.get("shop").

export const crmPanel = new Hono<Env>();

const CUSTOMERS_PAGE = 30;
const db = (c: C) => c.env.DB;
const shopOf = (c: C) => c.get("shop");

// Automation, team and the shop's settings are for the shop's admins only.
const adminOnly = async (c: C, next: () => Promise<void>) => (isShopAdmin(currentUser(c), shopOf(c)) ? next() : c.text("فقط مدیر فروشگاه دسترسی دارد", 403));
for (const p of ["/panel/reels", "/panel/reels/*", "/panel/automation", "/panel/automation/*", "/panel/team", "/panel/team/*", "/panel/settings", "/panel/settings/*"]) crmPanel.use(p, adminOnly);

async function ctx(c: C): Promise<Ctx> {
  const shop = shopOf(c);
  const r = await db(c).prepare("SELECT COALESCE(SUM(unread), 0) AS n FROM conversations WHERE shop_id = ? AND status <> 'closed'").bind(shop.id).first<{ n: number }>();
  return { user: currentUser(c), shop, unread: r?.n ?? 0 };
}

const members = async (c: C) =>
  (await db(c).prepare("SELECT id, name, phone, shop_role FROM users WHERE shop_id = ? ORDER BY shop_role = 'admin' DESC, name").bind(shopOf(c).id).all<Member>()).results;

const isMember = async (c: C, userId: number) => (await members(c)).some((m) => m.id === userId);

/** A datetime-local value (Iran time) → ISO; "" → null. */
function dueIso(v: string | undefined) {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+03:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const money = (v: string | undefined) => Math.max(0, Math.floor(Number(String(v ?? "0").replace(/[^\d]/g, "")) || 0));

// ---------- menu ----------

crmPanel.get("/panel/more", async (c) => render(c, <MorePage {...await ctx(c)} />));

// ---------- inbox ----------

const inboxFilter = (c: C) => ({
  status: (c.req.query("status") ?? "") in CONVERSATION_STATUS ? c.req.query("status")! : "",
  mine: c.req.query("mine") === "1",
  q: (c.req.query("q") ?? "").trim().slice(0, 60),
});

async function inboxRows(c: C, f: ReturnType<typeof inboxFilter>) {
  return listConversations(db(c), shopOf(c).id, { status: f.status || undefined, mine: f.mine ? currentUser(c).id : undefined, q: f.q || undefined, limit: 100 });
}

const getConversation = (c: C, id: number) =>
  db(c).prepare("SELECT * FROM conversations WHERE id = ? AND shop_id = ?").bind(id, shopOf(c).id).first<Conversation>();

crmPanel.get("/panel/inbox", async (c) => {
  const f = inboxFilter(c);
  return render(c, <InboxPage {...await ctx(c)} rows={await inboxRows(c, f)} filter={f} />);
});

async function threadView(c: C, id: number, error?: string) {
  const shop = shopOf(c);
  const conversation = await getConversation(c, id);
  if (!conversation) return c.notFound();
  if (conversation.unread) {
    await db(c).prepare("UPDATE conversations SET unread = 0 WHERE id = ?").bind(id).run();
    conversation.unread = 0;
  }
  const customer = (await getCustomer(db(c), shop.id, conversation.customer_id))!;
  const f = inboxFilter(c);
  const [rows, tags, messages, quickReplies, team, orders, notes] = await Promise.all([
    inboxRows(c, f),
    customerTags(db(c), customer.id),
    conversationMessages(db(c), id),
    db(c).prepare("SELECT id, title, body FROM quick_replies WHERE shop_id = ? ORDER BY title").bind(shop.id).all<{ id: number; title: string; body: string }>(),
    members(c),
    db(c).prepare("SELECT * FROM crm_orders WHERE customer_id = ? AND shop_id = ? ORDER BY created_at DESC LIMIT 3").bind(customer.id, shop.id).all<CrmOrder>(),
    db(c)
      .prepare("SELECT n.body, n.created_at, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.customer_id = ? ORDER BY n.created_at DESC LIMIT 3")
      .bind(customer.id)
      .all<{ body: string; created_at: string; user_name: string | null }>(),
  ]);
  return render(
    c,
    <InboxPage
      {...await ctx(c)}
      rows={rows}
      filter={f}
      thread={{
        conversation,
        customer,
        tags,
        messages,
        quickReplies: quickReplies.results,
        members: team,
        orders: orders.results,
        notes: notes.results,
        connected: !!(shop.ig_account_id && shop.ig_access_token && customer.ig_user_id),
        error,
      }}
    />,
    error ? 400 : 200,
  );
}

crmPanel.get("/panel/inbox/:id{[0-9]+}", (c) => threadView(c, intParam(c, "id")));

crmPanel.post("/panel/inbox/:id{[0-9]+}/send", async (c) => {
  const shop = shopOf(c);
  const user = currentUser(c);
  const conv = await getConversation(c, intParam(c, "id"));
  if (!conv) return c.notFound();
  const body = ((await form(c)).body ?? "").slice(0, 1000);
  if (!body) return threadView(c, conv.id, "متن پیام خالی است.");
  const customer = (await getCustomer(db(c), shop.id, conv.customer_id))!;
  // Whoever answers an unassigned conversation takes it.
  if (!conv.assigned_to) await db(c).prepare("UPDATE conversations SET assigned_to = ? WHERE id = ?").bind(user.id, conv.id).run();
  if (shop.ig_account_id && shop.ig_access_token && customer.ig_user_id) {
    try {
      const mid = await sendDm(shop.ig_access_token, shop.ig_account_id, customer.ig_user_id, body);
      await addOutgoing(db(c), shop.id, conv.id, { body, sentBy: user.id, igId: mid });
    } catch (e) {
      const error = String((e as Error).message).slice(0, 300);
      await addOutgoing(db(c), shop.id, conv.id, { body, sentBy: user.id, status: "failed", error });
      return threadView(c, conv.id, `ارسال در اینستاگرام ناموفق بود: ${error}`);
    }
  } else {
    // Not connected (or a customer added by hand): keep a record of what was said elsewhere.
    await addOutgoing(db(c), shop.id, conv.id, { body, sentBy: user.id });
  }
  return c.redirect(`/panel/inbox/${conv.id}`);
});

crmPanel.post("/panel/inbox/:id{[0-9]+}/status", async (c) => {
  const conv = await getConversation(c, intParam(c, "id"));
  if (!conv) return c.notFound();
  const status = (await form(c)).status ?? "";
  if (status in CONVERSATION_STATUS && status !== conv.status) {
    await db(c).prepare("UPDATE conversations SET status = ? WHERE id = ?").bind(status, conv.id).run();
    await logActivity(db(c), shopOf(c).id, currentUser(c).id, "update", "conversation", conv.id, { status: [conv.status, status] });
  }
  return c.redirect(`/panel/inbox/${conv.id}`);
});

crmPanel.post("/panel/inbox/:id{[0-9]+}/assign", async (c) => {
  const conv = await getConversation(c, intParam(c, "id"));
  if (!conv) return c.notFound();
  const raw = (await form(c)).user_id ?? "";
  const userId = raw ? Number(raw) : null;
  if (userId !== null && !(await isMember(c, userId))) return c.text("عضو تیم نیست", 400);
  if (userId !== conv.assigned_to) {
    await db(c).prepare("UPDATE conversations SET assigned_to = ? WHERE id = ?").bind(userId, conv.id).run();
    await logActivity(db(c), shopOf(c).id, currentUser(c).id, "assign", "conversation", conv.id, { assigned_to: [conv.assigned_to, userId] });
  }
  return c.redirect(`/panel/inbox/${conv.id}`);
});

// ---------- customers ----------

crmPanel.get("/panel/customers", async (c) => {
  const shop = shopOf(c);
  const page = pageParam(c);
  const f = { q: (c.req.query("q") ?? "").trim().slice(0, 60), stage: isStage(c.req.query("stage") ?? "") ? c.req.query("stage")! : "", tag: Number(c.req.query("tag")) || 0 };
  const rows = await listCustomers(db(c), shop.id, { q: f.q || undefined, stage: f.stage || undefined, tag: f.tag || undefined, limit: CUSTOMERS_PAGE + 1, offset: (page - 1) * CUSTOMERS_PAGE });
  const stats = await db(c)
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(orders_count >= 2), 0) AS loyal, COALESCE(SUM(orders_count = 1), 0) AS oneTime,
              COALESCE(SUM(orders_count = 0), 0) AS noPurchase, COALESCE(SUM(orders_count > 0 AND last_order_at < ?), 0) AS inactive
       FROM customers WHERE shop_id = ?`,
    )
    .bind(new Date(Date.now() - 90 * 86400_000).toISOString(), shop.id)
    .first<CustomerStats>();
  return render(
    c,
    <CustomersPage
      {...await ctx(c)}
      rows={rows.slice(0, CUSTOMERS_PAGE)}
      tags={await shopTags(db(c), shop.id)}
      stats={stats!}
      filter={f}
      page={page}
      hasNext={rows.length > CUSTOMERS_PAGE}
    />,
  );
});

/** The filtered customer list as CSV (opens in Excel; BOM for the Persian text). */
crmPanel.get("/panel/customers.csv", async (c) => {
  const shop = shopOf(c);
  const stage = isStage(c.req.query("stage") ?? "") ? c.req.query("stage") : undefined;
  const rows = await listCustomers(db(c), shop.id, { q: (c.req.query("q") ?? "").trim() || undefined, stage, tag: Number(c.req.query("tag")) || undefined, limit: 5000, offset: 0 });
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    const safe = /^[=+\-@]/.test(t) ? `'${t}` : t; // no formulas in spreadsheets
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["نام", "آیدی اینستاگرام", "تلفن", "شهر", "آدرس", "تولد", "منبع", "مرحله", "برچسب‌ها", "تعداد سفارش", "مجموع خرید", "آخرین سفارش", "ثبت"];
  const lines = rows.map((r) =>
    [r.name, r.username, r.phone, r.city, r.address, r.birthday, r.source, STAGE_LABEL[r.stage], parseTags(r.tags).map((t) => t.name).join("، "), r.orders_count, r.total_spent, r.last_order_at ?? "", r.created_at]
      .map(cell)
      .join(","),
  );
  await logActivity(db(c), shop.id, currentUser(c).id, "export", "customer", null, `${rows.length}`);
  return c.body("\ufeff" + [head.join(","), ...lines].join("\r\n"), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="customers-${shop.slug}.csv"`,
  });
});

/** The editable fields from a customer form, or an error. */
function customerFields(f: Record<string, string>): { values: Partial<Customer>; error?: string } {
  const phone = f.phone ? normalizePhone(f.phone) : "";
  const values: Partial<Customer> = {
    name: (f.name ?? "").slice(0, 80),
    username: (f.username ?? "").replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 60),
    phone,
    city: (f.city ?? "").slice(0, 40),
    address: (f.address ?? "").slice(0, 400),
    source: (f.source ?? "").slice(0, 40),
    birthday: "",
  };
  if (phone && !/^\+?\d{5,15}$/.test(phone)) return { values, error: "تلفن نامعتبر است." };
  if (f.birth_day || f.birth_month || f.birth_year) {
    const b = birthDate(f.birth_year ?? "", f.birth_month ?? "", f.birth_day ?? "");
    if (!b) return { values, error: "تاریخ تولد نامعتبر است." };
    values.birthday = b;
  }
  if (!values.name && !values.username && !values.phone) return { values, error: "حداقل نام، آیدی یا تلفن لازم است." };
  return { values };
}

crmPanel.get("/panel/customers/new", async (c) => render(c, <NewCustomerPage {...await ctx(c)} values={{ source: "manual" }} />));

crmPanel.post("/panel/customers/new", async (c) => {
  const shop = shopOf(c);
  const { values: v, error } = customerFields(await form(c));
  if (error) return render(c, <NewCustomerPage {...await ctx(c)} values={v} error={error} />, 400);
  if (v.phone) {
    const dup = await db(c).prepare("SELECT id FROM customers WHERE shop_id = ? AND phone = ?").bind(shop.id, v.phone).first<{ id: number }>();
    if (dup) return c.redirect(`/panel/customers/${dup.id}`);
  }
  const t = now();
  const row = await db(c)
    .prepare(
      `INSERT INTO customers (shop_id, username, name, phone, city, address, birthday, source, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, ?) RETURNING id`,
    )
    .bind(shop.id, v.username, v.name, v.phone, v.city, v.address, v.birthday, v.source || "manual", t, t)
    .first<{ id: number }>();
  await logActivity(db(c), shop.id, currentUser(c).id, "create", "customer", row!.id, v.source || "manual");
  if (v.phone) await refreshCustomerStats(db(c), shop.id, row!.id); // earlier site purchases from this phone
  return c.redirect(`/panel/customers/${row!.id}`);
});

async function customerView(c: C, id: number, extra: { saved?: string; error?: string } = {}) {
  const shop = shopOf(c);
  const customer = await getCustomer(db(c), shop.id, id);
  if (!customer) return c.notFound();
  const [tags, allTags, tasks, interests, products, orders, events, team, conv] = await Promise.all([
    customerTags(db(c), id),
    shopTags(db(c), shop.id),
    listTasks(db(c), shop.id, { customerId: id, limit: 50 }),
    db(c)
      .prepare("SELECT i.product_id, p.title, i.source FROM product_interests i JOIN products p ON p.id = i.product_id WHERE i.customer_id = ? ORDER BY i.created_at DESC")
      .bind(id)
      .all<{ product_id: number; title: string; source: string }>(),
    db(c).prepare("SELECT id, title FROM products WHERE shop_id = ? ORDER BY title LIMIT 300").bind(shop.id).all<{ id: number; title: string }>(),
    db(c).prepare("SELECT * FROM crm_orders WHERE customer_id = ? AND shop_id = ? ORDER BY created_at DESC LIMIT 20").bind(id, shop.id).all<CrmOrder>(),
    timeline(db(c), shop.id, customer),
    members(c),
    db(c).prepare("SELECT id FROM conversations WHERE customer_id = ?").bind(id).first<{ id: number }>(),
  ]);
  return render(
    c,
    <CustomerPage
      {...await ctx(c)}
      c={customer}
      tags={tags}
      allTags={allTags}
      tasks={tasks}
      interests={interests.results}
      products={products.results}
      orders={orders.results}
      timeline={events}
      members={team}
      conversationId={conv?.id ?? null}
      {...extra}
    />,
    extra.error ? 400 : 200,
  );
}

crmPanel.get("/panel/customers/:id{[0-9]+}", (c) => customerView(c, intParam(c, "id")));

crmPanel.post("/panel/customers/:id{[0-9]+}", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  const before = await getCustomer(db(c), shop.id, id);
  if (!before) return c.notFound();
  const { values: v, error } = customerFields(await form(c));
  if (error) return customerView(c, id, { error });
  const changes = diff(before as unknown as Record<string, unknown>, v as Record<string, unknown>);
  if (Object.keys(changes).length) {
    await db(c)
      .prepare("UPDATE customers SET name = ?, username = ?, phone = ?, city = ?, address = ?, birthday = ?, source = ?, updated_at = ? WHERE id = ? AND shop_id = ?")
      .bind(v.name, v.username, v.phone, v.city, v.address, v.birthday, v.source, now(), id, shop.id)
      .run();
    await logActivity(db(c), shop.id, currentUser(c).id, "update", "customer", id, changes);
    if (changes.phone) await refreshCustomerStats(db(c), shop.id, id);
  }
  return customerView(c, id, { saved: "ذخیره شد." });
});

crmPanel.post("/panel/customers/:id{[0-9]+}/stage", async (c) => {
  const id = intParam(c, "id");
  const f = await form(c);
  if (!(await getCustomer(db(c), shopOf(c).id, id))) return c.notFound();
  if (isStage(f.stage ?? "")) await onStageChange(db(c), shopOf(c).id, id, f.stage as Stage, currentUser(c).id);
  return c.redirect(safeNext(f.back || `/panel/customers/${id}`));
});

crmPanel.post("/panel/customers/:id{[0-9]+}/notes", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  if (!(await getCustomer(db(c), shop.id, id))) return c.notFound();
  const body = ((await form(c)).body ?? "").slice(0, 2000);
  if (body) {
    await db(c).prepare("INSERT INTO notes (shop_id, customer_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(shop.id, id, currentUser(c).id, body, now()).run();
    await db(c).prepare("UPDATE customers SET updated_at = ? WHERE id = ?").bind(now(), id).run();
  }
  return c.redirect(`/panel/customers/${id}`);
});

crmPanel.post("/panel/customers/:id{[0-9]+}/tags", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  if (!(await getCustomer(db(c), shop.id, id))) return c.notFound();
  const body = await c.req.parseBody({ all: true });
  const picked = new Set([body.tag].flat().map((v) => Number(v)).filter(Number.isInteger));
  const own = new Set((await shopTags(db(c), shop.id)).map((t) => t.id));
  const newTag = String(body.new_tag ?? "").trim().slice(0, 30);
  if (newTag) {
    const color = /^#[0-9a-f]{6}$/i.test(String(body.new_color ?? "")) ? String(body.new_color) : "#2563eb";
    await db(c).prepare("INSERT INTO tags (shop_id, name, color) VALUES (?, ?, ?) ON CONFLICT (shop_id, name) DO NOTHING").bind(shop.id, newTag, color).run();
    const t = await db(c).prepare("SELECT id FROM tags WHERE shop_id = ? AND name = ?").bind(shop.id, newTag).first<{ id: number }>();
    if (t) {
      own.add(t.id);
      picked.add(t.id);
    }
  }
  const keep = [...picked].filter((t) => own.has(t));
  await db(c).batch([
    db(c).prepare("DELETE FROM customer_tags WHERE customer_id = ?").bind(id),
    ...keep.map((t) => db(c).prepare("INSERT INTO customer_tags (customer_id, tag_id) VALUES (?, ?)").bind(id, t)),
  ]);
  return c.redirect(`/panel/customers/${id}`);
});

crmPanel.post("/panel/customers/:id{[0-9]+}/interests", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  if (!(await getCustomer(db(c), shop.id, id))) return c.notFound();
  const productId = Number((await form(c)).product_id);
  const ok = await db(c).prepare("SELECT 1 AS x FROM products WHERE id = ? AND shop_id = ?").bind(productId, shop.id).first();
  if (ok) await addInterest(db(c), shop.id, id, productId, "dm");
  return c.redirect(`/panel/customers/${id}`);
});

// ---------- leads (customers by stage) ----------

crmPanel.get("/panel/leads", async (c) => {
  const shop = shopOf(c);
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  const { results } = await db(c).prepare("SELECT stage, COUNT(*) AS n FROM customers WHERE shop_id = ? GROUP BY stage").bind(shop.id).all<{ stage: Stage; n: number }>();
  for (const r of results) counts[r.stage] = r.n;
  const columns = {} as Record<Stage, (Customer & { last_body: string })[]>;
  await Promise.all(
    STAGES.map(async (st) => {
      columns[st] = (
        await db(c)
          .prepare(
            `SELECT cu.*, COALESCE((SELECT m.body FROM messages m JOIN conversations v ON v.id = m.conversation_id
                                    WHERE v.customer_id = cu.id ORDER BY m.created_at DESC LIMIT 1), '') AS last_body
             FROM customers cu WHERE cu.shop_id = ? AND cu.stage = ? ORDER BY cu.updated_at DESC LIMIT 30`,
          )
          .bind(shop.id, st)
          .all<Customer & { last_body: string }>()
      ).results;
    }),
  );
  return render(c, <LeadsPage {...await ctx(c)} columns={columns} counts={counts} />);
});

// ---------- tasks ----------

crmPanel.get("/panel/tasks", async (c) => {
  const shop = shopOf(c);
  const view = ["mine", "done"].includes(c.req.query("view") ?? "") ? c.req.query("view")! : "open";
  const tasks =
    view === "done"
      ? (await listTasks(db(c), shop.id, { open: false, limit: 100 })).filter((t) => t.done_at)
      : await listTasks(db(c), shop.id, { open: true, mine: view === "mine" ? currentUser(c).id : undefined, limit: 200 });
  const { results: customers } = await db(c)
    .prepare("SELECT id, COALESCE(NULLIF(name, ''), NULLIF('@' || NULLIF(username, ''), '@'), phone) AS name FROM customers WHERE shop_id = ? ORDER BY updated_at DESC LIMIT 200")
    .bind(shop.id)
    .all<{ id: number; name: string }>();
  return render(c, <TasksPage {...await ctx(c)} tasks={tasks} view={view} members={await members(c)} customers={customers} />);
});

crmPanel.post("/panel/tasks", async (c) => {
  const shop = shopOf(c);
  const f = await form(c);
  const back = safeNext(f.back || "/panel/tasks");
  const title = (f.title ?? "").slice(0, 200);
  if (!title) return c.redirect(back);
  const customerId = f.customer_id ? Number(f.customer_id) : null;
  if (customerId && !(await getCustomer(db(c), shop.id, customerId))) return c.text("مشتری پیدا نشد", 400);
  const conversationId = f.conversation_id ? Number(f.conversation_id) : null;
  if (conversationId && !(await getConversation(c, conversationId))) return c.text("گفتگو پیدا نشد", 400);
  const assignedTo = f.assigned_to ? Number(f.assigned_to) : currentUser(c).id;
  if (!(await isMember(c, assignedTo))) return c.text("عضو تیم نیست", 400);
  const id = await createTask(db(c), shop.id, { customerId, conversationId, assignedTo, type: f.type ?? "other", title, dueAt: dueIso(f.due_at), createdBy: currentUser(c).id });
  await logActivity(db(c), shop.id, currentUser(c).id, "create", "task", id ?? null, title);
  return c.redirect(back);
});

crmPanel.post("/panel/tasks/:id{[0-9]+}/toggle", async (c) => {
  const shop = shopOf(c);
  const f = await form(c);
  const task = await db(c).prepare("SELECT id, done_at FROM tasks WHERE id = ? AND shop_id = ?").bind(intParam(c, "id"), shop.id).first<{ id: number; done_at: string | null }>();
  if (!task) return c.notFound();
  await db(c).prepare("UPDATE tasks SET done_at = ? WHERE id = ?").bind(task.done_at ? null : now(), task.id).run();
  await logActivity(db(c), shop.id, currentUser(c).id, task.done_at ? "reopen" : "done", "task", task.id);
  return c.redirect(safeNext(f.back || "/panel/tasks"));
});

// ---------- direct sales (manual orders) ----------

crmPanel.get("/panel/sales", async (c) => {
  const shop = shopOf(c);
  const status = (c.req.query("status") ?? "") in CRM_ORDER_STATUS ? c.req.query("status")! : "";
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  const where = ["o.shop_id = ?"];
  const args: (string | number)[] = [shop.id];
  if (status) {
    where.push("o.status = ?");
    args.push(status);
  }
  if (q) {
    const n = Number(normalizeDigits(q).replace(/\D/g, ""));
    where.push("(cu.name LIKE ? OR cu.username LIKE ? OR cu.phone LIKE ? OR o.number = ?)");
    args.push(`%${q}%`, `%${q.replace(/^@/, "")}%`, `%${q}%`, n || -1);
  }
  const [orders, counts] = await db(c).batch([
    db(c)
      .prepare(
        `SELECT o.*, cu.name AS customer_name, cu.username AS customer_username FROM crm_orders o JOIN customers cu ON cu.id = o.customer_id
         WHERE ${where.join(" AND ")} ORDER BY o.created_at DESC LIMIT 200`,
      )
      .bind(...args),
    db(c).prepare("SELECT status, COUNT(*) AS n FROM crm_orders WHERE shop_id = ? GROUP BY status").bind(shop.id),
  ]);
  return render(
    c,
    <SalesPage
      {...await ctx(c)}
      orders={orders.results as (CrmOrder & { customer_name: string; customer_username: string })[]}
      status={status}
      q={q}
      counts={Object.fromEntries((counts.results as { status: string; n: number }[]).map((r) => [r.status, r.n]))}
    />,
  );
});

/** Every sellable variant of the shop's products, with its price and (tracked) stock. */
async function variantOptions(c: C): Promise<VariantOption[]> {
  const { results: products } = await db(c)
    .prepare("SELECT id, title, price, size_guide, colors, track_stock FROM products WHERE shop_id = ? ORDER BY is_active DESC, title LIMIT 300")
    .bind(shopOf(c).id)
    .all<{ id: number; title: string; price: number; size_guide: string; colors: string; track_stock: number }>();
  const out: VariantOption[] = [];
  for (const p of products) {
    const { results: rows } = await db(c)
      .prepare("SELECT size, color, quantity, price, sale_price FROM product_stock WHERE product_id = ?")
      .bind(p.id)
      .all<{ size: string; color: string; quantity: number; price: number | null; sale_price: number | null }>();
    const byKey = new Map(rows.map((r) => [`${r.size}|${r.color}`, r]));
    for (const v of variants(p)) {
      const s = byKey.get(v.key);
      const stock = p.track_stock ? (s?.quantity ?? 0) : null;
      out.push({
        value: `${p.id}|${v.size}|${v.color}`,
        label: [p.title, variantLabel(v.size, v.color)].filter(Boolean).join(" — "),
        price: s?.sale_price ?? s?.price ?? p.price,
        stock,
      });
    }
  }
  return out;
}

const customerOptions = async (c: C) =>
  (
    await db(c)
      .prepare("SELECT id, COALESCE(NULLIF(name, ''), NULLIF('@' || NULLIF(username, ''), '@'), phone) AS name FROM customers WHERE shop_id = ? ORDER BY updated_at DESC LIMIT 300")
      .bind(shopOf(c).id)
      .all<{ id: number; name: string }>()
  ).results;

crmPanel.get("/panel/sales/new", async (c) => {
  const customerId = Number(c.req.query("customer")) || null;
  return render(c, <NewSalePage {...await ctx(c)} customers={await customerOptions(c)} customerId={customerId} variants={await variantOptions(c)} />);
});

crmPanel.post("/panel/sales/new", async (c) => {
  const shop = shopOf(c);
  const f = await form(c);
  const customerId = Number(f.customer_id);
  const fail = async (error: string) =>
    render(c, <NewSalePage {...await ctx(c)} customers={await customerOptions(c)} customerId={customerId || null} variants={await variantOptions(c)} error={error} />, 400);
  if (!customerId || !(await getCustomer(db(c), shop.id, customerId))) return fail("مشتری را انتخاب کنید.");
  const items: NewOrderItem[] = [];
  for (let n = 0; n < 4; n++) {
    const v = f[`item_${n}`];
    if (!v) continue;
    const [pid, size = "", color = ""] = v.split("|");
    const qty = Math.min(99, Math.max(1, Math.floor(Number(f[`qty_${n}`]) || 1)));
    const same = items.find((i) => i.productId === Number(pid) && i.size === size && i.color === color);
    if (same) same.qty += qty;
    else items.push({ productId: Number(pid), size, color, qty });
  }
  const method = (f.method ?? "") in PAYMENT_METHODS ? f.method! : "card";
  const r = await createCrmOrder(db(c), shop.id, customerId, items, {
    discount: money(f.discount),
    shipping: money(f.shipping),
    method,
    note: (f.note ?? "").slice(0, 300),
    paid: f.paid === "1",
    userId: currentUser(c).id,
  });
  if ("error" in r) return fail(r.error);
  return c.redirect(`/panel/sales/${r.id}?saved=1`);
});

async function saleView(c: C, id: number, saved?: string) {
  const shop = shopOf(c);
  const o = await db(c).prepare("SELECT * FROM crm_orders WHERE id = ? AND shop_id = ?").bind(id, shop.id).first<CrmOrder>();
  if (!o) return c.notFound();
  const [items, customer] = await Promise.all([orderItems(db(c), id), getCustomer(db(c), shop.id, o.customer_id)]);
  return render(c, <SalePage {...await ctx(c)} o={o} items={items} customer={customer!} saved={saved} />);
}

crmPanel.get("/panel/sales/:id{[0-9]+}", (c) => saleView(c, intParam(c, "id"), c.req.query("saved") ? "سفارش ثبت شد." : undefined));

crmPanel.post("/panel/sales/:id{[0-9]+}", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  const o = await db(c).prepare("SELECT * FROM crm_orders WHERE id = ? AND shop_id = ?").bind(id, shop.id).first<CrmOrder>();
  if (!o) return c.notFound();
  const f = await form(c);
  const next = {
    status: (f.status ?? "") in CRM_ORDER_STATUS && f.status !== "canceled" && o.status !== "canceled" ? (f.status as CrmOrder["status"]) : o.status,
    payment_status: (f.payment_status ?? "") in PAYMENT_STATUS ? (f.payment_status as CrmOrder["payment_status"]) : o.payment_status,
    tracking_number: (f.tracking_number ?? "").slice(0, 60),
  };
  const changes = diff(o as unknown as Record<string, unknown>, next);
  if (Object.keys(changes).length) {
    await db(c)
      .prepare("UPDATE crm_orders SET status = ?, payment_status = ?, tracking_number = ?, updated_at = ? WHERE id = ?")
      .bind(next.status, next.payment_status, next.tracking_number, now(), id)
      .run();
    await logActivity(db(c), shop.id, currentUser(c).id, "update", "order", id, changes);
  }
  return saleView(c, id, "ذخیره شد.");
});

crmPanel.post("/panel/sales/:id{[0-9]+}/cancel", async (c) => {
  const id = intParam(c, "id");
  const ok = await cancelCrmOrder(db(c), shopOf(c).id, id, currentUser(c).id);
  return saleView(c, id, ok ? "سفارش لغو شد و موجودی برگشت." : undefined);
});

// ---------- automation, quick replies, tags (admins) ----------

async function automationView(c: C, extra: { saved?: string; error?: string } = {}) {
  const shop = shopOf(c);
  const [rules, replies, tags] = await Promise.all([
    db(c)
      .prepare("SELECT r.*, t.name AS tag_name FROM automation_rules r LEFT JOIN tags t ON t.id = r.tag_id WHERE r.shop_id = ? ORDER BY r.kind, r.id")
      .bind(shop.id)
      .all<Rule & { tag_name: string | null }>(),
    db(c).prepare("SELECT id, title, body FROM quick_replies WHERE shop_id = ? ORDER BY title").bind(shop.id).all<{ id: number; title: string; body: string }>(),
    shopTags(db(c), shop.id),
  ]);
  return render(c, <AutomationPage {...await ctx(c)} rules={rules.results} replies={replies.results} tags={tags} {...extra} />, extra.error ? 400 : 200);
}

crmPanel.get("/panel/automation", (c) => automationView(c));

crmPanel.post("/panel/automation/rules", async (c) => {
  const shop = shopOf(c);
  const f = await form(c);
  const kind = f.kind as Rule["kind"];
  if (!["welcome", "keyword", "offer_followup"].includes(kind)) return automationView(c, { error: "نوع قانون نامعتبر است." });
  const keyword = (f.keyword ?? "").slice(0, 200);
  const reply = (f.reply ?? "").slice(0, 1000);
  const setStage = isStage(f.set_stage ?? "") ? f.set_stage! : "";
  const tagId = f.tag_id ? Number(f.tag_id) : null;
  if (tagId && !(await shopTags(db(c), shop.id)).some((t) => t.id === tagId)) return automationView(c, { error: "برچسب نامعتبر است." });
  if (kind === "keyword" && !keyword) return automationView(c, { error: "کلمه کلیدی لازم است." });
  if (kind === "keyword" && !reply && !setStage && !tagId) return automationView(c, { error: "برای کلمه کلیدی یک پاسخ، مرحله یا برچسب تعیین کنید." });
  if (kind === "welcome" && !reply) return automationView(c, { error: "متن پیام خوش‌آمد لازم است." });
  const hours = Math.min(720, Math.max(1, Math.floor(Number(f.hours) || 24)));
  const row = await db(c)
    .prepare("INSERT INTO automation_rules (shop_id, kind, keyword, reply, set_stage, tag_id, hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(shop.id, kind, kind === "keyword" ? keyword : "", reply, kind === "keyword" ? setStage : "", kind === "keyword" ? tagId : null, hours, now())
    .first<{ id: number }>();
  await logActivity(db(c), shop.id, currentUser(c).id, "create", "automation", row!.id, kind);
  return automationView(c, { saved: "قانون اضافه شد." });
});

crmPanel.post("/panel/automation/rules/:id{[0-9]+}", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  const f = await form(c);
  if (f.do === "delete") await db(c).prepare("DELETE FROM automation_rules WHERE id = ? AND shop_id = ?").bind(id, shop.id).run();
  else await db(c).prepare("UPDATE automation_rules SET active = 1 - active WHERE id = ? AND shop_id = ?").bind(id, shop.id).run();
  await logActivity(db(c), shop.id, currentUser(c).id, f.do === "delete" ? "delete" : "toggle", "automation", id);
  return c.redirect("/panel/automation");
});

crmPanel.post("/panel/automation/replies", async (c) => {
  const f = await form(c);
  const title = (f.title ?? "").slice(0, 60);
  const body = (f.body ?? "").slice(0, 1000);
  if (!title || !body) return automationView(c, { error: "عنوان و متن پاسخ لازم است." });
  await db(c).prepare("INSERT INTO quick_replies (shop_id, title, body) VALUES (?, ?, ?)").bind(shopOf(c).id, title, body).run();
  return automationView(c, { saved: "پاسخ آماده اضافه شد." });
});

crmPanel.post("/panel/automation/replies/:id{[0-9]+}", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  const f = await form(c);
  if (f.do === "delete") {
    await db(c).prepare("DELETE FROM quick_replies WHERE id = ? AND shop_id = ?").bind(id, shop.id).run();
  } else {
    const title = (f.title ?? "").slice(0, 60);
    const body = (f.body ?? "").slice(0, 1000);
    if (!title || !body) return automationView(c, { error: "عنوان و متن پاسخ لازم است." });
    await db(c).prepare("UPDATE quick_replies SET title = ?, body = ? WHERE id = ? AND shop_id = ?").bind(title, body, id, shop.id).run();
  }
  return c.redirect("/panel/automation");
});

crmPanel.post("/panel/automation/tags", async (c) => {
  const f = await form(c);
  const name = (f.name ?? "").slice(0, 30);
  if (!name) return automationView(c, { error: "نام برچسب لازم است." });
  const color = /^#[0-9a-f]{6}$/i.test(f.color ?? "") ? f.color! : "#2563eb";
  await db(c).prepare("INSERT INTO tags (shop_id, name, color) VALUES (?, ?, ?) ON CONFLICT (shop_id, name) DO UPDATE SET color = excluded.color").bind(shopOf(c).id, name, color).run();
  return c.redirect("/panel/automation");
});

crmPanel.post("/panel/automation/tags/:id{[0-9]+}/delete", async (c) => {
  await db(c).prepare("DELETE FROM tags WHERE id = ? AND shop_id = ?").bind(intParam(c, "id"), shopOf(c).id).run();
  return c.redirect("/panel/automation");
});

// ---------- team & activity (admins) ----------

async function teamView(c: C, extra: { saved?: string; error?: string } = {}) {
  const { results: activity } = await db(c)
    .prepare(
      `SELECT a.action, a.entity_type, a.entity_id, a.changes, a.created_at, u.name AS user_name
       FROM activity_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.shop_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 60`,
    )
    .bind(shopOf(c).id)
    .all<{ action: string; entity_type: string; entity_id: number | null; changes: string; created_at: string; user_name: string | null }>();
  return render(c, <TeamPage {...await ctx(c)} members={await members(c)} activity={activity} {...extra} />, extra.error ? 400 : 200);
}

crmPanel.get("/panel/team", (c) => teamView(c));

crmPanel.post("/panel/team", async (c) => {
  const shop = shopOf(c);
  const phone = normalizePhone((await form(c)).phone ?? "");
  const u = await db(c).prepare("SELECT id, shop_id FROM users WHERE phone = ?").bind(phone).first<{ id: number; shop_id: number | null }>();
  if (!u) return teamView(c, { error: "کاربری با این شماره نیست. اول باید یک بار در سایت وارد شود." });
  if (u.shop_id === shop.id) return teamView(c, { error: "این کاربر عضو تیم است." });
  if (u.shop_id) return teamView(c, { error: "این کاربر عضو فروشگاه دیگری است." });
  const owns = await db(c).prepare("SELECT 1 AS x FROM shops WHERE owner_id = ?").bind(u.id).first();
  if (owns) return teamView(c, { error: "این کاربر فروشگاه خودش را دارد." });
  await db(c).prepare("UPDATE users SET shop_id = ?, shop_role = 'agent' WHERE id = ?").bind(shop.id, u.id).run();
  await logActivity(db(c), shop.id, currentUser(c).id, "create", "member", u.id, phone);
  return teamView(c, { saved: "به تیم اضافه شد." });
});

crmPanel.post("/panel/team/:id{[0-9]+}/remove", async (c) => {
  const shop = shopOf(c);
  const id = intParam(c, "id");
  if (id === shop.owner_id) return teamView(c, { error: "صاحب فروشگاه را نمی‌توان حذف کرد." });
  await db(c).batch([
    db(c).prepare("UPDATE users SET shop_id = NULL, shop_role = '' WHERE id = ? AND shop_id = ?").bind(id, shop.id),
    db(c).prepare("UPDATE conversations SET assigned_to = NULL WHERE shop_id = ? AND assigned_to = ?").bind(shop.id, id),
  ]);
  await logActivity(db(c), shop.id, currentUser(c).id, "delete", "member", id);
  return teamView(c, { saved: "از تیم حذف شد." });
});

// ---------- Instagram connection (admins) ----------

/** A pasted token without the wrapping people copy along: spaces, quotes, "Bearer ", a URL around it. */
export function cleanIgToken(raw: string) {
  let t = raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^bearer\s+/i, "");
  const inUrl = t.match(/access_token=([^&#\s]+)/);
  if (inUrl) t = decodeURIComponent(inUrl[1]);
  return t.replace(/\s/g, "").slice(0, 1000);
}

crmPanel.post("/panel/settings/instagram", async (c) => {
  const shop = shopOf(c);
  const f = await form(c);
  const back = (kind: "ok" | "error", msg: string) => c.redirect(`/panel/settings?ig_${kind}=${encodeURIComponent(msg)}#instagram`);
  if (f.disconnect) {
    await db(c).prepare("UPDATE shops SET ig_access_token = '' WHERE id = ?").bind(shop.id).run();
    await logActivity(db(c), shop.id, currentUser(c).id, "update", "shop", shop.id, "instagram disconnected");
    return back("ok", "اتصال اینستاگرام قطع شد.");
  }
  let account = normalizeDigits(f.ig_account_id ?? "").replace(/\D/g, "").slice(0, 30);
  let username = shop.ig_username;
  const token = cleanIgToken(f.ig_access_token ?? "");
  let note = "ذخیره شد.";
  if (token) {
    if (/^EAA/.test(token)) {
      return back(
        "error",
        "این توکن فیسبوک است (با EAA شروع می‌شود)، نه توکن اینستاگرام. در developers.facebook.com ← Instagram API ← «Generate access tokens» توکنی بسازید که با IG شروع شود.",
      );
    }
    // The token says which account it belongs to; the id webhooks use is its user_id.
    try {
      const me = await fetchAccount(token);
      if (me.accountId) account = me.accountId;
      username = me.username;
      note = `وصل شد: @${me.username}`;
    } catch (e) {
      const msg = (e as Error).message;
      // Instagram rejected the token itself: never store it. Only a network problem lets it through.
      if (!account || /oauth|access token|session|expired|invalid|permission/i.test(msg)) {
        return back("error", `اینستاگرام توکن را نپذیرفت: ${msg}. توکن را دوباره از صفحه اپ (Generate access tokens) کامل کپی کنید؛ باید با IG شروع شود.`);
      }
      note = `ذخیره شد، ولی بررسی توکن با اینستاگرام ممکن نشد (${msg}).`;
    }
  }
  if (!account) return back("error", "توکن دسترسی را وارد کنید.");
  const taken = await db(c).prepare("SELECT 1 AS x FROM shops WHERE ig_account_id = ? AND id <> ?").bind(account, shop.id).first();
  if (taken) return back("error", "این حساب اینستاگرام به فروشگاه دیگری وصل است.");
  await db(c)
    .prepare(
      `UPDATE shops SET ig_account_id = ?1, ig_username = ?2,
         ig_access_token = CASE WHEN ?3 <> '' THEN ?3 ELSE ig_access_token END,
         ig_token_refreshed_at = CASE WHEN ?3 <> '' THEN ?4 ELSE ig_token_refreshed_at END
       WHERE id = ?5`,
    )
    .bind(account, username, token, now(), shop.id)
    .run();
  await logActivity(db(c), shop.id, currentUser(c).id, "update", "shop", shop.id, "instagram connected");
  return back("ok", note);
});

// ---------- reels & posts linked to products (admins) ----------

crmPanel.get("/panel/reels", async (c) => {
  const shop = shopOf(c);
  const connected = !!(shop.ig_account_id && shop.ig_access_token);
  let media: IgMedia[] = [];
  let apiError: string | undefined;
  if (connected) {
    try {
      media = await listMedia(shop.ig_access_token, shop.ig_account_id);
    } catch (e) {
      apiError = (e as Error).message;
    }
  }
  const [links, stats, products, recent] = await Promise.all([
    db(c).prepare("SELECT * FROM ig_media_links WHERE shop_id = ? ORDER BY created_at DESC").bind(shop.id).all<MediaLink>(),
    db(c)
      .prepare("SELECT media_id, COUNT(*) AS comments, COALESCE(SUM(action = 'dm'), 0) AS dms FROM ig_comments WHERE shop_id = ? GROUP BY media_id")
      .bind(shop.id)
      .all<{ media_id: string; comments: number; dms: number }>(),
    db(c).prepare("SELECT id, title FROM products WHERE shop_id = ? ORDER BY is_active DESC, title LIMIT 300").bind(shop.id).all<{ id: number; title: string }>(),
    db(c)
      .prepare(
        `SELECT k.username, k.body, k.action, k.error, k.created_at, k.customer_id, COALESCE(l.caption, '') AS caption
         FROM ig_comments k LEFT JOIN ig_media_links l ON l.shop_id = k.shop_id AND l.media_id = k.media_id
         WHERE k.shop_id = ? ORDER BY k.created_at DESC, k.id DESC LIMIT 30`,
      )
      .bind(shop.id)
      .all<{ username: string; body: string; action: string; error: string; created_at: string; caption: string; customer_id: number | null }>(),
  ]);
  const byMedia = new Map(links.results.map((l) => [l.media_id, l]));
  const counts = new Map(stats.results.map((r) => [r.media_id, r]));
  const item = (id: string, m: Partial<IgMedia>, l: MediaLink | null): ReelItem => ({
    mediaId: id,
    permalink: m.permalink ?? l?.permalink ?? "",
    caption: m.caption ?? l?.caption ?? "",
    thumb: m.thumbnail_url ?? m.media_url ?? l?.thumb ?? "",
    kind: m.media_product_type ?? "FEED",
    at: m.timestamp ?? null,
    link: l,
    comments: counts.get(id)?.comments ?? 0,
    dms: counts.get(id)?.dms ?? 0,
  });
  const items = media.map((m) => item(m.id, m, byMedia.get(m.id) ?? null));
  // Linked posts that are no longer among the latest ones still show (and keep working).
  for (const l of links.results) if (!media.some((m) => m.id === l.media_id)) items.push(item(l.media_id, {}, l));
  return render(
    c,
    <ReelsPage
      {...await ctx(c)}
      connected={connected}
      items={items}
      products={products.results}
      recent={recent.results}
      apiError={apiError}
      saved={c.req.query("saved") ? "ذخیره شد." : undefined}
    />,
  );
});

crmPanel.post("/panel/reels/:media{[0-9]{5,30}}", async (c) => {
  const shop = shopOf(c);
  const mediaId = c.req.param("media");
  const f = await form(c);
  const productId = Number(f.product_id) || null;
  if (productId && !(await db(c).prepare("SELECT 1 AS x FROM products WHERE id = ? AND shop_id = ?").bind(productId, shop.id).first())) {
    return c.text("محصول پیدا نشد", 400);
  }
  const https = (u: string | undefined) => (u && /^https:\/\//.test(u) ? u.slice(0, 1000) : "");
  await db(c)
    .prepare(
      `INSERT INTO ig_media_links (shop_id, media_id, product_id, permalink, caption, thumb, keywords, comment_reply, dm_text, active, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (shop_id, media_id) DO UPDATE SET product_id = ?3, permalink = ?4, caption = ?5, thumb = ?6, keywords = ?7,
         comment_reply = ?8, dm_text = ?9, active = ?10`,
    )
    .bind(
      shop.id,
      mediaId,
      productId,
      https(f.permalink),
      (f.caption ?? "").slice(0, 300),
      https(f.thumb),
      (f.keywords ?? "").slice(0, 300),
      (f.comment_reply ?? "").slice(0, 300),
      (f.dm_text ?? "").slice(0, 1000),
      f.active === "1" ? 1 : 0,
      now(),
    )
    .run();
  await logActivity(db(c), shop.id, currentUser(c).id, "update", "reel", null, { media: mediaId, product: productId });
  return c.redirect("/panel/reels?saved=1");
});

crmPanel.post("/panel/reels/:media{[0-9]{5,30}}/delete", async (c) => {
  await db(c).prepare("DELETE FROM ig_media_links WHERE shop_id = ? AND media_id = ?").bind(shopOf(c).id, c.req.param("media")).run();
  return c.redirect("/panel/reels?saved=1");
});
