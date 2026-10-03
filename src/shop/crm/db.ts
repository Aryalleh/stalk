// Shop CRM data access. Every query is scoped by shop_id.
import { now } from "../db";

export const STAGES = ["lead", "interested", "offer_sent", "purchased"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  lead: "سرنخ",
  interested: "علاقه‌مند",
  offer_sent: "پیشنهاد داده شد",
  purchased: "خریدار",
};
export const isStage = (v: string): v is Stage => (STAGES as readonly string[]).includes(v);

export const CONVERSATION_STATUS = { open: "باز", pending: "در انتظار", closed: "بسته" } as const;
export type ConversationStatus = keyof typeof CONVERSATION_STATUS;

export const TASK_TYPES = { follow_up: "پیگیری", call: "تماس", send_offer: "ارسال پیشنهاد", birthday: "تولد", other: "سایر" } as const;
export type TaskType = keyof typeof TASK_TYPES;

export const CRM_ORDER_STATUS = { new: "جدید", confirmed: "تأیید شده", shipped: "ارسال شد", delivered: "تحویل شد", canceled: "لغو شد" } as const;
export type CrmOrderStatus = keyof typeof CRM_ORDER_STATUS;
export const PAYMENT_STATUS = { unpaid: "پرداخت نشده", paid: "پرداخت شده", refunded: "برگشت داده شد" } as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUS;
export const PAYMENT_METHODS = { card: "کارت به کارت", cash: "نقدی / در محل", online: "درگاه آنلاین", other: "سایر" } as const;

export interface Customer {
  id: number;
  shop_id: number;
  ig_user_id: string | null;
  username: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  birthday: string;
  source: string;
  stage: Stage;
  total_spent: number;
  orders_count: number;
  last_order_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface Conversation {
  id: number;
  shop_id: number;
  customer_id: number;
  status: ConversationStatus;
  assigned_to: number | null;
  last_customer_msg_at: string | null;
  last_message_at: string | null;
  unread: number;
  created_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  ig_message_id: string | null;
  direction: "in" | "out";
  type: string;
  body: string;
  sent_by: number | null;
  status: string;
  error: string;
  created_at: string;
}

export interface Task {
  id: number;
  customer_id: number | null;
  conversation_id: number | null;
  assigned_to: number | null;
  type: TaskType;
  title: string;
  due_at: string | null;
  done_at: string | null;
  created_at: string;
}

export interface CrmOrder {
  id: number;
  shop_id: number;
  customer_id: number;
  number: number;
  status: CrmOrderStatus;
  payment_status: PaymentStatus;
  payment_method: string;
  discount: number;
  shipping_cost: number;
  total: number;
  tracking_number: string;
  note: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CrmOrderItem {
  id: number;
  order_id: number;
  product_id: number;
  size: string;
  color: string;
  title: string;
  qty: number;
  unit_price: number;
}

// ---------- activity log ----------

export async function logActivity(
  db: D1Database,
  shopId: number,
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  changes: Record<string, unknown> | string = "",
) {
  await db
    .prepare("INSERT INTO activity_log (shop_id, user_id, action, entity_type, entity_id, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(shopId, userId, action, entityType, entityId, typeof changes === "string" ? changes : JSON.stringify(changes), now())
    .run();
}

/** {field: [old, new]} for the fields that changed. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(after)) if (v !== undefined && before[k] !== v) out[k] = [before[k], v];
  return out;
}

// ---------- customers ----------

export const getCustomer = (db: D1Database, shopId: number, id: number) =>
  db.prepare("SELECT * FROM customers WHERE id = ? AND shop_id = ?").bind(id, shopId).first<Customer>();

/** The customer behind an Instagram sender; created as a new lead on their first DM. */
export async function customerForIg(db: D1Database, shopId: number, igUserId: string, profile: { username?: string; name?: string } = {}) {
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO customers (shop_id, ig_user_id, username, name, source, stage, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'instagram', 'lead', ?5, ?5)
       ON CONFLICT (shop_id, ig_user_id) WHERE ig_user_id IS NOT NULL DO NOTHING
       RETURNING id`,
    )
    .bind(shopId, igUserId, profile.username ?? "", profile.name ?? "", t)
    .first<{ id: number }>();
  if (row) return { id: row.id, created: true };
  const existing = await db.prepare("SELECT id FROM customers WHERE shop_id = ? AND ig_user_id = ?").bind(shopId, igUserId).first<{ id: number }>();
  return { id: existing!.id, created: false };
}

/** The customer with this phone in the shop's CRM, created if new (site buyers, manual entries). */
export async function customerForPhone(db: D1Database, shopId: number, phone: string, name: string, source: string) {
  const found = await db.prepare("SELECT id FROM customers WHERE shop_id = ? AND phone = ? LIMIT 1").bind(shopId, phone).first<{ id: number }>();
  if (found) return found.id;
  const t = now();
  const row = await db
    .prepare("INSERT INTO customers (shop_id, phone, name, source, stage, created_at, updated_at) VALUES (?, ?, ?, ?, 'lead', ?, ?) RETURNING id")
    .bind(shopId, phone, name, source, t, t)
    .first<{ id: number }>();
  return row!.id;
}

export interface CustomerFilter {
  q?: string;
  stage?: string;
  tag?: number;
  limit: number;
  offset: number;
}

export type CustomerRow = Customer & { tags: string; last_message_at: string | null; unread: number; conversation_id: number | null };

export async function listCustomers(db: D1Database, shopId: number, f: CustomerFilter) {
  const where = ["c.shop_id = ?"];
  const binds: unknown[] = [shopId];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (x) => "\\" + x)}%`;
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.city LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like);
  }
  if (f.stage && isStage(f.stage)) {
    where.push("c.stage = ?");
    binds.push(f.stage);
  }
  if (f.tag) {
    where.push("EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.customer_id = c.id AND ct.tag_id = ?)");
    binds.push(f.tag);
  }
  const { results } = await db
    .prepare(
      `SELECT c.*,
              COALESCE((SELECT group_concat(t.name || '|' || t.color, ',') FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = c.id), '') AS tags,
              v.id AS conversation_id, v.last_message_at, COALESCE(v.unread, 0) AS unread
       FROM customers c LEFT JOIN conversations v ON v.customer_id = c.id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(v.last_message_at, c.updated_at) DESC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, f.limit, f.offset)
    .all<CustomerRow>();
  return results;
}

/** "name|color,name|color" → tags. */
export const parseTags = (s: string) =>
  s
    ? s.split(",").map((x) => {
        const [name, color] = x.split("|");
        return { name, color };
      })
    : [];

export async function customerTags(db: D1Database, customerId: number) {
  const { results } = await db.prepare("SELECT t.* FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = ? ORDER BY t.name").bind(customerId).all<Tag>();
  return results;
}

export async function shopTags(db: D1Database, shopId: number) {
  const { results } = await db.prepare("SELECT id, name, color FROM tags WHERE shop_id = ? ORDER BY name").bind(shopId).all<Tag>();
  return results;
}

/** Move a customer to a stage; logs the change. Returns false if it was already there. */
export async function setStage(db: D1Database, shopId: number, customerId: number, stage: Stage, userId: number | null) {
  const c = await getCustomer(db, shopId, customerId);
  if (!c || c.stage === stage) return false;
  await db.prepare("UPDATE customers SET stage = ?, updated_at = ? WHERE id = ? AND shop_id = ?").bind(stage, now(), customerId, shopId).run();
  await logActivity(db, shopId, userId, "stage", "customer", customerId, { stage: [c.stage, stage] });
  return true;
}

/**
 * Recount a customer's purchases: manual CRM orders (not canceled) plus the site's paid gift orders
 * from the same phone at this shop. The first purchase moves the customer to "purchased".
 */
export async function refreshCustomerStats(db: D1Database, shopId: number, customerId: number) {
  const c = await getCustomer(db, shopId, customerId);
  if (!c) return;
  const stats = await db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS spent, COUNT(*) AS n, MAX(at) AS last FROM (
         SELECT total, created_at AS at FROM crm_orders WHERE customer_id = ?1 AND status <> 'canceled'
         UNION ALL
         SELECT amount, paid_at FROM orders WHERE shop_id = ?2 AND ?3 <> '' AND giver_phone = ?3 AND status IN ('paid', 'shipped', 'delivered')
       )`,
    )
    .bind(customerId, shopId, c.phone)
    .first<{ spent: number; n: number; last: string | null }>();
  const stage = stats && stats.n > 0 ? "purchased" : c.stage;
  await db
    .prepare("UPDATE customers SET total_spent = ?, orders_count = ?, last_order_at = ?, stage = ?, updated_at = ? WHERE id = ?")
    .bind(stats?.spent ?? 0, stats?.n ?? 0, stats?.last ?? null, stage, now(), customerId)
    .run();
}

export async function addInterest(db: D1Database, shopId: number, customerId: number, productId: number, source: "dm" | "order") {
  await db
    .prepare(
      `INSERT INTO product_interests (shop_id, customer_id, product_id, source, created_at)
       SELECT ?, ?, id, ?, ? FROM products WHERE id = ? AND shop_id = ?
       ON CONFLICT (customer_id, product_id, source) DO NOTHING`,
    )
    .bind(shopId, customerId, source, now(), productId, shopId)
    .run();
}

// ---------- conversations & messages ----------

export async function conversationFor(db: D1Database, shopId: number, customerId: number) {
  const t = now();
  await db
    .prepare("INSERT INTO conversations (shop_id, customer_id, status, created_at) VALUES (?, ?, 'open', ?) ON CONFLICT (customer_id) DO NOTHING")
    .bind(shopId, customerId, t)
    .run();
  return (await db.prepare("SELECT * FROM conversations WHERE customer_id = ?").bind(customerId).first<Conversation>())!;
}

/** Store an incoming DM (idempotent on Instagram's message id). Returns the new message id, or null for a repeat. */
export async function addIncoming(db: D1Database, shopId: number, conversationId: number, m: { igId: string; type: string; body: string; at: string }) {
  const row = await db
    .prepare(
      `INSERT INTO messages (shop_id, conversation_id, ig_message_id, direction, type, body, created_at)
       VALUES (?, ?, ?, 'in', ?, ?, ?) ON CONFLICT (ig_message_id) DO NOTHING RETURNING id`,
    )
    .bind(shopId, conversationId, m.igId, m.type, m.body, m.at)
    .first<{ id: number }>();
  if (!row) return null;
  // A new customer message reopens the conversation and counts as unread.
  await db
    .prepare("UPDATE conversations SET status = 'open', unread = unread + 1, last_customer_msg_at = ?2, last_message_at = ?2 WHERE id = ?1")
    .bind(conversationId, m.at)
    .run();
  return row.id;
}

export async function addOutgoing(
  db: D1Database,
  shopId: number,
  conversationId: number,
  m: { body: string; sentBy: number | null; igId?: string | null; status?: string; error?: string; at?: string },
) {
  const at = m.at ?? now();
  const row = await db
    .prepare(
      `INSERT INTO messages (shop_id, conversation_id, ig_message_id, direction, type, body, sent_by, status, error, created_at)
       VALUES (?, ?, ?, 'out', 'text', ?, ?, ?, ?, ?) ON CONFLICT (ig_message_id) DO NOTHING RETURNING id`,
    )
    .bind(shopId, conversationId, m.igId ?? null, m.body, m.sentBy, m.status ?? "sent", m.error ?? "", at)
    .first<{ id: number }>();
  await db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").bind(at, conversationId).run();
  return row?.id ?? null;
}

export async function conversationMessages(db: D1Database, conversationId: number, limit = 200) {
  const { results } = await db
    .prepare(
      `SELECT * FROM (SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sent_by
                      WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?)
       ORDER BY created_at, id`,
    )
    .bind(conversationId, limit)
    .all<Message & { sender_name: string | null }>();
  return results;
}

export type InboxRow = Conversation & {
  name: string;
  username: string;
  stage: Stage;
  last_body: string;
  last_direction: string;
  assignee: string | null;
};

export async function listConversations(db: D1Database, shopId: number, f: { status?: string; mine?: number; q?: string; limit: number }) {
  const where = ["v.shop_id = ?"];
  const binds: unknown[] = [shopId];
  if (f.status && f.status in CONVERSATION_STATUS) {
    where.push("v.status = ?");
    binds.push(f.status);
  }
  if (f.mine) {
    where.push("v.assigned_to = ?");
    binds.push(f.mine);
  }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (x) => "\\" + x)}%`;
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')");
    binds.push(like, like, like);
  }
  const { results } = await db
    .prepare(
      `SELECT v.*, c.name, c.username, c.stage, u.name AS assignee,
              COALESCE((SELECT body FROM messages m WHERE m.conversation_id = v.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1), '') AS last_body,
              COALESCE((SELECT direction FROM messages m WHERE m.conversation_id = v.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1), '') AS last_direction
       FROM conversations v JOIN customers c ON c.id = v.customer_id LEFT JOIN users u ON u.id = v.assigned_to
       WHERE ${where.join(" AND ")}
       ORDER BY v.unread > 0 DESC, COALESCE(v.last_message_at, v.created_at) DESC LIMIT ?`,
    )
    .bind(...binds, f.limit)
    .all<InboxRow>();
  return results;
}

// ---------- timeline ----------

export interface TimelineEntry {
  kind: "message" | "note" | "task" | "order" | "gift" | "activity";
  at: string;
  title: string;
  body: string;
  ref: number | null;
  extra: string;
}

/**
 * Everything that happened with a customer, newest first (built from the tables, not stored). D1
 * allows at most 5 terms in one compound SELECT, so it is two UNIONs merged here.
 */
export async function timeline(db: D1Database, shopId: number, c: Customer, limit = 80) {
  const [talk, deals] = await db.batch<TimelineEntry>([
    db
      .prepare(
        `SELECT 'message' AS kind, m.created_at AS at, m.direction AS title, m.body, m.id AS ref, COALESCE(u.name, '') AS extra
           FROM messages m JOIN conversations v ON v.id = m.conversation_id LEFT JOIN users u ON u.id = m.sent_by WHERE v.customer_id = ?1
         UNION ALL
         SELECT 'note', n.created_at, COALESCE(u.name, ''), n.body, n.id, '' FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.customer_id = ?1
         UNION ALL
         SELECT 'task', COALESCE(t.done_at, t.created_at), t.type, t.title, t.id, CASE WHEN t.done_at IS NULL THEN 'open' ELSE 'done' END FROM tasks t WHERE t.customer_id = ?1
         ORDER BY at DESC LIMIT ?2`,
      )
      .bind(c.id, limit),
    db
      .prepare(
        `SELECT 'order' AS kind, o.created_at AS at, o.status AS title, o.total AS body, o.id AS ref, o.number AS extra FROM crm_orders o WHERE o.customer_id = ?1
         UNION ALL
         SELECT 'gift', g.created_at, g.status, g.amount, g.id, g.product_title FROM orders g
           WHERE g.shop_id = ?2 AND ?3 <> '' AND g.giver_phone = ?3 AND g.status <> 'pending'
         UNION ALL
         SELECT 'activity', a.created_at, a.action, a.changes, a.id, COALESCE(u.name, '') FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.entity_type = 'customer' AND a.entity_id = ?1 AND a.action IN ('stage', 'create')
         ORDER BY at DESC LIMIT ?4`,
      )
      .bind(c.id, shopId, c.phone, limit),
  ]);
  return [...talk.results, ...deals.results].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

// ---------- tasks ----------

export async function createTask(
  db: D1Database,
  shopId: number,
  t: { customerId: number | null; conversationId?: number | null; assignedTo?: number | null; type: string; title: string; dueAt: string | null; createdBy: number | null },
) {
  const row = await db
    .prepare(
      `INSERT INTO tasks (shop_id, customer_id, conversation_id, assigned_to, type, title, due_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(shopId, t.customerId, t.conversationId ?? null, t.assignedTo ?? null, t.type in TASK_TYPES ? t.type : "other", t.title, t.dueAt, t.createdBy, now())
    .first<{ id: number }>();
  return row!.id;
}

export type TaskRow = Task & { customer_name: string | null; assignee: string | null };

export async function listTasks(db: D1Database, shopId: number, f: { customerId?: number; open?: boolean; mine?: number; limit?: number }) {
  const where = ["t.shop_id = ?"];
  const binds: unknown[] = [shopId];
  if (f.customerId) {
    where.push("t.customer_id = ?");
    binds.push(f.customerId);
  }
  if (f.open !== undefined) where.push(f.open ? "t.done_at IS NULL" : "t.done_at IS NOT NULL");
  if (f.mine) {
    where.push("t.assigned_to = ?");
    binds.push(f.mine);
  }
  const { results } = await db
    .prepare(
      `SELECT t.*, c.name AS customer_name, u.name AS assignee FROM tasks t
       LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.assigned_to
       WHERE ${where.join(" AND ")}
       ORDER BY t.done_at IS NOT NULL, t.due_at IS NULL, t.due_at, t.created_at DESC LIMIT ?`,
    )
    .bind(...binds, f.limit ?? 200)
    .all<TaskRow>();
  return results;
}

// ---------- manual orders (DM sales) ----------

export interface NewOrderItem {
  productId: number;
  size: string;
  color: string;
  qty: number;
}

/**
 * Create an order for a customer from product variants: prices come from the variant (sale price,
 * then variant price, then the product price), tracked stock is reduced, and the order gets the
 * shop's next running number. Returns the order id, or an error message.
 */
export async function createCrmOrder(
  db: D1Database,
  shopId: number,
  customerId: number,
  items: NewOrderItem[],
  o: { discount: number; shipping: number; method: string; note: string; paid: boolean; userId: number | null },
): Promise<{ id: number; number: number } | { error: string }> {
  if (!items.length) return { error: "حداقل یک محصول اضافه کنید." };
  const priced: (NewOrderItem & { title: string; price: number; track: number; stock: number | null })[] = [];
  for (const it of items) {
    const p = await db
      .prepare(
        `SELECT p.title, p.price, p.track_stock, s.price AS vprice, s.sale_price, s.quantity
         FROM products p LEFT JOIN product_stock s ON s.product_id = p.id AND s.size = ?2 AND s.color = ?3
         WHERE p.id = ?1 AND p.shop_id = ?4`,
      )
      .bind(it.productId, it.size, it.color, shopId)
      .first<{ title: string; price: number; track_stock: number; vprice: number | null; sale_price: number | null; quantity: number | null }>();
    if (!p) return { error: "محصول پیدا نشد." };
    if (p.track_stock && (p.quantity ?? 0) < it.qty) return { error: `موجودی «${p.title}» کافی نیست (${(p.quantity ?? 0).toLocaleString("fa-IR")} عدد).` };
    priced.push({ ...it, title: p.title, price: p.sale_price ?? p.vprice ?? p.price, track: p.track_stock, stock: p.quantity });
  }
  const subtotal = priced.reduce((s, i) => s + i.price * i.qty, 0);
  const total = Math.max(0, subtotal - o.discount + o.shipping);
  const t = now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const order = await db
        .prepare(
          `INSERT INTO crm_orders (shop_id, customer_id, number, status, payment_status, payment_method, discount, shipping_cost, total, note, created_by, created_at, updated_at)
           VALUES (?1, ?2, (SELECT COALESCE(MAX(number), 1000) + 1 FROM crm_orders WHERE shop_id = ?1), 'new', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
           RETURNING id, number`,
        )
        .bind(shopId, customerId, o.paid ? "paid" : "unpaid", o.method, o.discount, o.shipping, total, o.note, o.userId, t)
        .first<{ id: number; number: number }>();
      const stmts: D1PreparedStatement[] = [];
      for (const i of priced) {
        stmts.push(
          db
            .prepare("INSERT INTO crm_order_items (order_id, product_id, size, color, title, qty, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(order!.id, i.productId, i.size, i.color, i.title, i.qty, i.price),
        );
        if (i.track) {
          stmts.push(
            db.prepare("UPDATE product_stock SET quantity = MAX(quantity - ?, 0) WHERE product_id = ? AND size = ? AND color = ?").bind(i.qty, i.productId, i.size, i.color),
          );
        }
        stmts.push(
          db
            .prepare(
              `INSERT INTO product_interests (shop_id, customer_id, product_id, source, created_at) VALUES (?, ?, ?, 'order', ?)
               ON CONFLICT (customer_id, product_id, source) DO NOTHING`,
            )
            .bind(shopId, customerId, i.productId, t),
        );
      }
      await db.batch(stmts);
      await refreshCustomerStats(db, shopId, customerId);
      await logActivity(db, shopId, o.userId, "create", "order", order!.id, `#${order!.number} — ${total}`);
      return order!;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e; // two orders took the same number at once: try again
    }
  }
  return { error: "ثبت سفارش ناموفق بود؛ دوباره تلاش کنید." };
}

export async function orderItems(db: D1Database, orderId: number) {
  const { results } = await db.prepare("SELECT * FROM crm_order_items WHERE order_id = ? ORDER BY id").bind(orderId).all<CrmOrderItem>();
  return results;
}

/** Canceling gives tracked stock back. */
export async function cancelCrmOrder(db: D1Database, shopId: number, orderId: number, userId: number | null) {
  const o = await db.prepare("SELECT * FROM crm_orders WHERE id = ? AND shop_id = ?").bind(orderId, shopId).first<CrmOrder>();
  if (!o || o.status === "canceled" || o.status === "shipped" || o.status === "delivered") return false;
  const items = await orderItems(db, orderId);
  await db.batch([
    db.prepare("UPDATE crm_orders SET status = 'canceled', updated_at = ? WHERE id = ?").bind(now(), orderId),
    ...items.map((i) =>
      db
        .prepare(
          `UPDATE product_stock SET quantity = quantity + ?1 WHERE product_id = ?2 AND size = ?3 AND color = ?4
           AND (SELECT track_stock FROM products WHERE id = ?2) = 1`,
        )
        .bind(i.qty, i.product_id, i.size, i.color),
    ),
  ]);
  await refreshCustomerStats(db, shopId, o.customer_id);
  await logActivity(db, shopId, userId, "update", "order", orderId, { status: [o.status, "canceled"] });
  return true;
}

/** A gift bought on the site: the buyer becomes (or stays) a customer of the shop, with fresh stats. */
export async function syncGiftBuyer(db: D1Database, o: { shop_id: number; product_id: number; giver_phone: string; giver_name: string }) {
  if (!o.giver_phone) return;
  const customerId = await customerForPhone(db, o.shop_id, o.giver_phone, o.giver_name, "site");
  await addInterest(db, o.shop_id, customerId, o.product_id, "order");
  await refreshCustomerStats(db, o.shop_id, customerId);
}
