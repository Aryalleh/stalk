import { Hono } from "hono";
import { normalizePhone } from "../../../lib/normalize";
import { upsertCustomer } from "../../crm/sync";
import type { C, Env } from "../../env";
import { render } from "../../render";
import { reservationMinutes } from "../../settings";
import {
  deliveryOptions,
  getPublicProduct,
  listProducts,
  productImages,
  productPackages,
  randomSlug,
  reportReceipt,
  reserveItem,
  wishlistItems,
  type ItemView,
  type Order,
  type Shop,
  type Wishlist,
} from "../db";
import { sendReceiptToShop } from "../orders";
import { CheckoutPage, HomePage, OrderPage, ProductPage, ShopPage, WishlistPublicPage } from "../views/store";
import { PAGE, form, intParam, pageParam, siteUrl } from "./helpers";

export const store = new Hono<Env>();

store.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const page = pageParam(c);
  const products = await listProducts(c.env.DB, { q, limit: PAGE + 1, offset: (page - 1) * PAGE });
  return render(c, <HomePage user={c.get("user")} q={q} products={products.slice(0, PAGE)} page={page} hasNext={products.length > PAGE} />);
});

store.get("/p/:id{[0-9]+}", async (c) => {
  const id = intParam(c, "id");
  const product = await getPublicProduct(c.env.DB, id);
  if (!product) return c.notFound();
  const user = c.get("user");
  const [wishlists, images, packages] = await Promise.all([
    user ? c.env.DB.prepare("SELECT * FROM wishlists WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all<Wishlist>().then((r) => r.results) : [],
    productImages(c.env.DB, id),
    productPackages(c.env.DB, id),
  ]);
  const error = c.req.query("err") === "size" ? "لطفاً سایز را انتخاب کنید." : c.req.query("pick") ? "لیست ساخته شد؛ حالا سایز را انتخاب کنید و به آرزوها اضافه کنید." : undefined;
  return render(c, <ProductPage user={user} product={product} wishlists={wishlists} images={images} packages={packages} added={c.req.query("added")} error={error} />);
});

store.get("/s/:slug", async (c) => {
  const shop = await c.env.DB.prepare("SELECT * FROM shops WHERE slug = ?").bind(c.req.param("slug")).first<Shop>();
  if (!shop) return c.notFound();
  const user = c.get("user");
  // Until approved, only the owner (and admins) can see the page, as a preview.
  const preview = shop.status !== "approved";
  if (preview && !(user && (user.id === shop.owner_id || user.is_admin))) return c.notFound();
  const products = preview
    ? (
        await c.env.DB.prepare(
          "SELECT p.*, s.name AS shop_name, s.slug AS shop_slug FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.shop_id = ? AND p.is_active = 1 ORDER BY p.created_at DESC",
        )
          .bind(shop.id)
          .all()
      ).results
    : await listProducts(c.env.DB, { shopId: shop.id, limit: 200, offset: 0 });
  return render(c, <ShopPage user={user} shop={shop} products={products as never} preview={preview} />);
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
  return render(
    c,
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
  if (!w || !item) return null;
  return { w, item, packages: await productPackages(c.env.DB, item.product_id), delivery: deliveryOptions(shopOf(item), w.city) };
}

const shopOf = (i: ItemView) => ({
  city: i.shop_city,
  courier_enabled: i.courier_enabled,
  courier_fee: i.courier_fee,
  post_enabled: i.post_enabled,
  post_fee: i.post_fee,
});

store.get("/gift/:itemId{[0-9]+}", async (c) => {
  const found = await loadItem(c);
  if (!found) return c.notFound();
  const { w, item, packages, delivery } = found;
  return render(c, <CheckoutPage user={c.get("user")} item={item} wishlist={w} ownerName={w.owner_name} packages={packages} delivery={delivery} />);
});

store.post("/gift/:itemId{[0-9]+}", async (c) => {
  const found = await loadItem(c);
  if (!found) return c.notFound();
  const { w, item, packages, delivery } = found;
  const f = await form(c);
  const phone = normalizePhone(f.phone ?? "");
  const fail = (errors: string[], status: 400 | 409 = 400) =>
    render(
      c,
      <CheckoutPage user={c.get("user")} item={item} wishlist={w} ownerName={w.owner_name} packages={packages} delivery={delivery} values={f} errors={errors} />,
      status,
    );

  const errors: string[] = [];
  if (!f.name) errors.push("نام خود را وارد کنید.");
  if (!/^09\d{9}$/.test(phone)) errors.push("شماره موبایل نامعتبر است.");
  const pkg = packages.find((p) => String(p.id) === f.package);
  if (packages.length && !pkg) errors.push("یک بسته‌بندی انتخاب کنید.");
  const ship = delivery.find((d) => d.method === f.delivery);
  if (!delivery.length) errors.push("این فروشگاه به شهر گیرنده ارسال ندارد.");
  else if (!ship) errors.push("روش ارسال را انتخاب کنید.");
  if (errors.length) return fail(errors);

  const order = await reserveItem(
    c.env.DB,
    item.id,
    { name: f.name.slice(0, 80), phone, message: (f.message ?? "").slice(0, 300), anonymous: f.anonymous === "1" },
    reservationMinutes(c.get("settings")),
    { packageName: pkg?.name ?? "", packagePrice: pkg?.price ?? 0, method: ship!.method, fee: ship!.fee },
  );
  if (!order) return fail(["متأسفانه این آرزو همین الان توسط شخص دیگری خریده یا رزرو شده، یا دیگر در دسترس نیست."], 409);
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: f.name, phone, source: "خریدار کادو" }));
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
  return render(c, <OrderPage user={c.get("user")} order={order} />);
});

const RECEIPT_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_RECEIPT = 5 * 1024 * 1024;

// The giver only uploads the receipt photo; it goes to the shop's bot with confirm/reject buttons.
store.post("/order/:token/receipt", async (c) => {
  const order = await orderByToken(c);
  if (!order) return c.notFound();
  if (order.status !== "pending") return c.redirect(`/order/${order.token}`);
  const file = (await c.req.parseBody()).receipt;
  const fail = (error: string) => render(c, <OrderPage user={c.get("user")} order={order} errors={[error]} />, 400);
  if (!(file instanceof File) || file.size === 0) return fail("عکس فیش واریز را انتخاب کنید.");
  const ext = RECEIPT_TYPES[file.type];
  if (!ext) return fail("عکس فیش باید JPG، PNG یا WebP باشد.");
  if (file.size > MAX_RECEIPT) return fail("حجم عکس فیش حداکثر ۵ مگابایت است.");
  const key = `r/${order.shop_id}/${randomSlug(24)}.${ext}`;
  await c.env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (await reportReceipt(c.env.DB, order.id, key)) {
    c.executionCtx.waitUntil(sendReceiptToShop({ db: c.env.DB, images: c.env.IMAGES, settings: c.get("settings"), siteUrl: siteUrl(c) }, order.id));
  }
  return c.redirect(`/order/${order.token}`);
});

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
