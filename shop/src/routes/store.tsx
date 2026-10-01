import { Hono } from "hono";
import { normalizePhone } from "../../../lib/normalize";
import { getPublicProduct, listProducts, markPaid, reserveItem, wishlistItems, type Order, type Shop, type Wishlist } from "../db";
import type { C, Env } from "../env";
import { notifyShop, orderMessage } from "../notify";
import { gateway } from "../payment";
import { CheckoutPage, DevPayPage, HomePage, PayResultPage, ProductPage, ShopPage, WishlistPublicPage } from "../views/store";
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
  const fail = (errors: string[], status: 400 | 409 | 502 = 400) =>
    c.html(<CheckoutPage user={c.get("user")} item={item} wishlist={w} ownerName={w.owner_name} values={f} errors={errors} />, status);

  const errors: string[] = [];
  if (!f.name) errors.push("نام خود را وارد کنید.");
  if (!/^09\d{9}$/.test(phone)) errors.push("شماره موبایل نامعتبر است.");
  if (errors.length) return fail(errors);

  const gw = gateway(c.env);
  if (!gw) return fail(["درگاه پرداخت تنظیم نشده است."], 502);

  const order = await reserveItem(c.env.DB, item.id, {
    name: f.name.slice(0, 80),
    phone,
    message: (f.message ?? "").slice(0, 300),
    anonymous: f.anonymous === "1",
  });
  if (!order) return fail(["متأسفانه این آرزو همین الان توسط شخص دیگری خریده یا رزرو شده، یا دیگر در دسترس نیست."], 409);

  const start = await gw.start({
    amount: order.amount,
    description: `کادو: ${item.title} برای ${w.owner_name}`,
    callbackUrl: `${siteUrl(c)}/pay/callback?order=${order.id}`,
    mobile: phone,
  });
  if (!start.ok) {
    console.error(start.error);
    await c.env.DB.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").bind(order.id).run();
    return fail(["اتصال به درگاه پرداخت ناموفق بود. دوباره تلاش کنید."], 502);
  }
  await c.env.DB.prepare("UPDATE orders SET pay_authority = ? WHERE id = ?").bind(start.authority, order.id).run();
  return c.redirect(start.redirectUrl);
});

store.get("/pay/dev", (c) => {
  if (c.env.DEV_PAYMENTS !== "1" || c.env.ZARINPAL_MERCHANT_ID) return c.notFound();
  return c.html(<DevPayPage authority={c.req.query("authority") ?? ""} amount={Number(c.req.query("amount"))} cb={c.req.query("cb") ?? "/"} />);
});

async function sendShopNotification(c: C, orderId: number) {
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<Order>();
  const shop = await c.env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(o!.shop_id).first<Shop>();
  let error = "";
  try {
    error = await notifyShop(c.env, shop!, orderMessage(o!, siteUrl(c)));
  } catch (e) {
    error = String(e);
  }
  await c.env.DB.prepare("UPDATE orders SET shop_notified = ?, notify_error = ? WHERE id = ?").bind(error ? 0 : 1, error, orderId).run();
}

store.get("/pay/callback", async (c) => {
  const user = c.get("user");
  const order = await c.env.DB.prepare("SELECT o.*, w.slug AS wishlist_slug FROM orders o JOIN wishlists w ON w.id = o.wishlist_id WHERE o.id = ?")
    .bind(Number(c.req.query("order")))
    .first<Order & { wishlist_slug: string }>();
  const authority = c.req.query("Authority") ?? "";
  if (!order || !order.pay_authority || order.pay_authority !== authority) {
    return c.html(<PayResultPage user={user} ok={false} message="اطلاعات پرداخت نامعتبر است." />, 400);
  }
  const done = (refId: string | null) =>
    c.html(
      <PayResultPage user={user} ok message="فروشگاه مطلع شد و کادو را برای صاحب لیست ارسال می‌کند. ممنون از مهربانی‌تان!" wishlistSlug={order.wishlist_slug} refId={refId ?? undefined} />,
    );
  if (order.status !== "pending" && order.status !== "expired" && order.status !== "failed") return done(order.pay_ref_id);

  const failed = async () => {
    await c.env.DB.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(order.id).run();
    return c.html(<PayResultPage user={user} ok={false} message="پرداخت لغو شد یا ناموفق بود. مبلغی کسر نشده یا ظرف ۷۲ ساعت برمی‌گردد." wishlistSlug={order.wishlist_slug} />);
  };
  if (c.req.query("Status") !== "OK") return failed();

  const gw = gateway(c.env);
  const verified = gw ? await gw.verify(authority, order.amount) : { ok: false as const, error: "no gateway" };
  if (!verified.ok) {
    console.error(verified.error);
    return failed();
  }
  // Verified money wins even if the reservation lapsed meanwhile.
  if (await markPaid(c.env.DB, order.id, verified.refId)) c.executionCtx.waitUntil(sendShopNotification(c, order.id));
  return done(verified.refId);
});

store.get("/img/:key{.+}", async (c) => {
  const obj = await c.env.IMAGES.get(c.req.param("key"));
  if (!obj) return c.notFound();
  return c.body(obj.body, 200, {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});

export { sendShopNotification };
