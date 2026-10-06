// Deleting a shop for good (platform admin): its products with photos and stock, the gift orders and
// wishlist entries for those products, and everything in its CRM. One transaction, children first
// (D1 enforces foreign keys); the stored photos are removed afterwards.

export async function shopFootprint(db: D1Database, shopId: number) {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE shop_id = ?1) AS products,
         (SELECT COUNT(*) FROM orders WHERE shop_id = ?1) AS orders,
         (SELECT COUNT(*) FROM orders WHERE shop_id = ?1 AND status IN ('awaiting', 'paid', 'shipped')) AS open_orders,
         (SELECT COUNT(*) FROM wishlist_items WHERE product_id IN (SELECT id FROM products WHERE shop_id = ?1)) AS wishes,
         (SELECT COUNT(*) FROM customers WHERE shop_id = ?1) AS customers,
         (SELECT COUNT(*) FROM crm_orders WHERE shop_id = ?1) AS crm_orders`,
    )
    .bind(shopId)
    .first<{ products: number; orders: number; open_orders: number; wishes: number; customers: number; crm_orders: number }>();
  return row!;
}

/** Deletes the shop and returns the storage keys of its photos (for the caller to remove). */
export async function deleteShop(db: D1Database, shopId: number) {
  const shop = await db.prepare("SELECT logo_key, cover_key FROM shops WHERE id = ?").bind(shopId).first<{ logo_key: string; cover_key: string }>();
  if (!shop) return null;
  const { results: imgs } = await db
    .prepare(
      `SELECT image_key AS k FROM products WHERE shop_id = ?1 AND image_key <> ''
       UNION SELECT size_guide_image FROM products WHERE shop_id = ?1 AND size_guide_image <> ''
       UNION SELECT i.image_key FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.shop_id = ?1
       UNION SELECT receipt_key FROM orders WHERE shop_id = ?1 AND receipt_key <> ''`,
    )
    .bind(shopId)
    .all<{ k: string }>();
  const products = "(SELECT id FROM products WHERE shop_id = ?1)";
  const byShop = (table: string) => db.prepare(`DELETE FROM ${table} WHERE shop_id = ?1`).bind(shopId);
  await db.batch([
    byShop("orders"),
    db.prepare(`DELETE FROM wishlist_items WHERE product_id IN ${products}`).bind(shopId),
    db.prepare(`DELETE FROM crm_order_items WHERE order_id IN (SELECT id FROM crm_orders WHERE shop_id = ?1) OR product_id IN ${products}`).bind(shopId),
    byShop("crm_orders"),
    byShop("product_interests"),
    byShop("ig_comments"),
    byShop("ig_media_links"),
    byShop("automation_rules"),
    byShop("tasks"),
    byShop("messages"),
    byShop("conversations"),
    byShop("notes"),
    byShop("customers"),
    byShop("tags"),
    byShop("quick_replies"),
    byShop("activity_log"),
    byShop("products"),
    db.prepare("UPDATE users SET shop_id = NULL, shop_role = '' WHERE shop_id = ?1").bind(shopId),
    db.prepare("UPDATE settings SET value = '' WHERE key = 'featured_shop_id' AND value = ?1").bind(String(shopId)),
    db.prepare("DELETE FROM shops WHERE id = ?1").bind(shopId),
  ]);
  return [shop.logo_key, shop.cover_key, ...imgs.map((r) => r.k)].filter(Boolean);
}
