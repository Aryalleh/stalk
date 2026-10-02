import { Hono } from "hono";
import { normalizeDigits, normalizePhone } from "../../../lib/normalize";
import { getPublicProduct, listProducts, randomSlug, reportTransfer, reserveItem, wishlistItems, type Order, type Shop, type Wishlist } from "../db";
import type { C, Env } from "../../env";
import { notifyShop, shipMessage, transferMessage } from "../notify";
import { CheckoutPage, HomePage, OrderPage, ProductPage, ShopPage, WishlistPublicPage } from "../views/store";
import { PAGE, form, intParam, pageParam, siteUrl } from "./helpers";

export const store = new Hono<Env>();

store.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const page = pageParam(c);
  const products = await listProducts(c.env.DB, { q, limit: PAGE + 1, offset: (page - 1) * PAGE });
  return c.html(<HomePage user={c.get("user")} q={q} products={products.slice(0, PAGE)} page={page} hasNext={products.length > PAGE} />);
});

store.get("/p/:id{[0-9]+}", async (c) => {
  const product = await getPublicProduct(c.env.DB, intParam(c, "id"));
  if (!product) return c.notFound();
  const user = c.get("user");
  const wishlists = user
    ? (await c.env.DB.prepare("SELECT * FROM wishlists WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all<Wishlist>()).results
    : [];
  return c.html(<ProductPage user={user} product={product} wishlists={wishlists} added={c.req.query("added")} />);
});

store.get("/s/:slug", async (c) => {
  const shop = await c.env.DB.prepare("SELECT * FROM shops WHERE slug = ? AND status = 'approved'").bind(c.req.param("slug")).first<Shop>();
  if (!shop) return c.notFound();
  const products = await listProducts(c.env.DB, { shopId: shop.id, limit: 200, offset: 0 });
  return c.html(<ShopPage user={c.get("user")} shop={shop} products={products} />);
});

async function wishlistWithOwner(db: D1Database, where: string, value: string | number) {
  return db
    .prepare(`SELECT w.*, u.name AS owner_name FROM wishlists w JOIN users u ON u.id = w.user_id WHERE ${where}`)
    .bind(value)
    .first<Wishlist & { owner_name: string }>();
}

store.get("/w/:slug", async (c) => {
  const w = await wishlistWithOwner(c.env.DB, "w.slug = ?", c.req.param("slug"));
  if (!w) return c.notFound();
  const user = c.get("user");
  return c.html(
    <WishlistPublicPage
      user={user}
      wishlist={w}
      ownerName={w.owner_name}
      items={await wishlistItems(c.env.DB, w.id)}
      isOwner={user?.id === w.user_id}
      shareUrl={`${siteUrl(c)}/w/${w.slug}`}
    />,
  );
});

// ---------- gift checkout ----------

async function loadItem(c: C) {
  const itemId = intParam(c, "itemId");
  const row = await c.env.DB.prepare("SELECT wishlist_id FROM wishlist_items WHERE id = ?").bind(itemId).first<{ wishlist_id: number }>();
  if (!row) return null;
  const w = await wishlistWithOwner(c.env.DB, "w.id = ?", row.wishlist_id);
  const item = (await wishlistItems(c.env.DB, row.wishlist_id)).find((i) => i.id === itemId);
  return w && item ? { w, item } : null;
}

store.get("/gift/:itemId{[0-9]+}", async (c) => {
  const found = await loadItem(c);
  if (!found) return c.notFound();
  return c.html(<CheckoutPage user={c.get("user")} item={found.item} wishlist={found.w} ownerName={found.w.owner_name} />);
});

store.post("/gift/:itemId{[0-9]+}", async (c) => {
  const found = await loadItem(c);
  if (!found) return c.notFound();
  const { w, item } = found;
  const f = await form(c);
  const phone = normalizePhone(f.phone ?? "");
  const fail = (errors: string[], status: 400 | 409 = 400) =>
    c.html(<CheckoutPage user={c.get("user")} item={item} wishlist={w} ownerName={w.owner_name} values={f} errors={errors} />, status);

  const errors: string[] = [];
  if (!f.name) errors.push("نام خود را وارد کنید.");
  if (!/^09\d{9}$/.test(phone)) errors.push("شماره موبایل نامعتبر است.");
  if (errors.length) return fail(errors);

  const order = await reserveItem(c.env.DB, item.id, {
    name: f.name.slice(0, 80),
    phone,
    message: (f.message ?? "").slice(0, 300),
    anonymous: f.anonymous === "1",
  });
  if (!order) return fail(["متأسفانه این آرزو همین الان توسط شخص دیگری خریده یا رزرو شده، یا دیگر در دسترس نیست."], 409);
  return c.redirect(`/order/${order.token}`);
});

// ---------- the giver's private order page (card-to-card) ----------

type OrderView = Order & { wishlist_slug: string; owner_name: string; card_holder: string; shop_name: string };

async function orderByToken(c: C) {
  return c.env.DB.prepare(
    `SELECT o.*, w.slug AS wishlist_slug, u.name AS owner_name, s.card_holder, s.name AS shop_name
     FROM orders o JOIN wishlists w ON w.id = o.wishlist_id JOIN users u ON u.id = w.user_id JOIN shops s ON s.id = o.shop_id
     WHERE o.token = ?`,
  )
    .bind(c.req.param("token"))
    .first<OrderView>();
}

store.get("/order/:token", async (c) => {
  const order = await orderByToken(c);
  if (!order) return c.notFound();
  return c.html(<OrderPage user={c.get("user")} order={order} />);
});

const RECEIPT_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_RECEIPT = 3 * 1024 * 1024;

store.post("/order/:token/transfer", async (c) => {
  const order = await orderByToken(c);
  if (!order) return c.notFound();
  if (order.status !== "pending") return c.redirect(`/order/${order.token}`);
  const body = await c.req.parseBody();
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const values = { ref: normalizeDigits(str("ref")), last4: normalizeDigits(str("last4")), at: str("at").slice(0, 40) };
  const errors: string[] = [];
  if (!/^\d{4,30}$/.test(values.ref)) errors.push("شماره پیگیری را درست وارد کنید (فقط عدد).");
  if (!/^\d{4}$/.test(values.last4)) errors.push("۴ رقم آخر کارتی که از آن واریز کردید را وارد کنید.");
  const file = body.receipt;
  let receiptKey = "";
  if (file instanceof File && file.size > 0) {
    const ext = RECEIPT_TYPES[file.type];
    if (!ext) errors.push("تصویر رسید باید JPG، PNG یا WebP باشد.");
    else if (file.size > MAX_RECEIPT) errors.push("حجم تصویر رسید حداکثر ۳ مگابایت است.");
    else receiptKey = `r/${order.shop_id}/${randomSlug(24)}.${ext}`;
  }
  if (errors.length) return c.html(<OrderPage user={c.get("user")} order={order} errors={errors} values={values} />, 400);
  if (receiptKey) await c.env.IMAGES.put(receiptKey, await (file as File).arrayBuffer(), { httpMetadata: { contentType: (file as File).type } });

  if (await reportTransfer(c.env.DB, order.id, { ...values, receiptKey })) {
    c.executionCtx.waitUntil(sendShopMessage(c, order.id, "transfer"));
  }
  return c.redirect(`/order/${order.token}`);
});

/** Message the shop on its bot channels and record the outcome on the order. */
export async function sendShopMessage(c: C, orderId: number, kind: "transfer" | "ship") {
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>();
  const shop = await c.env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(o!.shop_id).first<Shop>();
  let error = "";
  try {
    error = await notifyShop(c.env, shop!, kind === "transfer" ? transferMessage(o!, siteUrl(c)) : shipMessage(o!, siteUrl(c)));
  } catch (e) {
    error = String(e);
  }
  await c.env.DB.prepare("UPDATE orders SET shop_notified = ?, notify_error = ? WHERE id = ?").bind(error ? 0 : 1, error, orderId).run();
}

// Product images are public; receipts (r/...) are only served through /panel.
store.get("/img/:key{p/.+}", async (c) => {
  const obj = await c.env.IMAGES.get(c.req.param("key"));
  if (!obj) return c.notFound();
  return c.body(obj.body, 200, {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});
