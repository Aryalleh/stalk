import { publicNameSql } from "../../session";
import { Hono } from "hono";
import { normalizePhone } from "../../../lib/normalize";
import { upsertCustomer } from "../../crm/sync";
import type { C, Env } from "../../env";
import { render } from "../../render";
import { categoryList, reservationMinutes } from "../../settings";
import {
  availableByVariant,
  deliveryOptions,
  getPublicProduct,
  listProducts,
  productImages,
  productPackages,
  PRODUCT_CODE,
  randomSlug,
  reportReceipt,
  reserveItem,
  wishlistItems,
  type ItemView,
  type Shop,
  type Wishlist,
} from "../db";
import { PUBLIC_IMAGE } from "../images";
import { PublicProfilePage, type PublicList, type PublicPerson, type ReceivedGift } from "../views/profile";
import { sendReceiptToShop } from "../orders";
import { CheckoutPage, HomePage, OrderPage, ProductPage, ShopPage, ShopsPage, WishlistPublicPage, categoryPath, type FeaturedShop, type OrderView, type ShopCard } from "../views/store";
import { PAGE, form, intParam, pageParam, siteUrl } from "./helpers";

export const store = new Hono<Env>();

// The home page is the explore page: search box, category chips, the shop of the week and a masonry of
// all products, or the search results for ?q= (searches stay on /).
async function feed(c: C, cat = c.req.query("cat") ?? "") {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  // A product code typed into search opens that product.
  if (new RegExp(`^${PRODUCT_CODE}$`).test(q)) {
    const hit = await c.env.DB.prepare("SELECT code FROM products WHERE code = ?").bind(q.toLowerCase()).first<{ code: string }>();
    if (hit) return c.redirect(`/p/${hit.code}`);
  }
  const categories = categoryList(c.get("settings"));
  const category = categories.includes(cat) ? cat : "";
  const page = pageParam(c);
  const featuredId = Number(c.get("settings").featured_shop_id) || 0;
  const [products, featured] = await Promise.all([
    listProducts(c.env.DB, { q, category, limit: PAGE + 1, offset: (page - 1) * PAGE }),
    !q && !category && featuredId
      ? c.env.DB.prepare("SELECT name, slug, description, cover_key, logo_key FROM shops WHERE id = ? AND status = 'approved'").bind(featuredId).first<FeaturedShop>()
      : null,
  ]);
  return render(
    c,
    <HomePage
      user={c.get("user")}
      q={q}
      category={category}
      categories={categories}
      products={products.slice(0, PAGE)}
      page={page}
      hasNext={products.length > PAGE}
      featured={featured}
    />,
  );
}

store.get("/", async (c) => {
  // A category without a search has its own clean page (/c/<name>).
  const cat = c.req.query("cat");
  if (cat && !c.req.query("q")?.trim()) return c.redirect(categoryPath(cat), 301);
  return feed(c);
});
store.get("/c/:cat", async (c) => {
  const cat = c.req.param("cat");
  if (!categoryList(c.get("settings")).includes(cat)) return c.notFound();
  return feed(c, cat);
});
// Old links: search used to live on its own page.
store.get("/search", (c) => {
  const qs = new URL(c.req.url).search;
  return c.redirect(`/${qs}`, 301);
});

// The product page lives at /p/<code>; old /p/<id> links move there.
store.get("/p/:id{[0-9]+}", async (c) => {
  const row = await c.env.DB.prepare("SELECT code FROM products WHERE id = ?").bind(intParam(c, "id")).first<{ code: string }>();
  if (row?.code) return c.redirect(`/p/${row.code}${new URL(c.req.url).search}`, 301);
  return productPage(c, intParam(c, "id"));
});
store.get(`/p/:code{${PRODUCT_CODE}}`, async (c) => {
  const code = c.req.param("code");
  if (code !== code.toLowerCase()) return c.redirect(`/p/${code.toLowerCase()}${new URL(c.req.url).search}`, 301);
  const row = await c.env.DB.prepare("SELECT id FROM products WHERE code = ?").bind(code).first<{ id: number }>();
  return row ? productPage(c, row.id) : c.notFound();
});

async function productPage(c: C, id: number) {
  const product = await getPublicProduct(c.env.DB, id);
  if (!product) return c.notFound();
  const user = c.get("user");
  const [wishlists, images, packages, shop] = await Promise.all([
    user ? c.env.DB.prepare("SELECT * FROM wishlists WHERE user_id = ? AND is_direct = 0 ORDER BY created_at DESC").bind(user.id).all<Wishlist>().then((r) => r.results) : [],
    productImages(c.env.DB, id),
    productPackages(c.env.DB, id),
    c.env.DB.prepare(
      `SELECT s.logo_key, (SELECT COUNT(*) FROM orders o WHERE o.shop_id = s.id AND o.status IN ('paid','shipped','delivered')) AS sales
       FROM shops s WHERE s.id = ?`,
    )
      .bind(product.shop_id)
      .first<{ logo_key: string; sales: number }>(),
  ]);
  const error = c.req.query("err") === "size" ? "لطفاً سایز / رنگ را انتخاب کنید." : c.req.query("pick") ? "لیست ساخته شد؛ حالا سایز / رنگ را انتخاب کنید و به آرزوها اضافه کنید." : undefined;
  const available = await availableByVariant(c.env.DB, product);
  return render(
    c,
    <ProductPage
      user={user}
      product={product}
      shop={shop ?? { logo_key: "", sales: 0 }}
      wishlists={wishlists}
      images={images}
      packages={packages}
      available={available}
      added={c.req.query("added")}
      error={error}
    />,
  );
}

// ---------- all shops ----------

store.get("/shops", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.city, s.description, s.logo_key, s.cover_key,
            (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.is_active = 1) AS products
     FROM shops s WHERE s.status = 'approved' ${q ? "AND (s.name LIKE ?1 OR s.city LIKE ?1 OR s.description LIKE ?1)" : ""}
     ORDER BY (s.id = ${Number(c.get("settings").featured_shop_id) || 0}) DESC, products DESC, s.created_at DESC LIMIT 300`,
  )
    .bind(...(q ? [like] : []))
    .all<ShopCard>();
  return render(c, <ShopsPage user={c.get("user")} shops={results} q={q} />);
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
  // Can each product be bought now? (not stock-tracked, or units left)
  const { results: stock } = await c.env.DB.prepare(
    `SELECT p.id, CASE WHEN p.track_stock = 0 THEN 1 WHEN COALESCE((SELECT SUM(quantity) FROM product_stock s WHERE s.product_id = p.id), 0) > 0 THEN 1 ELSE 0 END AS ok
     FROM products p WHERE p.shop_id = ?`,
  )
    .bind(shop.id)
    .all<{ id: number; ok: number }>();
  const available: Record<number, boolean> = Object.fromEntries(stock.map((r) => [r.id, !!r.ok]));
  const onlyAvailable = c.req.query("f") === "available";
  const shown = onlyAvailable ? (products as { id: number }[]).filter((p) => available[p.id] !== false) : products;
  return render(c, <ShopPage user={user} shop={shop} products={shown as never} preview={preview} available={available} onlyAvailable={onlyAvailable} />);
});

async function wishlistWithOwner(db: D1Database, where: string, value: string | number) {
  return db
    .prepare(`SELECT w.*, ${publicNameSql("u")} AS owner_name, u.avatar_key AS owner_avatar, u.username AS owner_username FROM wishlists w JOIN users u ON u.id = w.user_id WHERE ${where}`)
    .bind(value)
    .first<Wishlist & { owner_name: string; owner_avatar: string; owner_username: string | null }>();
}

store.get("/w/:slug", async (c) => {
  const w = await wishlistWithOwner(c.env.DB, "w.slug = ?", c.req.param("slug"));
  if (!w || w.is_direct) return c.notFound();
  const user = c.get("user");
  return render(
    c,
    <WishlistPublicPage
      user={user}
      wishlist={w}
      owner={{ name: w.owner_name, avatar_key: w.owner_avatar, username: w.owner_username ?? "" }}
      items={await wishlistItems(c.env.DB, w.id)}
      isOwner={user?.id === w.user_id}
      shareUrl={`${siteUrl(c)}/w/${w.slug}`}
    />,
  );
});

// ---------- public profile ----------

store.get("/u/:username", async (c) => {
  const db = c.env.DB;
  const person = await db
    .prepare(`SELECT id, ${publicNameSql("users")} AS name, username, avatar_key, birth_date, show_received, show_givers, show_birthday, show_given_count, phone FROM users WHERE username = ?`)
    .bind(c.req.param("username").toLowerCase())
    .first<PublicPerson>();
  if (!person) return c.notFound();
  const viewer = c.get("user");
  const isMe = viewer?.id === person.id;
  const SOLD = "('paid', 'shipped', 'delivered')";
  const given = person.show_given_count && person.phone
    ? await db
        .prepare(
          `SELECT COUNT(DISTINCT w.user_id) AS n FROM orders o JOIN wishlists w ON w.id = o.wishlist_id
           WHERE o.giver_phone = ? AND w.is_direct = 0 AND w.user_id <> ? AND o.status IN ${SOLD}`,
        )
        .bind(person.phone, person.id)
        .first<{ n: number }>()
    : null;
  const [lists, gifts] = await db.batch([
    db
      .prepare(
        `SELECT w.slug, w.title, w.description, w.occasion_date,
                (SELECT COUNT(*) FROM wishlist_items i WHERE i.wishlist_id = w.id) AS items,
                (SELECT COUNT(*) FROM wishlist_items i WHERE i.wishlist_id = w.id
                   AND i.quantity <= (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND o.status IN ${SOLD})) AS fulfilled,
                COALESCE((SELECT p.image_key FROM wishlist_items i JOIN products p ON p.id = i.product_id
                          WHERE i.wishlist_id = w.id ORDER BY i.created_at LIMIT 1), '') AS cover
         FROM wishlists w WHERE w.user_id = ? AND w.is_open = 1 AND w.is_direct = 0 ORDER BY w.created_at DESC`,
      )
      .bind(person.id),
    db
      .prepare(
        // A buyer who didn't stay anonymous is named under the gift (linked to their profile): for everyone while the recipient
        // shows givers (on by default), and always for the recipient. Anonymous buyers are never named.
        `SELECT o.product_id, COALESCE(p.code, '') AS product_code, o.product_title, COALESCE(p.image_key, '') AS image_key,
                CASE WHEN o.is_anonymous = 1 THEN CASE WHEN ?3 = 1 THEN 'ناشناس' ELSE '' END
                     WHEN ?3 = 1 OR ?2 = 1 THEN COALESCE(NULLIF(gu.nickname, ''), NULLIF(o.giver_name, ''), 'یک دوست')
                     ELSE '' END AS giver,
                (?2 = 1 AND o.is_anonymous = 0) AS giver_public,
                CASE WHEN o.is_anonymous = 0 AND (?3 = 1 OR ?2 = 1) THEN gu.username ELSE NULL END AS giver_username
         FROM orders o JOIN wishlists w ON w.id = o.wishlist_id LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN users gu ON gu.phone = o.giver_phone AND o.giver_phone <> ''
         WHERE w.user_id = ?1 AND w.is_direct = 0 AND o.status IN ${SOLD} ORDER BY o.paid_at DESC LIMIT 60`,
      )
      .bind(person.id, person.show_givers, isMe ? 1 : 0),
  ]);
  return render(
    c,
    <PublicProfilePage
      viewer={viewer}
      person={person}
      lists={lists.results as PublicList[]}
      gifts={person.show_received || isMe ? (gifts.results as ReceivedGift[]) : null}
      isMe={isMe}
      givenTo={given ? given.n : null}
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
    {
      name: f.name.slice(0, 80),
      phone,
      message: (f.message ?? "").slice(0, 300),
      anonymous: f.visibility === "anonymous" || f.anonymous === "1",
    },
    reservationMinutes(c.get("settings")),
    { packageName: pkg?.name ?? "", packagePrice: pkg?.price ?? 0, method: ship!.method, fee: ship!.fee },
  );
  if (!order) return fail(["متأسفانه این آرزو همین الان توسط شخص دیگری خریده یا رزرو شده، یا دیگر در دسترس نیست."], 409);
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: f.name, phone, source: "خریدار کادو" }));
  return c.redirect(`/order/${order.token}`);
});

// ---------- the giver's private order page (card-to-card) ----------

async function orderByToken(c: C) {
  return c.env.DB.prepare(
    `SELECT o.*, w.slug AS wishlist_slug, w.is_direct, ${publicNameSql("u")} AS owner_name, s.card_holder, s.name AS shop_name,
            COALESCE(p.image_key, '') AS image_key
     FROM orders o JOIN wishlists w ON w.id = o.wishlist_id JOIN users u ON u.id = w.user_id JOIN shops s ON s.id = o.shop_id
     LEFT JOIN products p ON p.id = o.product_id
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

// The giver can look at the receipt they sent (the order token is the secret, like the order page itself).
store.get("/order/:token/receipt", async (c) => {
  const order = await orderByToken(c);
  if (!order?.receipt_key) return c.notFound();
  const obj = await c.env.IMAGES.get(order.receipt_key);
  if (!obj) return c.notFound();
  return c.body(obj.body, 200, {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
});

// Product, avatar and shop images are public; receipts (r/...) are only served through /panel.
store.get("/img/:key{[pas]/.+}", async (c) => {
  if (!PUBLIC_IMAGE.test(c.req.param("key"))) return c.notFound();
  const obj = await c.env.IMAGES.get(c.req.param("key"));
  if (!obj) return c.notFound();
  return c.body(obj.body, 200, {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});
