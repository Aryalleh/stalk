import { Hono } from "hono";
import { render } from "../../render";
import { cardNumberError, normalizeDigits, normalizePhone } from "../../../lib/normalize";
import { adjustStock, availableByVariant, normCity, now, productImages, productPackages, productStock, randomSlug, type Order, type Product, type Shop } from "../db";
import { sizeNames } from "../sizes";
import { developerHref, faqs } from "../../content";
import { colorList, pickVariant, variantKey, variants, type Variant } from "../variants";
import type { C, Env } from "../../env";
import { SOCIAL_KEYS, categoryList, loadSettings, saveSettings as saveSiteSettings, webhookSecret, igVerifyToken, type Settings } from "../../settings";
import { fileField, imageError, storeImage } from "../images";
import { sendSafirText } from "../../bale/safir";
import { botToken, botUsername, connectBot, notifyAdmins, sendToChats, type BotKind } from "../../bale/botapi";
import { answerChange, cancelForStock, confirmOrder, rejectOrder, requestChange, shopOwnerChats, type Deps } from "../orders";
import { parseSizeGuide } from "../sizes";
import { AdminContentPage, AdminPage, AdminSettingsPage, AdminUsersPage, type AdminUserRow, DashboardPage, ORDER_FILTERS, OrderDetailPage, OrdersPage, type PanelOrder, ProductFormPage, ProductsPage, SettingsPage, ShopRegisterPage, type VariantInfo } from "../views/panel";
import { currentUser, form, intParam, siteUrl } from "./helpers";
import { startImpersonation } from "../../impersonate";
import { postProductToChannel, shareError } from "../telegram/share";
import { InstagramSettings, TelegramSettings } from "../crm/views";
import { miniAppLink } from "../telegram/channel";
import { upcomingMonthDays } from "../../../lib/people";
import { crmPanel } from "../crm/routes";

export const panel = new Hono<Env>();

/** The shop this person works in: as its owner (admin) or as an agent added by the owner. */
const myShop = (c: C) => {
  const u = currentUser(c);
  return u.shop_id
    ? c.env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(u.shop_id).first<Shop>()
    : c.env.DB.prepare("SELECT * FROM shops WHERE owner_id = ?").bind(u.id).first<Shop>();
};

panel.get("/panel/register", async (c) => {
  if (await myShop(c)) return c.redirect("/panel");
  return render(c, <ShopRegisterPage user={currentUser(c)} />);
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
  const city = normCity(f.city ?? "");
  if (!city) errors.push("شهر فروشگاه را انتخاب کنید.");
  if (errors.length) return render(c, <ShopRegisterPage user={currentUser(c)} values={f} errors={errors} />, 400);
  const user = currentUser(c);
  try {
    const shop = await c.env.DB.prepare("INSERT INTO shops (owner_id, name, slug, description, phone, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(user.id, f.name, slug, f.description ?? "", phone, city, now())
      .first<{ id: number }>();
    await c.env.DB.prepare("UPDATE users SET shop_id = ?, shop_role = 'admin' WHERE id = ?").bind(shop!.id, user.id).run();
  } catch {
    return render(c, <ShopRegisterPage user={user} values={f} errors={["این آدرس صفحه قبلاً گرفته شده است."]} />, 400);
  }
  // Tell the platform admins so they can contact the shop and approve it.
  c.executionCtx.waitUntil(
    notifyAdmins(
      c.env.DB,
      c.get("settings"),
      [
        "🏪 فروشگاه جدید ثبت شد — برای تأیید با آن تماس بگیرید",
        `فروشگاه: ${f.name} (${city})`,
        `صاحب فروشگاه: ${user.name} — ${user.phone}`,
        `تلفن فروشگاه: ${phone}`,
        f.description ? `توضیح: ${f.description.slice(0, 300)}` : "",
        `تأیید در: ${siteUrl(c)}/admin`,
      ].filter(Boolean).join("\n"),
    ),
  );
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
// The CRM screens (inbox, customers, tasks, direct sales, automation, team); its admin-only guards
// must run before the settings routes below.
panel.route("/", crmPanel);
const shopOf = (c: C) => c.get("shop");

const FILTER_STATUSES: Record<string, string> = {
  awaiting: "('awaiting')",
  todo: "('paid')",
  shipped: "('shipped', 'delivered')",
  rejected: "('rejected')",
};

const PANEL_ORDER = "SELECT o.*, COALESCE(p.image_key, '') AS image_key FROM orders o LEFT JOIN products p ON p.id = o.product_id";

/** Start of today in Iran (UTC+3:30, no DST since 2022) as an ISO timestamp. */
function startOfTodayIran() {
  const offset = 3.5 * 3600_000;
  const local = new Date(Date.now() + offset);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset).toISOString();
}

panel.get("/panel", async (c) => {
  const shop = shopOf(c);
  // Old links (bot messages) used /panel?f=...
  if (c.req.query("f")) return c.redirect(`/panel/orders?f=${encodeURIComponent(c.req.query("f")!)}`);
  const onlyAwaiting = c.req.query("only") === "awaiting";
  const db = c.env.DB;
  const [stats, orders] = await db.batch([
    db.prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE shop_id = ?1 AND status IN ('paid','shipped','delivered') AND paid_at >= ?2) AS today,
         (SELECT COUNT(*) FROM orders WHERE shop_id = ?1 AND status = 'awaiting') AS awaiting,
         (SELECT COUNT(*) FROM orders WHERE shop_id = ?1 AND status = 'paid') AS toShip,
         (SELECT COUNT(*) FROM orders WHERE shop_id = ?1 AND status IN ('paid','shipped','delivered')) AS sales,
         (SELECT COUNT(*) FROM products WHERE shop_id = ?1) AS products`,
    ).bind(shop.id, startOfTodayIran()),
    db.prepare(`${PANEL_ORDER} WHERE o.shop_id = ? AND o.status ${onlyAwaiting ? "= 'awaiting'" : "<> 'pending'"} ORDER BY o.reported_at DESC LIMIT 10`).bind(shop.id),
  ]);
  const user = currentUser(c);
  const days = upcomingMonthDays(14);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [crm, lowStock, birthdays, tasks] = await db.batch([
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM customers WHERE shop_id = ?1 AND stage = 'lead' AND created_at >= ?2) AS newLeads,
         (SELECT COUNT(*) FROM conversations WHERE shop_id = ?1 AND status = 'open') AS openConversations,
         (SELECT COALESCE(SUM(unread), 0) FROM conversations WHERE shop_id = ?1 AND status <> 'closed') AS unread,
         (SELECT COUNT(*) FROM tasks WHERE shop_id = ?1 AND done_at IS NULL AND due_at IS NOT NULL AND due_at <= ?3) AS tasksDue,
         (SELECT COALESCE(SUM(total), 0) FROM crm_orders WHERE shop_id = ?1 AND status <> 'canceled' AND created_at >= ?2) AS directRevenue,
         (SELECT COUNT(*) FROM customers WHERE shop_id = ?1) AS customers`,
    ).bind(shop.id, monthAgo, new Date(Date.now() + 86400_000).toISOString()),
    db.prepare(
      `SELECT p.id, p.title, s.size, s.color, s.quantity, s.min_stock FROM product_stock s JOIN products p ON p.id = s.product_id
       WHERE p.shop_id = ? AND p.track_stock = 1 AND s.quantity <= s.min_stock ORDER BY s.quantity, p.title LIMIT 8`,
    ).bind(shop.id),
    db.prepare(
      `SELECT id, name, username, birthday FROM customers WHERE shop_id = ? AND birthday <> '' AND substr(birthday, 6) IN (${days.map(() => "?").join(",")})
       ORDER BY substr(birthday, 6) LIMIT 8`,
    ).bind(shop.id, ...days),
    db.prepare(
      `SELECT t.*, cu.name AS customer_name FROM tasks t LEFT JOIN customers cu ON cu.id = t.customer_id
       WHERE t.shop_id = ? AND t.done_at IS NULL AND (t.assigned_to = ? OR t.assigned_to IS NULL) ORDER BY t.due_at IS NULL, t.due_at LIMIT 5`,
    ).bind(shop.id, user.id),
  ]);
  return render(
    c,
    <DashboardPage
      user={user}
      shop={shop}
      stats={stats.results[0] as never}
      crm={crm.results[0] as never}
      lowStock={lowStock.results as never}
      birthdays={birthdays.results as never}
      tasks={tasks.results as never}
      orders={orders.results as PanelOrder[]}
      onlyAwaiting={onlyAwaiting}
    />,
  );
});

panel.get("/panel/orders", async (c) => {
  const shop = shopOf(c);
  const { results: countRows } = await c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders WHERE shop_id = ? GROUP BY status")
    .bind(shop.id)
    .all<{ status: string; n: number }>();
  const byStatus = Object.fromEntries(countRows.map((r) => [r.status, r.n]));
  const counts = { awaiting: byStatus.awaiting ?? 0, todo: byStatus.paid ?? 0 };
  // Default to whatever needs action first.
  const filter = c.req.query("f") ?? (counts.awaiting ? "awaiting" : "todo");
  const statuses = FILTER_STATUSES[filter] ?? FILTER_STATUSES.todo;
  const { results } = await c.env.DB.prepare(`${PANEL_ORDER} WHERE o.shop_id = ? AND o.status IN ${statuses} ORDER BY o.reported_at DESC LIMIT 200`)
    .bind(shop.id)
    .all<PanelOrder>();
  return render(c, <OrdersPage user={currentUser(c)} shop={shop} orders={results} filter={ORDER_FILTERS.some(([f]) => f === filter) ? filter : "todo"} counts={counts} />);
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
  canceled: "سفارش به‌علت ناموجودی لغو شد، کالا «ناموجود» شد و به خریدار و گیرنده خبر داده شد.",
  change: "پیشنهاد تغییر برای گیرنده فرستاده شد؛ پاسخش در بات و همین صفحه می‌آید.",
};

panel.get("/panel/orders/:id{[0-9]+}", async (c) => {
  const order = await shopOrder(c);
  if (!order) return c.notFound();
  const product = await c.env.DB.prepare("SELECT id, track_stock, size_guide, colors FROM products WHERE id = ?")
    .bind(order.product_id)
    .first<Pick<Product, "id" | "track_stock" | "size_guide" | "colors">>();
  const options: Variant[] = product ? variants(product).filter((v) => v.label) : [];
  const available = product ? await availableByVariant(c.env.DB, product) : null;
  return render(
    c,
    <OrderDetailPage user={currentUser(c)} shop={shopOf(c)} order={order} variants={options} available={available} saved={SAVED_MESSAGES[c.req.query("done") ?? ""]} />,
  );
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

const deps = (c: C): Deps => ({ db: c.env.DB, images: c.env.IMAGES, settings: c.get("settings"), siteUrl: siteUrl(c) });

panel.post("/panel/orders/:id{[0-9]+}/confirm", async (c) => {
  const id = intParam(c, "id");
  await confirmOrder(deps(c), id, shopOf(c).id);
  return c.redirect(`/panel/orders/${id}?done=confirmed`);
});

panel.post("/panel/orders/:id{[0-9]+}/reject", async (c) => {
  const id = intParam(c, "id");
  const reason = ((await form(c)).reason ?? "").slice(0, 200);
  await rejectOrder(deps(c), id, shopOf(c).id, reason);
  return c.redirect(`/panel/orders/${id}?done=rejected`);
});

// Out of stock: cancel (with how the money was / will be returned), or propose another size/color.
panel.post("/panel/orders/:id{[0-9]+}/cancel-stock", async (c) => {
  const id = intParam(c, "id");
  const f = await form(c);
  await cancelForStock(deps(c), id, shopOf(c).id, (f.reason ?? "").slice(0, 200), (f.refund_note ?? "").slice(0, 200));
  return c.redirect(`/panel/orders/${id}?done=canceled`);
});

panel.post("/panel/orders/:id{[0-9]+}/change", async (c) => {
  const id = intParam(c, "id");
  const f = await form(c);
  const message = (f.message ?? "").slice(0, 300);
  const order = await shopOrder(c);
  const product = order ? await c.env.DB.prepare("SELECT size_guide, colors FROM products WHERE id = ?").bind(order.product_id).first<Pick<Product, "size_guide" | "colors">>() : null;
  const v = product && f.variant ? pickVariant(product, f.variant) : null;
  if (!message && !v) return c.redirect(`/panel/orders/${id}`);
  await requestChange(deps(c), id, shopOf(c).id, message, v?.size ?? "", v?.color ?? "");
  return c.redirect(`/panel/orders/${id}?done=change`);
});

panel.post("/panel/orders/:id{[0-9]+}/refund", async (c) => {
  const order = await shopOrder(c);
  if (!order || order.status !== "rejected" || !order.paid_at) return c.notFound();
  await c.env.DB.prepare("UPDATE orders SET refund_note = ? WHERE id = ?").bind(((await form(c)).refund_note ?? "").slice(0, 200), order.id).run();
  return c.redirect(`/panel/orders/${order.id}?done=saved`);
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
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COALESCE(SUM(quantity), 0) FROM product_stock s WHERE s.product_id = p.id) AS stock_total,
            (p.size_guide <> '' OR p.colors <> '') AS has_sizes
     FROM products p WHERE p.shop_id = ? ORDER BY p.created_at DESC`,
  )
    .bind(shopOf(c).id)
    .all<Product & { stock_total: number; has_sizes: number }>();
  return render(c, <ProductsPage user={currentUser(c)} shop={shopOf(c)} products={results} tgOk={c.req.query("tg_ok")} tgError={c.req.query("tg_error")} />);
});

// Quick +/- from the products list (products without sizes).
panel.post("/panel/products/:id{[0-9]+}/stock", async (c) => {
  const p = await ownProduct(c);
  if (!p) return c.notFound();
  const delta = Math.max(-1000, Math.min(1000, Math.trunc(Number((await form(c)).delta) || 0)));
  if (delta) {
    await c.env.DB.prepare("UPDATE products SET track_stock = 1 WHERE id = ?").bind(p.id).run();
    await adjustStock(c.env.DB, p.id, "", "", delta);
  }
  return c.redirect("/panel/products");
});

// Post a product to the shop's connected Telegram channel (photo, price, buy / wishlist buttons).
panel.post("/panel/products/:id{[0-9]+}/telegram", async (c) => {
  const p = await ownProduct(c);
  if (!p) return c.notFound();
  const back = (await form(c)).back === "form" ? `/panel/products/${p.id}` : "/panel/products";
  const shop = shopOf(c);
  if (!shop.tg_channel_id) return c.redirect(`${back}?tg_error=${encodeURIComponent("اول کانال تلگرام را در تنظیمات وصل کنید.")}`);
  try {
    await postProductToChannel({ db: c.env.DB, images: c.env.IMAGES, settings: c.get("settings"), siteUrl: siteUrl(c) }, shop, p);
  } catch (e) {
    return c.redirect(`${back}?tg_error=${encodeURIComponent(shareError(e))}`);
  }
  return c.redirect(`${back}?tg_ok=${encodeURIComponent(`«${p.title}» در کانال پست شد.`)}`);
});

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_IMAGES = 8;
const MAX_PACKAGES = 10;
const VIDEO_URL = /^https:\/\/(www\.)?(instagram\.com|t\.me|telegram\.me|ble\.ir)\/\S+$/i;

async function variantInfo(db: D1Database, productId: number) {
  const { results } = await db
    .prepare("SELECT size, color, sku, price, sale_price, min_stock FROM product_stock WHERE product_id = ?")
    .bind(productId)
    .all<VariantInfo & { size: string; color: string }>();
  return Object.fromEntries(results.map((r) => [variantKey(r.size, r.color), r])) as Record<string, VariantInfo>;
}

async function productFormPage(c: C, product: Product | null, values: Record<string, string>, errors?: string[], status: 200 | 400 = 200) {
  const [images, packages, stock, info] = product
    ? await Promise.all([productImages(c.env.DB, product.id), productPackages(c.env.DB, product.id), productStock(c.env.DB, product.id), variantInfo(c.env.DB, product.id)])
    : [[], [], {}, {}];
  return render(c, <ProductFormPage user={currentUser(c)} shop={shopOf(c)} product={product} values={values} images={images} packages={packages} stock={stock} variantInfo={info} categories={categoryList(c.get("settings"))} errors={errors} />, status);
}

async function saveProduct(c: C, product: Product | null) {
  const shop = shopOf(c);
  const body = await c.req.parseBody({ all: true });
  const str = (k: string) => {
    const v = body[k];
    return (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? (v[0] as string) : "").trim();
  };
  const list = (k: string) => {
    const v = body[k];
    return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x) => typeof x === "string") as string[];
  };
  const values: Record<string, string> = {
    title: str("title"),
    description: str("description"),
    price: normalizeDigits(str("price")).replace(/[,٬]/g, ""),
    video_url: str("video_url"),
    size_guide: str("size_guide"),
    category: str("category").slice(0, 40),
    colors: colorList(str("colors")).join("\n"),
    track_stock: str("track_stock") === "1" ? "1" : "0",
    features: str("features").split("\n").map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 8).join("\n"),
    is_active: str("is_active") === "1" ? "1" : "0",
  };
  const errors: string[] = [];
  if (!values.title) errors.push("عنوان لازم است.");
  const price = Number(values.price);
  if (!Number.isInteger(price) || price < 1000) errors.push("قیمت باید عدد صحیح و حداقل ۱۰۰۰ تومان باشد.");
  if (values.category && !categoryList(c.get("settings")).includes(values.category) && values.category !== product?.category) errors.push("دسته‌بندی نامعتبر است.");
  if (values.video_url && !VIDEO_URL.test(values.video_url)) errors.push("لینک ویدیو باید لینک پست اینستاگرام، تلگرام یا بله باشد (با https).");
  const parsedGuide = parseSizeGuide(values.size_guide);
  if ("error" in parsedGuide) errors.push(parsedGuide.error);
  const sizeGuide = "guide" in parsedGuide && parsedGuide.guide ? JSON.stringify(parsedGuide.guide) : "";
  // Stock: one number per variant (stock_key_N = "size|color", stock_N = quantity). Variants added
  // since the form was drawn (new sizes or colors) start at 0 and are listed again after saving.
  const stockRows: ({ size: string; color: string; quantity: number } & VariantInfo)[] = [];
  const stockValue = (raw: string, label: string) => {
    const n = Number(normalizeDigits(raw).replace(/[,٬]/g, "") || "0");
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) errors.push(`موجودی ${label || "محصول"} باید عدد صحیح و مثبت باشد.`);
    return Math.max(0, Math.trunc(n) || 0);
  };
  const optPrice = (raw: string, label: string) => {
    const t = normalizeDigits(raw).replace(/[,٬]/g, "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1000 || n > 1_000_000_000) {
      errors.push(`قیمت ${label || "محصول"} باید عدد صحیح (تومان) باشد.`);
      return null;
    }
    return n;
  };
  const typed: Record<string, number> = {};
  for (let n = 0; n < 400; n++) if (body[`stock_key_${n}`] !== undefined) typed[str(`stock_key_${n}`)] = n;
  for (const v of variants({ size_guide: sizeGuide, colors: values.colors })) {
    const n = typed[v.key];
    const field = (k: string) => (n === undefined ? "" : str(`${k}_${n}`));
    stockRows.push({
      size: v.size,
      color: v.color,
      quantity: stockValue(field("stock") || "0", v.label),
      min_stock: stockValue(field("min") || "0", v.label),
      sku: field("sku").slice(0, 40),
      price: optPrice(field("vprice"), v.label),
      sale_price: optPrice(field("sale"), v.label),
    });
  }
  const chartFile = body.size_guide_image instanceof File && body.size_guide_image.size > 0 ? body.size_guide_image : null;
  if (chartFile && !IMAGE_TYPES[chartFile.type]) errors.push("عکس راهنمای سایز باید JPG، PNG یا WebP باشد.");
  else if (chartFile && chartFile.size > MAX_IMAGE) errors.push("حجم عکس راهنمای سایز بیشتر از ۳ مگابایت است.");

  // Packages: rows pkg_id_N / pkg_name_N / pkg_price_N; an empty name deletes the row.
  const packages: { id: number | null; name: string; price: number }[] = [];
  for (let n = 0; n < MAX_PACKAGES + 5; n++) {
    const name = str(`pkg_name_${n}`).slice(0, 60);
    const id = Number(str(`pkg_id_${n}`)) || null;
    if (!name) continue;
    const p = Number(normalizeDigits(str(`pkg_price_${n}`)).replace(/[,٬]/g, "") || "0");
    if (!Number.isInteger(p) || p < 0) errors.push(`قیمت بسته‌بندی «${name}» نامعتبر است.`);
    packages.push({ id, name, price: p });
  }
  if (packages.length > MAX_PACKAGES) errors.push(`حداکثر ${MAX_PACKAGES} بسته‌بندی.`);

  const existing = product ? await productImages(c.env.DB, product.id) : [];
  const removeIds = new Set(list("delete_image").map(Number));
  const files = (Array.isArray(body.images) ? body.images : [body.images]).filter((f): f is File => f instanceof File && f.size > 0);
  const kept = existing.filter((img) => !removeIds.has(img.id));
  if (kept.length + files.length > MAX_IMAGES) errors.push(`حداکثر ${MAX_IMAGES} عکس برای هر محصول.`);
  for (const f of files) {
    if (!IMAGE_TYPES[f.type]) errors.push(`فرمت «${f.name}» باید JPG، PNG یا WebP باشد.`);
    else if (f.size > MAX_IMAGE) errors.push(`حجم «${f.name}» بیشتر از ۳ مگابایت است.`);
  }
  if (errors.length) return productFormPage(c, product, values, errors, 400);

  const newKeys: string[] = [];
  for (const f of files) {
    const key = `p/${shop.id}/${randomSlug(16)}.${IMAGE_TYPES[f.type]}`;
    await c.env.IMAGES.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
    newKeys.push(key);
  }
  const cover = kept[0]?.image_key ?? newKeys[0] ?? "";
  let chartKey = str("remove_size_guide_image") === "1" ? "" : product?.size_guide_image ?? "";
  if (chartFile) {
    chartKey = `p/${shop.id}/${randomSlug(16)}.${IMAGE_TYPES[chartFile.type]}`;
    await c.env.IMAGES.put(chartKey, await chartFile.arrayBuffer(), { httpMetadata: { contentType: chartFile.type } });
  }
  const t = now();
  const db = c.env.DB;
  let productId = product?.id ?? 0;
  if (product) {
    await db.prepare(
      "UPDATE products SET title = ?, description = ?, price = ?, video_url = ?, image_key = ?, size_guide = ?, size_guide_image = ?, category = ?, features = ?, colors = ?, track_stock = ?, is_active = ?, updated_at = ? WHERE id = ?",
    )
      .bind(values.title, values.description, price, values.video_url, cover, sizeGuide, chartKey, values.category, values.features, values.colors, Number(values.track_stock), Number(values.is_active), t, product.id)
      .run();
  } else {
    const row = await db.prepare(
      "INSERT INTO products (shop_id, title, description, price, video_url, image_key, size_guide, size_guide_image, category, features, colors, track_stock, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(shop.id, values.title, values.description, price, values.video_url, cover, sizeGuide, chartKey, values.category, values.features, values.colors, Number(values.track_stock), Number(values.is_active), t, t)
      .first<{ id: number }>();
    productId = row!.id;
  }
  const stmts: D1PreparedStatement[] = [];
  for (const img of existing.filter((i) => removeIds.has(i.id))) stmts.push(db.prepare("DELETE FROM product_images WHERE id = ? AND product_id = ?").bind(img.id, productId));
  newKeys.forEach((key, n) => stmts.push(db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, ?)").bind(productId, key, kept.length + n)));
  // Replace the variant rows with the sizes × colors the product has now (quantity matters only
  // while stock is tracked; SKU and prices always do).
  stmts.push(db.prepare("DELETE FROM product_stock WHERE product_id = ?").bind(productId));
  for (const r of stockRows) {
    stmts.push(
      db
        .prepare("INSERT INTO product_stock (product_id, size, color, quantity, sku, price, sale_price, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(productId, r.size, r.color, r.quantity, r.sku, r.price, r.sale_price, r.min_stock),
    );
  }
  const keepPkgIds = packages.map((p) => p.id).filter(Boolean);
  stmts.push(
    db.prepare(`DELETE FROM product_packages WHERE product_id = ? ${keepPkgIds.length ? `AND id NOT IN (${keepPkgIds.map(() => "?").join(",")})` : ""}`).bind(productId, ...keepPkgIds),
  );
  packages.forEach((p, n) =>
    stmts.push(
      p.id
        ? db.prepare("UPDATE product_packages SET name = ?, price = ?, sort = ? WHERE id = ? AND product_id = ?").bind(p.name, p.price, n, p.id, productId)
        : db.prepare("INSERT INTO product_packages (product_id, name, price, sort) VALUES (?, ?, ?, ?)").bind(productId, p.name, p.price, n),
    ),
  );
  await db.batch(stmts);
  const removedKeys = existing.filter((i) => removeIds.has(i.id)).map((i) => i.image_key);
  if (product?.size_guide_image && product.size_guide_image !== chartKey) removedKeys.push(product.size_guide_image);
  if (removedKeys.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(removedKeys));
  return c.redirect(`/panel/products/${productId}?saved=1`);
}

panel.get("/panel/products/new", (c) => productFormPage(c, null, {}));
panel.post("/panel/products/new", (c) => saveProduct(c, null));

const ownProduct = (c: C) =>
  c.env.DB.prepare("SELECT * FROM products WHERE id = ? AND shop_id = ?").bind(intParam(c, "id"), shopOf(c).id).first<Product>();

panel.get("/panel/products/:id{[0-9]+}", async (c) => {
  const p = await ownProduct(c);
  if (!p) return c.notFound();
  const values = {
    title: p.title, description: p.description, price: String(p.price), video_url: p.video_url, size_guide: p.size_guide,
    category: p.category, features: p.features, colors: p.colors, track_stock: String(p.track_stock),
    is_active: String(p.is_active), saved: c.req.query("saved") ?? "",
    tg_ok: c.req.query("tg_ok") ?? "", tg_error: c.req.query("tg_error") ?? "",
  };
  return productFormPage(c, p, values);
});

panel.post("/panel/products/:id{[0-9]+}", async (c) => {
  const p = await ownProduct(c);
  if (!p) return c.notFound();
  return saveProduct(c, p);
});

// ---------- settings ----------

const HANDLE = /^[@\w.\-\/:?=&%]{0,200}$/;

async function saveSettings(c: C) {
  const body = await c.req.parseBody();
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") f[k] = v.trim();
  if (!f.name) return { error: "نام فروشگاه لازم است." };
  const card = normalizeDigits(f.card_number ?? "");
  const cardError = card ? cardNumberError(card) : null;
  if (cardError) return { error: cardError };
  if (card && !f.card_holder) return { error: "نام صاحب کارت را وارد کنید." };
  const city = normCity(f.city ?? "");
  if (!city) return { error: "شهر فروشگاه را انتخاب کنید." };
  const fee = (k: string) => Number(normalizeDigits(f[k] ?? "").replace(/[,٬]/g, "") || "0");
  const courierFee = fee("courier_fee");
  const postFee = fee("post_fee");
  if (![courierFee, postFee].every((n) => Number.isInteger(n) && n >= 0)) return { error: "هزینه ارسال باید عدد صحیح باشد." };
  const courier = f.courier_enabled === "1" ? 1 : 0;
  const post = f.post_enabled === "1" ? 1 : 0;
  if (!courier && !post) return { error: "حداقل یک روش ارسال (پیک یا پست) را فعال کنید." };
  const socials = ["instagram", "telegram", "bale", "website"].map((k) => (f[k] ?? "").trim());
  if (socials.some((v) => !HANDLE.test(v))) return { error: "لینک شبکه‌های اجتماعی نامعتبر است." };
  const shop = shopOf(c);
  const logo = fileField(body.logo);
  const cover = fileField(body.cover);
  const fileError = (logo && imageError(logo, 2, "لوگو")) || (cover && imageError(cover, 3, "عکس کاور"));
  if (fileError) return { error: fileError };
  let logoKey = f.remove_logo === "1" ? "" : shop.logo_key;
  let coverKey = f.remove_cover === "1" ? "" : shop.cover_key;
  if (logo) logoKey = await storeImage(c.env.IMAGES, logo, `s/${shop.id}`);
  if (cover) coverKey = await storeImage(c.env.IMAGES, cover, `s/${shop.id}`);
  const stale = [shop.logo_key, shop.cover_key].filter((k) => k && k !== logoKey && k !== coverKey);
  if (stale.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(stale));
  await c.env.DB.prepare(
    `UPDATE shops SET name = ?, phone = ?, description = ?, card_number = ?, card_holder = ?, city = ?,
       courier_enabled = ?, courier_fee = ?, post_enabled = ?, post_fee = ?, instagram = ?, telegram = ?, bale = ?, website = ?,
       logo_key = ?, cover_key = ?
     WHERE id = ?`,
  )
    .bind(f.name, normalizePhone(f.phone ?? ""), f.description ?? "", card, (f.card_holder ?? "").slice(0, 80), city,
      courier, courierFee, post, postFee, ...socials, logoKey, coverKey, shop.id)
    .run();
  return { error: "" };
}

const settingsView = async (c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) => {
  const shop = (await myShop(c))!;
  const tgImported = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE shop_id = ? AND tg_chat_id IS NOT NULL").bind(shop.id).first<{ n: number }>();
  return render(
    c,
    <SettingsPage user={currentUser(c)} shop={shop} {...extra}>
      <InstagramSettings
        shop={shop}
        webhookUrl={`${siteUrl(c)}/ig/webhook`}
        platformReady={!!c.get("settings").meta_app_secret}
        oauthReady={!!(c.get("settings").meta_app_secret && c.get("settings").ig_app_id)}
        redirectUri={`${siteUrl(c)}/panel/settings/instagram/callback`}
        ok={c.req.query("ig_ok")?.slice(0, 300)}
        error={c.req.query("ig_error")?.slice(0, 300)}
      />
      <TelegramSettings
        shop={shop}
        botUsername={botUsername(c.get("settings"), "telegram")}
        storeLink={miniAppLink(c.get("settings"), `s_${shop.slug}`)}
        imported={tgImported?.n ?? 0}
        ok={c.req.query("tg_ok")?.slice(0, 300)}
        error={c.req.query("tg_error")?.slice(0, 300)}
      />
    </SettingsPage>,
    status,
  );
};

panel.get("/panel/settings", (c) => settingsView(c));

panel.post("/panel/settings", async (c) => {
  const { error } = await saveSettings(c);
  return settingsView(c, error ? { error } : { ok: "ذخیره شد." }, error ? 400 : 200);
});

panel.post("/panel/settings/test", async (c) => {
  const { error } = await saveSettings(c);
  if (error) return settingsView(c, { error }, 400);
  const shop = (await myShop(c))!;
  const chats = await shopOwnerChats(c.env.DB, shop.id);
  const sendError = chats ? await sendToChats(c.get("settings"), chats, `✅ پیام آزمایشی برای فروشگاه «${shop.name}». سفارش‌ها و فیش‌ها اینجا می‌آیند.`) : "no connected chat";
  return settingsView(c, sendError ? { error: `ارسال ناموفق: ${sendError}` } : { ok: "پیام آزمایشی در بات ارسال شد." });
});

// ---------- platform admin ----------

export const admin = new Hono<Env>();

admin.use("/admin/*", async (c, next) => (currentUser(c).is_admin ? next() : c.text("دسترسی ندارید", 403)));
admin.use("/admin", async (c, next) => (currentUser(c).is_admin ? next() : c.text("دسترسی ندارید", 403)));

admin.get("/admin", async (c) => {
  const [shops, stats, kpi] = await c.env.DB.batch([
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
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM shops) AS shops,
         (SELECT COUNT(*) FROM shops WHERE status = 'pending') AS pendingShops,
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM customers) AS customers,
         (SELECT COUNT(*) FROM conversations WHERE status = 'open') AS openConversations,
         (SELECT COUNT(*) FROM shops WHERE ig_access_token <> '') AS instagramShops,
         (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE status IN ('paid', 'shipped', 'delivered')) AS giftGmv,
         (SELECT COALESCE(SUM(total), 0) FROM crm_orders WHERE status <> 'canceled') AS directGmv`,
    ),
  ]);
  return render(
    c,
    <AdminPage
      user={currentUser(c)}
      shops={shops.results as never}
      stats={stats.results as never}
      kpi={kpi.results[0] as never}
      featuredId={Number(c.get("settings").featured_shop_id) || 0}
    />,
  );
});

admin.post("/admin/shops/:id{[0-9]+}/status", async (c) => {
  const status = (await form(c)).status;
  const id = intParam(c, "id");
  if (status === "approved" || status === "suspended") {
    const shop = await c.env.DB.prepare("SELECT name, slug, status FROM shops WHERE id = ?").bind(id).first<Pick<Shop, "name" | "slug" | "status">>();
    await c.env.DB.prepare("UPDATE shops SET status = ? WHERE id = ?").bind(status, id).run();
    const chats = await shopOwnerChats(c.env.DB, id);
    if (shop && chats && shop.status !== status) {
      const text =
        status === "approved"
          ? `🎉 فروشگاه «${shop.name}» تأیید شد و محصولاتش در سایت نمایش داده می‌شود.\nصفحه فروشگاه: ${siteUrl(c)}/s/${shop.slug}`
          : `⚠️ فروشگاه «${shop.name}» معلق شد و فعلاً در سایت نمایش داده نمی‌شود. برای پیگیری با پشتیبانی تماس بگیرید.`;
      c.executionCtx.waitUntil(sendToChats(c.get("settings"), chats, text).catch((e) => console.error(e)));
    }
  }
  return c.redirect("/admin");
});

// "Shop of the week" banner on the home page (0 removes it).
admin.post("/admin/featured", async (c) => {
  const id = Number((await form(c)).shop_id) || 0;
  await saveSiteSettings(c.env.DB, { featured_shop_id: id ? String(id) : "" });
  return c.redirect("/admin");
});

// ---------- content: About page, FAQ, contact details, developer credit ----------

const MAX_FAQ = 30;

async function contentPage(c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) {
  const s = await loadSettings(c.env.DB);
  c.set("settings", s);
  return render(c, <AdminContentPage user={currentUser(c)} s={s} faq={faqs(s)} isDefaultFaq={!s.faq_items} {...extra} />, status);
}

// ---------- users: search, and sign in as one of them ----------

const USERS_PAGE = 30;

admin.get("/admin/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const where = q ? "WHERE u.name LIKE ?1 OR u.phone LIKE ?1 OR u.username LIKE ?1 OR s.name LIKE ?1" : "";
  const list = c.env.DB.prepare(
    `SELECT u.id, u.name, u.phone, u.username, u.is_admin, u.is_staff, u.created_at, u.bale_chat_id <> '' AS bale, u.telegram_chat_id <> '' AS telegram,
            s.name AS shop_name, s.slug AS shop_slug, u.shop_role
     FROM users u LEFT JOIN shops s ON s.id = u.shop_id OR s.owner_id = u.id
     ${where} GROUP BY u.id ORDER BY u.id DESC LIMIT ${USERS_PAGE + 1} OFFSET ${(page - 1) * USERS_PAGE}`,
  );
  const [users, recent] = await c.env.DB.batch([
    q ? list.bind(like) : list,
    c.env.DB.prepare(
      `SELECT i.started_at, i.ended_at, a.name AS admin_name, u.id AS user_id, u.name AS user_name, u.phone AS user_phone
       FROM impersonations i JOIN users a ON a.id = i.admin_id JOIN users u ON u.id = i.user_id ORDER BY i.id DESC LIMIT 15`,
    ),
  ]);
  const rows = users.results as AdminUserRow[];
  return render(
    c,
    <AdminUsersPage
      user={currentUser(c)}
      q={q}
      page={page}
      users={rows.slice(0, USERS_PAGE)}
      more={rows.length > USERS_PAGE}
      recent={recent.results as never}
      error={c.req.query("error") ?? ""}
    />,
  );
});

admin.post("/admin/users/:id{[0-9]+}/login-as", async (c) => {
  const error = await startImpersonation(c, currentUser(c), intParam(c, "id"));
  if (error) return c.redirect(`/admin/users?error=${encodeURIComponent(error)}`);
  return c.redirect("/me");
});

admin.get("/admin/content", (c) => contentPage(c));

admin.post("/admin/content", async (c) => {
  const f = await form(c);
  const one = (k: string, max: number) => (f[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const values: Partial<Settings> = {
    about_title: one("about_title", 120),
    about_body: (f.about_body ?? "").replace(/\r/g, "").trim().slice(0, 6000),
    developer_name: one("developer_name", 80),
    developer_link: one("developer_link", 200),
    contact_phone: one("contact_phone", 30),
    contact_address: one("contact_address", 200),
  };
  const email = one("contact_email", 100);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return contentPage(c, { error: "ایمیل نامعتبر است." }, 400);
  values.contact_email = email;
  if (values.developer_link && !developerHref(values.developer_link)) return contentPage(c, { error: "لینک توسعه‌دهنده باید آدرس سایت (https://…) یا آیدی تلگرام (@name) باشد." }, 400);
  for (const k of SOCIAL_KEYS) {
    const v = one(k, 200);
    if (v && !/^(@?[\w.-]{1,100}|https:\/\/[^\s"<>]{4,200})$/.test(v)) return contentPage(c, { error: "آیدی یا لینک شبکه‌های اجتماعی نامعتبر است." }, 400);
    values[k] = v;
  }
  // FAQ rows q_N / a_N; an empty question removes the row. "Reset" goes back to the built-in list.
  if (f.reset_faq === "1") values.faq_items = "";
  else {
    const rows: [string, string][] = [];
    for (let n = 0; n < MAX_FAQ + 5; n++) {
      const q = one(`q_${n}`, 200);
      const a = (f[`a_${n}`] ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);
      if (q && a) rows.push([q, a]);
      else if (q || a) return contentPage(c, { error: "هر سوال باید پاسخ داشته باشد (برای حذف، سوال و پاسخ را خالی کنید)." }, 400);
    }
    if (rows.length > MAX_FAQ) return contentPage(c, { error: `حداکثر ${MAX_FAQ} سوال.` }, 400);
    values.faq_items = rows.length ? JSON.stringify(rows) : "";
  }
  await saveSiteSettings(c.env.DB, values);
  return contentPage(c, { ok: "ذخیره شد. صفحه‌های «درباره» و «سوالات متداول» به‌روز شدند." });
});

// ---------- site settings (admin) ----------

async function settingsPage(c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) {
  const s = await loadSettings(c.env.DB);
  c.set("settings", s); // reflect just-saved values (e.g. site name) in the layout
  const linked = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM bale_links").first<{ n: number }>();
  return render(c, <AdminSettingsPage user={currentUser(c)} s={s} webhookBase={new URL(c.req.url).origin} linkedCount={linked?.n ?? 0} igVerifyToken={await igVerifyToken(c.env.DB, s)} igRedirect={`${(s.site_url || new URL(c.req.url).origin).replace(/\/$/, "")}/panel/settings/instagram/callback`} {...extra} />, status);
}

admin.get("/admin/settings", (c) => settingsPage(c));

/** Save the form; a blank token field keeps the current token. */
async function saveAdminSettings(c: C): Promise<string> {
  const f = await form(c);
  const current = c.get("settings");
  const siteUrl = (f.site_url ?? "").replace(/\/+$/, "");
  if (!f.site_name) return "نام سایت لازم است.";
  if (siteUrl && !/^https?:\/\/[^\s/]+$/.test(siteUrl)) return "آدرس سایت باید مثل https://example.com باشد (بدون مسیر).";
  const minutes = Math.floor(Number(normalizeDigits(f.reservation_minutes ?? "")));
  if (!(minutes >= 5 && minutes <= 1440)) return "مهلت واریز باید بین ۵ تا ۱۴۴۰ دقیقه باشد.";
  const values: Partial<Settings> = { site_name: f.site_name.slice(0, 40), site_url: siteUrl, reservation_minutes: String(minutes) };
  if (f.site_description !== undefined) values.site_description = f.site_description.replace(/\s+/g, " ").trim().slice(0, 300);
  if (f.ga_measurement_id !== undefined) {
    const ga = (f.ga_measurement_id ?? "").trim().toUpperCase();
    if (ga && !/^G-[A-Z0-9]{4,20}$/.test(ga)) return "شناسه Google Analytics باید مثل G-XXXXXXXXXX باشد.";
    const cf = (f.cf_analytics_token ?? "").trim().toLowerCase();
    if (cf && !/^[a-f0-9]{32}$/.test(cf)) return "توکن Cloudflare Web Analytics نامعتبر است (۳۲ کاراکتر).";
    Object.assign(values, { ga_measurement_id: ga, cf_analytics_token: cf });
  }
  if (f.brand_color !== undefined) {
    const color = f.brand_color.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) return "رنگ اصلی سایت باید مثل #3b82f6 باشد.";
    values.brand_color = color;
  }
  if (f.categories !== undefined) {
    const cats = [...new Set(f.categories.split(/\r?\n/).map((x) => x.trim().slice(0, 40)).filter(Boolean))];
    if (cats.length > 30) return "حداکثر ۳۰ دسته‌بندی.";
    values.categories = cats.join("\n");
  }
  for (const kind of ["bale", "telegram"] as const) {
    const token = (f[`${kind}_bot_token`] ?? "").trim();
    if (f[`${kind}_bot_remove`] === "1") {
      values[`${kind}_bot_token`] = "";
      values[`${kind}_bot_username`] = "";
    } else if (token) {
      if (!/^[\w:-]{20,200}$/.test(token)) return `توکن بات ${kind === "bale" ? "بله" : "تلگرام"} نامعتبر به نظر می‌رسد.`;
      if (token !== current[`${kind}_bot_token`]) {
        values[`${kind}_bot_token`] = token;
        values[`${kind}_bot_username`] = ""; // must reconnect
      }
    }
  }
  // Safir is the only way to log in, so it can be changed but never cleared.
  if (f.ig_app_id !== undefined) {
    const id = normalizeDigits(f.ig_app_id).trim();
    if (id && !/^\d{6,25}$/.test(id)) return "Instagram app ID باید فقط عدد باشد.";
    values.ig_app_id = id;
  }
  if (f.meta_app_secret) {
    if (!/^[0-9a-f]{16,64}$/i.test(f.meta_app_secret)) return "App secret متا نامعتبر به نظر می‌رسد.";
    values.meta_app_secret = f.meta_app_secret;
  }
  if (f.safir_api_key) {
    if (!/^[\w.:-]{10,300}$/.test(f.safir_api_key)) return "کلید سفیر نامعتبر به نظر می‌رسد.";
    values.safir_api_key = f.safir_api_key;
  }
  const botId = normalizeDigits(f.safir_bot_id ?? "");
  if (!/^\d{1,20}$/.test(botId)) return "شناسه عددی بازوی سفیر لازم است (ورود کاربران به آن وابسته است).";
  values.safir_bot_id = botId;
  await saveSiteSettings(c.env.DB, values);
  return "";
}

admin.post("/admin/settings/test-safir", async (c) => {
  const error = await saveAdminSettings(c);
  if (error) return settingsPage(c, { error }, 400);
  const s = await loadSettings(c.env.DB);
  try {
    await sendSafirText(s, currentUser(c).phone, `✅ پیام آزمایشی سفیر از ${s.site_name}`);
    return settingsPage(c, { ok: `پیام آزمایشی به ${currentUser(c).phone} در بله ارسال شد.` });
  } catch (e) {
    return settingsPage(c, { error: `ارسال ناموفق: ${(e as Error).message}` }, 400);
  }
});

admin.post("/admin/settings", async (c) => {
  const error = await saveAdminSettings(c);
  return settingsPage(c, error ? { error } : { ok: "ذخیره شد." }, error ? 400 : 200);
});

admin.post("/admin/settings/connect/:kind{bale|telegram}", async (c) => {
  const kind = c.req.param("kind") as BotKind;
  const error = await saveAdminSettings(c);
  if (error) return settingsPage(c, { error }, 400);
  const s = await loadSettings(c.env.DB);
  const token = botToken(s, kind);
  if (!token) return settingsPage(c, { error: "اول توکن را وارد و ذخیره کنید." }, 400);
  const base = (s.site_url || new URL(c.req.url).origin).replace(/\/$/, "");
  if (!base.startsWith("https://")) {
    return settingsPage(c, { error: "بات فقط به آدرس https وصل می‌شود؛ سایت را روی دامنه واقعی باز کنید یا «آدرس سایت» را تنظیم کنید." }, 400);
  }
  try {
    const username = await connectBot(kind, token, `${base}/bot/${kind}/${await webhookSecret(c.env.DB, s)}`, `${base}/app`, s.site_name);
    await saveSiteSettings(c.env.DB, { [`${kind}_bot_username`]: username });
    return settingsPage(c, { ok: `بات @${username} وصل شد. کاربران بعد از ثبت‌نام از صفحه «اتصال به بات» به آن وصل می‌شوند.` });
  } catch (e) {
    return settingsPage(c, { error: connectErrorMessage(String((e as Error).message), new URL(base).host, !!s.site_url) }, 400);
  }
});

/** Explain the usual bot-connect failures in Persian, naming the domain that was sent to Bale/Telegram. */
export function connectErrorMessage(raw: string, host: string, fromSetting: boolean) {
  const source = fromSetting ? "«آدرس سایت» در همین صفحه" : "آدرسی که این صفحه با آن باز شده";
  if (/resolve host|name resolution|bad webhook/i.test(raw)) {
    return (
      `اتصال ناموفق: سرور بله/تلگرام نتوانست دامنه ${host} را پیدا کند (این دامنه از ${source} آمده). ` +
      "اگر دامنه را تازه وصل کرده‌اید چند دقیقه صبر کنید و دوباره «اتصال» را بزنید؛ اگر اشتباه تایپ شده، «آدرس سایت» را اصلاح یا خالی کنید " +
      `(خالی = همان آدرس workers.dev). جزئیات: ${raw}`
    );
  }
  if (/unauthorized|401|404/i.test(raw)) return `اتصال ناموفق: توکن بات نامعتبر است؛ توکن را دوباره از BotFather بگیرید. جزئیات: ${raw}`;
  return `اتصال ناموفق: ${raw}`;
}
