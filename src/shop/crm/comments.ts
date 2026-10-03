// Reels and posts linked to products: when someone comments (e.g. "چنده؟"), the shop answers under the
// comment and sends the product, price and link to their Direct, and the person becomes a lead.
import { now, toman, type Shop } from "../db";
import { matchesKeyword, onStageChange } from "./automation";
import { addIncoming, addInterest, addOutgoing, conversationFor, customerForIg, getCustomer, logActivity } from "./db";
import { privateReply, replyToComment, type IgComment } from "./instagram";

export interface MediaLink {
  id: number;
  shop_id: number;
  media_id: string;
  product_id: number | null;
  permalink: string;
  caption: string;
  thumb: string;
  keywords: string;
  comment_reply: string;
  dm_text: string;
  active: number;
  created_at: string;
}

export const DEFAULT_KEYWORDS = "قیمت، چنده، چند، لینک، خرید، موجود، price";
export const DEFAULT_COMMENT_REPLY = "جزئیات و قیمت رو براتون دایرکت فرستادیم 🌸";
export const DEFAULT_DM = "سلام {name} 🌸\n{title}\nقیمت: {price}\nخرید و جزئیات: {link}";

/** Fill {name} {title} {price} {link} in a template. */
export function fillTemplate(t: string, v: { name: string; title: string; price: string; link: string }) {
  return t.replace(/\{(name|title|price|link)\}/g, (_, k: keyof typeof v) => v[k]).trim();
}

/** Lowest price a buyer pays for the product (a variant's sale price or price, else the product's). */
async function productOffer(db: D1Database, shopId: number, productId: number) {
  return db
    .prepare(
      `SELECT p.id, p.title, MIN(COALESCE(s.sale_price, s.price, p.price)) AS price FROM products p
       LEFT JOIN product_stock s ON s.product_id = p.id WHERE p.id = ? AND p.shop_id = ? GROUP BY p.id`,
    )
    .bind(productId, shopId)
    .first<{ id: number; title: string; price: number }>();
}

/** One comment from the webhook. `siteUrl` builds the product link. */
export async function handleIgComment(db: D1Database, shop: Shop, cm: IgComment, siteUrl: string) {
  if (cm.fromId === shop.ig_account_id) return; // the shop's own replies
  const link = await db
    .prepare("SELECT * FROM ig_media_links WHERE shop_id = ? AND media_id = ? AND active = 1")
    .bind(shop.id, cm.mediaId)
    .first<MediaLink>();
  const row = await db
    .prepare(
      `INSERT INTO ig_comments (shop_id, comment_id, media_id, ig_user_id, username, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (comment_id) DO NOTHING RETURNING id`,
    )
    .bind(shop.id, cm.commentId, cm.mediaId, cm.fromId, cm.username, cm.text, now())
    .first<{ id: number }>();
  if (!row || !link || !shop.ig_access_token) return; // a repeat delivery, or a post without automation
  if (link.keywords.trim() && !matchesKeyword({ keyword: link.keywords }, cm.text)) return;

  const finish = (action: string, error = "", customerId: number | null = null) =>
    db.prepare("UPDATE ig_comments SET action = ?, error = ?, customer_id = ? WHERE id = ?").bind(action, error.slice(0, 300), customerId, row.id).run();

  // The commenter becomes a customer (a lead), with the comment in their conversation.
  const { id: customerId, created } = await customerForIg(db, shop.id, cm.fromId, { username: cm.username });
  if (created) await logActivity(db, shop.id, null, "create", "customer", customerId, "instagram");
  else if (cm.username) await db.prepare("UPDATE customers SET username = ? WHERE id = ? AND username = ''").bind(cm.username, customerId).run();
  const conv = await conversationFor(db, shop.id, customerId);
  await addIncoming(db, shop.id, conv.id, { igId: `comment:${cm.commentId}`, type: "comment", body: cm.text, at: now() });

  // One automatic DM per person per post, however many times they comment.
  const already = await db
    .prepare("SELECT 1 AS x FROM ig_comments WHERE shop_id = ? AND media_id = ? AND ig_user_id = ? AND action = 'dm' AND id <> ? LIMIT 1")
    .bind(shop.id, cm.mediaId, cm.fromId, row.id)
    .first();
  if (already) return finish("repeat", "", customerId);

  const product = link.product_id ? await productOffer(db, shop.id, link.product_id) : null;
  const customer = await getCustomer(db, shop.id, customerId);
  const vars = {
    name: customer?.name || (cm.username ? `@${cm.username}` : ""),
    title: product?.title ?? "",
    price: product ? toman(product.price) : "",
    link: product ? `${siteUrl}/p/${product.id}` : `${siteUrl}/s/${shop.slug}`,
  };
  let error = "";
  if (link.dm_text.trim()) {
    const text = fillTemplate(link.dm_text, vars);
    try {
      const mid = await privateReply(shop.ig_access_token, shop.ig_account_id, cm.commentId, text);
      await addOutgoing(db, shop.id, conv.id, { body: text, sentBy: null, igId: mid });
    } catch (e) {
      error = String((e as Error).message);
      await addOutgoing(db, shop.id, conv.id, { body: text, sentBy: null, status: "failed", error: error.slice(0, 300) });
    }
  }
  if (link.comment_reply.trim()) {
    try {
      await replyToComment(shop.ig_access_token, cm.commentId, fillTemplate(link.comment_reply, vars));
    } catch (e) {
      error ||= String((e as Error).message);
    }
  }
  if (product) await addInterest(db, shop.id, customerId, product.id, "dm");
  if (customer?.stage === "lead") await onStageChange(db, shop.id, customerId, "interested", null);
  await finish(error ? "error" : "dm", error, customerId);
}
