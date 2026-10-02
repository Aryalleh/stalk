import { Hono } from "hono";
import { render } from "../../render";
import { cardNumberError, normalizeDigits, normalizePhone } from "../../../lib/normalize";
import { normCity, now, productImages, productPackages, randomSlug, type Order, type Product, type Shop } from "../db";
import type { C, Env } from "../../env";
import { categoryList, loadSettings, saveSettings as saveSiteSettings, webhookSecret, type Settings } from "../../settings";
import { fileField, imageError, storeImage } from "../images";
import { sendSafirText } from "../../bale/safir";
import { botToken, connectBot, notifyAdmins, sendToChats, type BotKind } from "../../bale/botapi";
import { confirmOrder, rejectOrder, shopOwnerChats, type Deps } from "../orders";
import { parseSizeGuide } from "../sizes";
import { AdminPage, AdminSettingsPage, DashboardPage, ORDER_FILTERS, OrderDetailPage, OrdersPage, type PanelOrder, ProductFormPage, ProductsPage, SettingsPage, ShopRegisterPage } from "../views/panel";
import { currentUser, form, intParam, siteUrl } from "./helpers";

export const panel = new Hono<Env>();

const myShop = (c: C) => c.env.DB.prepare("SELECT * FROM shops WHERE owner_id = ?").bind(currentUser(c).id).first<Shop>();

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
    await c.env.DB.prepare("INSERT INTO shops (owner_id, name, slug, description, phone, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(user.id, f.name, slug, f.description ?? "", phone, city, now())
      .run();
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
  return render(
    c,
    <DashboardPage user={currentUser(c)} shop={shop} stats={stats.results[0] as never} orders={orders.results as PanelOrder[]} onlyAwaiting={onlyAwaiting} />,
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
};

panel.get("/panel/orders/:id{[0-9]+}", async (c) => {
  const order = await shopOrder(c);
  if (!order) return c.notFound();
  return render(c, <OrderDetailPage user={currentUser(c)} shop={shopOf(c)} order={order} saved={SAVED_MESSAGES[c.req.query("done") ?? ""]} />);
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
  return render(c, <ProductsPage user={currentUser(c)} shop={shopOf(c)} products={results} />);
});

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_IMAGES = 8;
const MAX_PACKAGES = 10;
const VIDEO_URL = /^https:\/\/(www\.)?(instagram\.com|t\.me|telegram\.me|ble\.ir)\/\S+$/i;

async function productFormPage(c: C, product: Product | null, values: Record<string, string>, errors?: string[], status: 200 | 400 = 200) {
  const [images, packages] = product ? await Promise.all([productImages(c.env.DB, product.id), productPackages(c.env.DB, product.id)]) : [[], []];
  return render(c, <ProductFormPage user={currentUser(c)} shop={shopOf(c)} product={product} values={values} images={images} packages={packages} categories={categoryList(c.get("settings"))} errors={errors} />, status);
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
      "UPDATE products SET title = ?, description = ?, price = ?, video_url = ?, image_key = ?, size_guide = ?, size_guide_image = ?, category = ?, features = ?, is_active = ?, updated_at = ? WHERE id = ?",
    )
      .bind(values.title, values.description, price, values.video_url, cover, sizeGuide, chartKey, values.category, values.features, Number(values.is_active), t, product.id)
      .run();
  } else {
    const row = await db.prepare(
      "INSERT INTO products (shop_id, title, description, price, video_url, image_key, size_guide, size_guide_image, category, features, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(shop.id, values.title, values.description, price, values.video_url, cover, sizeGuide, chartKey, values.category, values.features, Number(values.is_active), t, t)
      .first<{ id: number }>();
    productId = row!.id;
  }
  const stmts: D1PreparedStatement[] = [];
  for (const img of existing.filter((i) => removeIds.has(i.id))) stmts.push(db.prepare("DELETE FROM product_images WHERE id = ? AND product_id = ?").bind(img.id, productId));
  newKeys.forEach((key, n) => stmts.push(db.prepare("INSERT INTO product_images (product_id, image_key, sort) VALUES (?, ?, ?)").bind(productId, key, kept.length + n)));
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
    category: p.category, features: p.features,
    is_active: String(p.is_active), saved: c.req.query("saved") ?? "",
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

const settingsView = async (c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) =>
  render(c, <SettingsPage user={currentUser(c)} shop={(await myShop(c))!} {...extra} />, status);

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
  return render(c, <AdminPage user={currentUser(c)} shops={shops.results as never} stats={stats.results as never} featuredId={Number(c.get("settings").featured_shop_id) || 0} />);
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

// ---------- site settings (admin) ----------

async function settingsPage(c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) {
  const s = await loadSettings(c.env.DB);
  c.set("settings", s); // reflect just-saved values (e.g. site name) in the layout
  const linked = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM bale_links").first<{ n: number }>();
  return render(c, <AdminSettingsPage user={currentUser(c)} s={s} webhookBase={new URL(c.req.url).origin} linkedCount={linked?.n ?? 0} {...extra} />, status);
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
    const username = await connectBot(kind, token, `${base}/bot/${kind}/${await webhookSecret(c.env.DB, s)}`);
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
