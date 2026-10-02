import { Hono } from "hono";
import { safeEqual } from "../../../lib/auth";
import { cardNumberError, normalizeDigits, normalizePhone } from "../../../lib/normalize";
import { confirmPayment, now, randomSlug, rejectPayment, type Order, type Product, type Shop } from "../db";
import type { C, Env } from "../../env";
import { botToken, notifyShop, sendBotMessage, type BotKind } from "../notify";
import { sendShopMessage } from "./store";
import { AdminPage, ORDER_FILTERS, OrderDetailPage, OrdersPage, ProductFormPage, ProductsPage, SettingsPage, ShopRegisterPage } from "../views/panel";
import { currentUser, form, intParam } from "./helpers";

export const panel = new Hono<Env>();

const myShop = (c: C) => c.env.DB.prepare("SELECT * FROM shops WHERE owner_id = ?").bind(currentUser(c).id).first<Shop>();

panel.get("/panel/register", async (c) => {
  if (await myShop(c)) return c.redirect("/panel");
  return c.html(<ShopRegisterPage user={currentUser(c)} />);
});

panel.post("/panel/register", async (c) => {
  if (await myShop(c)) return c.redirect("/panel");
  const f = await form(c);
  const slug = (f.slug ?? "").toLowerCase();
  const phone = normalizePhone(f.phone ?? "");
  const errors: string[] = [];
  if (!f.name) errors.push("نام فروشگاه لازم است.");
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) errors.push("آدرس صفحه باید ۳ تا ۴۰ حرف انگلیسی کوچک، عدد یا - باشد.");
  if (!/^\+?\d{5,15}$/.test(phone)) errors.push("تلفن نامعتبر است.");
  if (errors.length) return c.html(<ShopRegisterPage user={currentUser(c)} values={f} errors={errors} />, 400);
  try {
    await c.env.DB.prepare("INSERT INTO shops (owner_id, name, slug, description, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(currentUser(c).id, f.name, slug, f.description ?? "", phone, now())
      .run();
  } catch {
    return c.html(<ShopRegisterPage user={currentUser(c)} values={f} errors={["این آدرس صفحه قبلاً گرفته شده است."]} />, 400);
  }
  return c.redirect("/panel");
});

// Everything below needs a shop.
const requireShop = async (c: C, next: () => Promise<void>) => {
  if (c.req.path === "/panel/register") return next();
  const shop = await myShop(c);
  if (!shop) return c.redirect("/panel/register");
  c.set("shop", shop);
  await next();
};
panel.use("/panel", requireShop);
panel.use("/panel/*", requireShop);
const shopOf = (c: C) => c.get("shop");

const FILTER_STATUSES: Record<string, string> = {
  awaiting: "('awaiting')",
  todo: "('paid')",
  shipped: "('shipped', 'delivered')",
  rejected: "('rejected')",
};

panel.get("/panel", async (c) => {
  const shop = shopOf(c);
  const { results: countRows } = await c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders WHERE shop_id = ? GROUP BY status")
    .bind(shop.id)
    .all<{ status: string; n: number }>();
  const byStatus = Object.fromEntries(countRows.map((r) => [r.status, r.n]));
  const counts = { awaiting: byStatus.awaiting ?? 0, todo: byStatus.paid ?? 0 };
  // Default to whatever needs action first.
  const filter = c.req.query("f") ?? (counts.awaiting ? "awaiting" : "todo");
  const statuses = FILTER_STATUSES[filter] ?? FILTER_STATUSES.todo;
  const { results } = await c.env.DB.prepare(`SELECT * FROM orders WHERE shop_id = ? AND status IN ${statuses} ORDER BY reported_at DESC LIMIT 200`)
    .bind(shop.id)
    .all<Order>();
  return c.html(<OrdersPage user={currentUser(c)} shop={shop} orders={results} filter={ORDER_FILTERS.some(([f]) => f === filter) ? filter : "todo"} counts={counts} />);
});

/** Orders the shop may see: anything the giver has reported a transfer for. */
async function shopOrder(c: C) {
  return c.env.DB.prepare("SELECT * FROM orders WHERE id = ? AND shop_id = ? AND status <> 'pending'")
    .bind(intParam(c, "id"), shopOf(c).id)
    .first<Order>();
}

const SAVED_MESSAGES: Record<string, string> = {
  confirmed: "واریز تأیید شد. آدرس گیرنده در همین صفحه است و پیام ارسال هم برایتان فرستاده شد.",
  rejected: "واریز رد شد و آرزو دوباره قابل خرید است.",
  saved: "ذخیره شد.",
};

panel.get("/panel/orders/:id{[0-9]+}", async (c) => {
  const order = await shopOrder(c);
  if (!order) return c.notFound();
  return c.html(<OrderDetailPage user={currentUser(c)} shop={shopOf(c)} order={order} saved={SAVED_MESSAGES[c.req.query("done") ?? ""]} />);
});

panel.get("/panel/orders/:id{[0-9]+}/receipt", async (c) => {
  const order = await shopOrder(c);
  if (!order?.receipt_key) return c.notFound();
  const obj = await c.env.IMAGES.get(order.receipt_key);
  if (!obj) return c.notFound();
  return c.body(obj.body, 200, {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
});

panel.post("/panel/orders/:id{[0-9]+}/confirm", async (c) => {
  const id = intParam(c, "id");
  if (await confirmPayment(c.env.DB, id, shopOf(c).id)) c.executionCtx.waitUntil(sendShopMessage(c, id, "ship"));
  return c.redirect(`/panel/orders/${id}?done=confirmed`);
});

panel.post("/panel/orders/:id{[0-9]+}/reject", async (c) => {
  const id = intParam(c, "id");
  const reason = ((await form(c)).reason ?? "").slice(0, 200);
  await rejectPayment(c.env.DB, id, shopOf(c).id, reason);
  return c.redirect(`/panel/orders/${id}?done=rejected`);
});

panel.post("/panel/orders/:id{[0-9]+}/ship", async (c) => {
  const order = await shopOrder(c);
  if (!order || (order.status !== "paid" && order.status !== "shipped")) return c.notFound();
  const tracking = ((await form(c)).tracking_code ?? "").slice(0, 60);
  await c.env.DB.prepare("UPDATE orders SET status = 'shipped', tracking_code = ?, shipped_at = COALESCE(shipped_at, ?) WHERE id = ?")
    .bind(tracking, now(), order.id)
    .run();
  return c.redirect(`/panel/orders/${order.id}?done=saved`);
});

panel.post("/panel/orders/:id{[0-9]+}/delivered", async (c) => {
  const order = await shopOrder(c);
  if (!order || order.status !== "shipped") return c.notFound();
  await c.env.DB.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").bind(order.id).run();
  return c.redirect(`/panel/orders/${order.id}?done=saved`);
});

// ---------- products ----------

panel.get("/panel/products", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM products WHERE shop_id = ? ORDER BY created_at DESC").bind(shopOf(c).id).all<Product>();
  return c.html(<ProductsPage user={currentUser(c)} shop={shopOf(c)} products={results} />);
});

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE = 2 * 1024 * 1024;

async function saveProduct(c: C, product: Product | null) {
  const shop = shopOf(c);
  const body = await c.req.parseBody();
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const values = { title: str("title"), description: str("description"), price: normalizeDigits(str("price")).replace(/[,٬]/g, ""), is_active: str("is_active") === "1" ? "1" : "0" };
  const errors: string[] = [];
  if (!values.title) errors.push("عنوان لازم است.");
  const price = Number(values.price);
  if (!Number.isInteger(price) || price < 1000) errors.push("قیمت باید عدد صحیح و حداقل ۱۰۰۰ تومان باشد.");
  const file = body.image;
  let imageKey = product?.image_key ?? "";
  if (file instanceof File && file.size > 0) {
    const ext = IMAGE_TYPES[file.type];
    if (!ext) errors.push("فرمت تصویر باید JPG، PNG یا WebP باشد.");
    else if (file.size > MAX_IMAGE) errors.push("حجم تصویر حداکثر ۲ مگابایت است.");
    else {
      imageKey = `p/${shop.id}/${randomSlug(16)}.${ext}`;
      await c.env.IMAGES.put(imageKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    }
  }
  if (errors.length) return c.html(<ProductFormPage user={currentUser(c)} shop={shop} product={product} values={values} errors={errors} />, 400);

  const t = now();
  if (product) {
    await c.env.DB.prepare("UPDATE products SET title = ?, description = ?, price = ?, image_key = ?, is_active = ?, updated_at = ? WHERE id = ?")
      .bind(values.title, values.description, price, imageKey, Number(values.is_active), t, product.id)
      .run();
    if (product.image_key && product.image_key !== imageKey) c.executionCtx.waitUntil(c.env.IMAGES.delete(product.image_key));
  } else {
    await c.env.DB.prepare("INSERT INTO products (shop_id, title, description, price, image_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(shop.id, values.title, values.description, price, imageKey, Number(values.is_active), t, t)
      .run();
  }
  return c.redirect("/panel/products");
}

panel.get("/panel/products/new", (c) => c.html(<ProductFormPage user={currentUser(c)} shop={shopOf(c)} product={null} values={{}} />));
panel.post("/panel/products/new", (c) => saveProduct(c, null));

const ownProduct = (c: C) =>
  c.env.DB.prepare("SELECT * FROM products WHERE id = ? AND shop_id = ?").bind(intParam(c, "id"), shopOf(c).id).first<Product>();

panel.get("/panel/products/:id{[0-9]+}", async (c) => {
  const p = await ownProduct(c);
  if (!p) return c.notFound();
  const values = { title: p.title, description: p.description, price: String(p.price), is_active: String(p.is_active) };
  return c.html(<ProductFormPage user={currentUser(c)} shop={shopOf(c)} product={p} values={values} />);
});

panel.post("/panel/products/:id{[0-9]+}", async (c) => {
  const p = await ownProduct(c);
  if (!p) return c.notFound();
  return saveProduct(c, p);
});

// ---------- settings ----------

const bots = (c: C) => ({ bale: !!c.env.BALE_BOT_TOKEN, telegram: !!c.env.TELEGRAM_BOT_TOKEN });

async function saveSettings(c: C) {
  const f = await form(c);
  const chat = (v: string | undefined) => (v ?? "").replace(/[^\d\-]/g, "").slice(0, 40);
  if (!f.name) return { error: "نام فروشگاه لازم است." };
  const card = normalizeDigits(f.card_number ?? "");
  const cardError = card ? cardNumberError(card) : null;
  if (cardError) return { error: cardError };
  if (card && !f.card_holder) return { error: "نام صاحب کارت را وارد کنید." };
  await c.env.DB.prepare(
    "UPDATE shops SET name = ?, phone = ?, description = ?, card_number = ?, card_holder = ?, bale_chat_id = ?, telegram_chat_id = ? WHERE id = ?",
  )
    .bind(f.name, normalizePhone(f.phone ?? ""), f.description ?? "", card, (f.card_holder ?? "").slice(0, 80), chat(f.bale_chat_id), chat(f.telegram_chat_id), shopOf(c).id)
    .run();
  return { error: "" };
}

panel.get("/panel/settings", (c) => c.html(<SettingsPage user={currentUser(c)} shop={shopOf(c)} bots={bots(c)} />));

panel.post("/panel/settings", async (c) => {
  const { error } = await saveSettings(c);
  const shop = (await myShop(c))!;
  return c.html(<SettingsPage user={currentUser(c)} shop={shop} bots={bots(c)} error={error} ok={error ? undefined : "ذخیره شد."} />, error ? 400 : 200);
});

panel.post("/panel/settings/test", async (c) => {
  const saved = await saveSettings(c);
  const shop = (await myShop(c))!;
  const error = saved.error || (await notifyShop(c.env, shop, `✅ پیام آزمایشی برای فروشگاه «${shop.name}». سفارش‌های کادویی جدید اینجا اعلام می‌شوند.`));
  return c.html(<SettingsPage user={currentUser(c)} shop={shop} bots={bots(c)} error={error ? `ارسال ناموفق: ${error}` : undefined} ok={error ? undefined : "پیام آزمایشی ارسال شد."} />);
});

// ---------- platform admin ----------

export const admin = new Hono<Env>();

admin.use("/admin/*", async (c, next) => (currentUser(c).is_admin ? next() : c.text("دسترسی ندارید", 403)));
admin.use("/admin", async (c, next) => (currentUser(c).is_admin ? next() : c.text("دسترسی ندارید", 403)));

admin.get("/admin", async (c) => {
  const [shops, stats] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT s.*, u.name AS owner_name, u.phone AS owner_phone, (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id) AS products
       FROM shops s JOIN users u ON u.id = s.owner_id ORDER BY (s.status = 'pending') DESC, s.created_at DESC`,
    ),
    c.env.DB.prepare(
      `SELECT s.id AS shop_id, s.name, COUNT(o.id) AS orders, COALESCE(SUM(o.amount), 0) AS total,
              SUM(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END) AS unsent
       FROM shops s JOIN orders o ON o.shop_id = s.id AND o.status IN ('paid', 'shipped', 'delivered')
       GROUP BY s.id ORDER BY total DESC`,
    ),
  ]);
  return c.html(<AdminPage user={currentUser(c)} shops={shops.results as never} stats={stats.results as never} />);
});

admin.post("/admin/shops/:id{[0-9]+}/status", async (c) => {
  const status = (await form(c)).status;
  if (status === "approved" || status === "suspended") {
    await c.env.DB.prepare("UPDATE shops SET status = ? WHERE id = ?").bind(status, intParam(c, "id")).run();
  }
  return c.redirect("/admin");
});

// ---------- bot webhook: replies with the chat id so shops can paste it into settings ----------
// Register with: https://tapi.bale.ai/bot<TOKEN>/setWebhook?url=<SITE_URL>/bot/bale/<BOT_WEBHOOK_SECRET>

export const bot = new Hono<Env>();

bot.post("/bot/:kind{bale|telegram}/:secret", async (c) => {
  const kind = c.req.param("kind") as BotKind;
  if (!c.env.BOT_WEBHOOK_SECRET || !safeEqual(c.req.param("secret"), c.env.BOT_WEBHOOK_SECRET) || !botToken(c.env, kind)) {
    return c.text("forbidden", 403);
  }
  const update = (await c.req.json().catch(() => null)) as { message?: { chat?: { id?: number } } } | null;
  const chatId = update?.message?.chat?.id;
  if (chatId !== undefined) {
    c.executionCtx.waitUntil(
      sendBotMessage(c.env, kind, String(chatId), `سلام! شناسه چت شما: ${chatId}\nاین عدد را در «پنل فروشگاه ← تنظیمات» وارد کنید تا سفارش‌های جدید اینجا اطلاع داده شود.`).catch(
        (e) => console.error(e),
      ),
    );
  }
  return c.json({ ok: true });
});
