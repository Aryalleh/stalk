/** Orders that count as bought (shop confirmed the money). */
const SOLD = "('paid', 'shipped', 'delivered')";
/** SQL condition (alias o, ?now param) for orders that occupy a unit: bought, reported, or a live hold. */
const HOLDS = (nowParam: string) =>
  `(o.status IN ('awaiting', 'paid', 'shipped', 'delivered') OR (o.status = 'pending' AND o.expires_at > ${nowParam}))`;

export const now = () => new Date().toISOString();

export function randomSlug(len = 10) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export interface Shop {
  id: number;
  owner_id: number;
  name: string;
  slug: string;
  description: string;
  phone: string;
  status: "pending" | "approved" | "suspended";
  card_number: string;
  card_holder: string;
  city: string;
  courier_enabled: number;
  courier_fee: number;
  post_enabled: number;
  post_fee: number;
  instagram: string;
  telegram: string;
  bale: string;
  website: string;
  bale_chat_id: string;
  telegram_chat_id: string;
  created_at: string;
}

export interface Product {
  id: number;
  shop_id: number;
  title: string;
  description: string;
  price: number;
  image_key: string; // cover (first photo)
  video_url: string;
  size_guide: string; // JSON, see sizes.ts
  size_guide_image: string;
  is_active: number;
  created_at: string;
}
export type ProductWithShop = Product & { shop_name: string; shop_slug: string };

export interface Wishlist {
  id: number;
  user_id: number;
  slug: string;
  title: string;
  description: string;
  occasion_date: string;
  recipient_name: string;
  recipient_phone: string;
  address: string;
  postal_code: string;
  city: string;
  is_open: number;
  created_at: string;
}

/** A wishlist item with its product and how many units are bought / held by unexpired checkouts. */
export type ItemView = {
  id: number;
  wishlist_id: number;
  product_id: number;
  quantity: number;
  note: string;
  size: string;
  title: string;
  price: number;
  image_key: string;
  product_active: number;
  shop_name: string;
  shop_slug: string;
  shop_ok: number; // approved and has a card number to receive transfers
  shop_city: string;
  courier_enabled: number;
  courier_fee: number;
  post_enabled: number;
  post_fee: number;
  bought: number;
  reserved: number; // live holds + transfers waiting for the shop to confirm
};

/** Products visible to the public: active and from an approved shop. */
const PUBLIC_PRODUCT = "p.is_active = 1 AND s.status = 'approved'";

export async function listProducts(db: D1Database, opts: { q?: string; shopId?: number; limit: number; offset: number }) {
  const where = [PUBLIC_PRODUCT];
  const binds: unknown[] = [];
  if (opts.q) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    binds.push(like, like, like);
  }
  if (opts.shopId) {
    where.push("p.shop_id = ?");
    binds.push(opts.shopId);
  }
  const { results } = await db
    .prepare(
      `SELECT p.*, s.name AS shop_name, s.slug AS shop_slug FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, opts.limit, opts.offset)
    .all<ProductWithShop>();
  return results;
}

export async function getPublicProduct(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT p.*, s.name AS shop_name, s.slug AS shop_slug FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.id = ? AND ${PUBLIC_PRODUCT}`,
    )
    .bind(id)
    .first<ProductWithShop>();
}

export async function wishlistItems(db: D1Database, wishlistId: number): Promise<ItemView[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.wishlist_id, i.product_id, i.quantity, i.note, i.size,
              p.title, p.price, p.image_key, p.is_active AS product_active,
              s.name AS shop_name, s.slug AS shop_slug, (s.status = 'approved' AND s.card_number <> '') AS shop_ok,
              s.city AS shop_city, s.courier_enabled, s.courier_fee, s.post_enabled, s.post_fee,
              (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND o.status IN ${SOLD}) AS bought,
              (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND ${HOLDS("?1")} AND o.status NOT IN ${SOLD}) AS reserved
       FROM wishlist_items i JOIN products p ON p.id = i.product_id JOIN shops s ON s.id = p.shop_id
       WHERE i.wishlist_id = ?2 ORDER BY i.created_at`,
    )
    .bind(now(), wishlistId)
    .all<ItemView>();
  return results;
}

export interface GiverInput {
  name: string;
  phone: string;
  message: string;
  anonymous: boolean;
}

export interface Pricing {
  packageName: string;
  packagePrice: number;
  method: DeliveryMethod;
  fee: number;
}

/**
 * Atomically create a pending order holding one unit of the item, only if a unit is still free
 * (quantity > bought + reported + live holds). Returns null when the item is taken or not buyable.
 * The total is the product's current price + package + delivery fee.
 */
export async function reserveItem(db: D1Database, itemId: number, giver: GiverInput, holdMinutes: number, pricing: Pricing) {
  const t = now();
  const expires = new Date(Date.now() + holdMinutes * 60_000).toISOString();
  return db
    .prepare(
      `INSERT INTO orders (token, item_id, wishlist_id, product_id, shop_id, product_title, item_price, package_name, package_price,
                           delivery_method, delivery_fee, amount, giver_name, giver_phone, gift_message, is_anonymous,
                           status, expires_at, pay_card_number, size, created_at)
       SELECT ?8, i.id, i.wishlist_id, p.id, p.shop_id, p.title, p.price, ?9, ?10, ?11, ?12, p.price + ?10 + ?12,
              ?2, ?3, ?4, ?5, 'pending', ?6, s.card_number, i.size, ?7
       FROM wishlist_items i
       JOIN wishlists w ON w.id = i.wishlist_id
       JOIN products p ON p.id = i.product_id
       JOIN shops s ON s.id = p.shop_id
       WHERE i.id = ?1 AND w.is_open = 1 AND p.is_active = 1 AND s.status = 'approved' AND s.card_number <> ''
         AND i.quantity > (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND ${HOLDS("?7")})
       RETURNING id, token, amount`,
    )
    .bind(itemId, giver.name, giver.phone, giver.message, giver.anonymous ? 1 : 0, expires, t, randomSlug(24),
      pricing.packageName, pricing.packagePrice, pricing.method, pricing.fee)
    .first<{ id: number; token: string; amount: number }>();
}

// ---------- delivery ----------

export type DeliveryMethod = "courier" | "post";

/** Normalize a city name so "شیراز" typed with Arabic ي/ك or extra spaces still matches. */
export const normCity = (c: string) => (c ?? "").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim();

/** Delivery methods a shop offers to a recipient city: courier only in the shop's own city, post anywhere. */
export function deliveryOptions(
  shop: { city: string; courier_enabled: number; courier_fee: number; post_enabled: number; post_fee: number },
  recipientCity: string,
) {
  const out: { method: DeliveryMethod; fee: number }[] = [];
  const sameCity = !!shop.city && normCity(shop.city) === normCity(recipientCity);
  if (shop.courier_enabled && sameCity) out.push({ method: "courier", fee: shop.courier_fee });
  if (shop.post_enabled) out.push({ method: "post", fee: shop.post_fee });
  return out;
}

export interface ProductImage {
  id: number;
  image_key: string;
}
export interface ProductPackage {
  id: number;
  name: string;
  price: number;
}

export async function productImages(db: D1Database, productId: number) {
  return (await db.prepare("SELECT id, image_key FROM product_images WHERE product_id = ? ORDER BY sort, id").bind(productId).all<ProductImage>()).results;
}

export async function productPackages(db: D1Database, productId: number) {
  return (await db.prepare("SELECT id, name, price FROM product_packages WHERE product_id = ? ORDER BY sort, id").bind(productId).all<ProductPackage>()).results;
}

export type OrderStatus = "pending" | "awaiting" | "paid" | "shipped" | "delivered" | "rejected";

export interface Order {
  id: number;
  token: string;
  item_id: number;
  wishlist_id: number;
  product_id: number;
  shop_id: number;
  product_title: string;
  amount: number;
  giver_name: string;
  giver_phone: string;
  gift_message: string;
  is_anonymous: number;
  status: OrderStatus;
  expires_at: string;
  pay_card_number: string;
  size: string;
  item_price: number;
  package_name: string;
  package_price: number;
  delivery_method: string;
  delivery_fee: number;
  ship_city: string;
  transfer_ref: string;
  transfer_card_last4: string;
  transfer_at: string;
  receipt_key: string;
  reported_at: string | null;
  reject_reason: string;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_postal_code: string;
  tracking_code: string;
  shop_notified: number;
  notify_error: string;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
}

/**
 * Giver uploaded the transfer receipt. Accepted even after the hold lapsed, since the money may
 * already have moved; the shop decides when confirming. Returns false if already reported.
 */
export async function reportReceipt(db: D1Database, orderId: number, receiptKey: string) {
  const r = await db
    .prepare("UPDATE orders SET status = 'awaiting', receipt_key = ?2, reported_at = ?3 WHERE id = ?1 AND status = 'pending'")
    .bind(orderId, receiptKey, now())
    .run();
  return r.meta.changes === 1;
}

/** Shop confirms the money arrived: mark paid and snapshot the delivery address. */
export async function confirmPayment(db: D1Database, orderId: number, shopId: number) {
  const r = await db
    .prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?3,
         ship_name = w.recipient_name, ship_phone = w.recipient_phone, ship_city = w.city,
         ship_address = w.address, ship_postal_code = w.postal_code
       FROM wishlists w
       WHERE orders.id = ?1 AND orders.shop_id = ?2 AND orders.status = 'awaiting' AND w.id = orders.wishlist_id`,
    )
    .bind(orderId, shopId, now())
    .run();
  return r.meta.changes === 1;
}

/** Shop says the money never arrived; the unit becomes free again. */
export async function rejectPayment(db: D1Database, orderId: number, shopId: number, reason: string) {
  const r = await db
    .prepare("UPDATE orders SET status = 'rejected', reject_reason = ? WHERE id = ? AND shop_id = ? AND status = 'awaiting'")
    .bind(reason, orderId, shopId)
    .run();
  return r.meta.changes === 1;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "در انتظار واریز",
  awaiting: "واریز اعلام شد — در انتظار تأیید فروشگاه",
  paid: "پرداخت تأیید شد — آماده ارسال",
  shipped: "ارسال شد",
  delivered: "تحویل شد",
  rejected: "واریز تأیید نشد",
};

export const toman = (n: number) => `${n.toLocaleString("fa-IR")} تومان`;
