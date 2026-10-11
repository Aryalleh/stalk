// Run a shop from a chat: the same text commands work in an Instagram DM to the platform's page
// (for Instagram pages not on the site yet) and in the site's Bale/Telegram bot (for any shop).
// Each command returns the reply text.
import { cardNumberError, formatCard, toLatinDigits } from "../../lib/normalize";
import { cancelForStock, confirmOrder, rejectOrder, shipOrder, type Deps } from "./orders";
import { now, randomSlug, toman, type Order, type Shop } from "./db";
import { variantLabel } from "./variants";
import { cancelCode, issueCode, verifyCode } from "../bale/otp";
import { SafirError, sendSafirOtp } from "../bale/safir";
import { assignUsername } from "../session";
import { handOver } from "./instagram-shops";

const n = (x: number) => x.toLocaleString("fa-IR", { useGrouping: false });

export const COMMANDS_HELP = [
  "📋 دستورها (هر کدام را جدا بفرستید؛ عدد فارسی یا انگلیسی فرقی ندارد):",
  "",
  "💳 کارت 6037991234567890 نام صاحب کارت — کارتی که خریداران به آن واریز می‌کنند",
  "🛍 محصولات — فهرست محصولات با شماره‌شان",
  "🏷 قیمت 12 850000 — قیمت محصول ۱۲ به تومان",
  "🚫 ناموجود 12 — و «موجود 12» برای برگرداندن",
  "📦 سفارش‌ها — سفارش‌های باز",
  "🔎 سفارش 34 — جزئیات سفارش و آدرس گیرنده",
  "✅ تایید 34 — واریز به کارتتان رسید",
  "❌ رد 34 دلیل — واریز نرسید",
  "🚚 ارسال 34 کدرهگیری — ثبت ارسال و کد رهگیری",
  "⛔️ لغو 34 دلیل — لغو سفارش (کالا تمام شده)",
  "📱 شماره موبایلتان (مثل 09121234567) — ثبت‌نام و فروشگاه کامل خودتان در سایت",
  "🏪 عضویت — همین کار با لینک",
].join("\n");

const STATUS: Record<string, string> = {
  pending: "منتظر واریز خریدار",
  awaiting: "خریدار واریز کرده؛ منتظر تأیید شما",
  paid: "پرداخت‌شده؛ منتظر ارسال",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  rejected: "رد شده",
  canceled: "لغو شده",
};

/** Persian/Arabic letters and digits folded, spaces collapsed, a leading "/" dropped. */
export function normalizeCommand(text: string) {
  return toLatinDigits(text)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\//, "");
}

/** What a shop still has to do before its wished-for items can be bought. */
export async function setupTodo(db: D1Database, shop: Shop) {
  const { results } = await db
    .prepare("SELECT id, title FROM products WHERE shop_id = ? AND awaiting_price = 1 AND is_active = 1 ORDER BY id")
    .bind(shop.id)
    .all<{ id: number; title: string }>();
  const lines: string[] = [];
  if (!shop.card_number) lines.push("💳 شماره کارتتان را بفرستید، مثلاً:\nکارت 6037991234567890 علی رضایی");
  if (results.length) {
    lines.push("🏷 قیمت این محصولات را بفرستید:\n" + results.map((p) => `• ${p.title} → قیمت ${p.id} مبلغ‌به‌تومان`).join("\n"));
  }
  return lines;
}

function orderLine(o: Order) {
  const v = variantLabel(o.size, o.color);
  return `#${n(o.id)} «${o.product_title}»${v ? ` (${v})` : ""} — ${toman(o.amount)} — ${STATUS[o.status] ?? o.status}`;
}

function orderDetails(o: Order) {
  const lines = [orderLine(o)];
  if (o.status === "awaiting") {
    lines.push(`واریز: پیگیری ${o.transfer_ref || "—"}، ۴ رقم آخر کارت خریدار ${o.transfer_card_last4 || "—"}${o.transfer_at ? `، ${o.transfer_at}` : ""}`);
    lines.push(`اگر مبلغ به کارتتان رسید: تایید ${o.id}\nاگر نرسید: رد ${o.id} دلیل`);
  }
  if (o.status === "paid" || o.status === "shipped") {
    lines.push(
      "ارسال به:",
      `${o.ship_name} — ${o.ship_phone}`,
      [o.ship_city, o.ship_address].filter(Boolean).join("، "),
      o.ship_postal_code ? `کد پستی: ${o.ship_postal_code}` : "",
    );
    if (o.gift_message) lines.push(`پیام کادو: ${o.gift_message}`);
    lines.push(o.status === "paid" ? `بعد از ارسال: ارسال ${o.id} کدرهگیری` : `کد رهگیری: ${o.tracking_code || "—"}`);
  }
  return lines.filter(Boolean).join("\n");
}

/** Run one command for a shop and return the reply. `site` is the site's address. */
export async function runShopCommand(d: Deps, shop: Shop, text: string): Promise<string> {
  const db = d.db;
  const t = normalizeCommand(text);
  const order = (id: string) => db.prepare("SELECT * FROM orders WHERE id = ? AND shop_id = ?").bind(Number(id), shop.id).first<Order>();
  let m: RegExpMatchArray | null;

  if (/^(راهنما|help|کمک|دستورها|start|سلام|منو|menu|\?|؟)$/i.test(t)) {
    const todo = await setupTodo(db, shop);
    return [todo.length ? todo.join("\n\n") + "\n" : "", COMMANDS_HELP].filter(Boolean).join("\n");
  }

  if ((m = t.match(/^(?:کارت|card)\s+([\d -]{16,25})\s*(.*)$/i))) {
    const card = m[1].replace(/\D/g, "");
    const err = cardNumberError(card);
    if (err) return `❌ ${err}`;
    const holder = m[2].trim().slice(0, 80) || shop.card_holder || shop.name;
    await db.prepare("UPDATE shops SET card_number = ?, card_holder = ? WHERE id = ?").bind(card, holder, shop.id).run();
    shop.card_number = card;
    const todo = await setupTodo(db, shop);
    return [`✅ کارت ${formatCard(card)} به نام ${holder} ثبت شد. خریداران مستقیم به همین کارت واریز می‌کنند.`, ...todo].join("\n\n");
  }

  if (/^(محصولات|کالاها|products)$/i.test(t)) {
    const { results } = await db
      .prepare("SELECT id, title, price, awaiting_price, is_active, (SELECT COUNT(*) FROM wishlist_items i WHERE i.product_id = p.id) AS wishes FROM products p WHERE shop_id = ? ORDER BY id DESC LIMIT 30")
      .bind(shop.id)
      .all<{ id: number; title: string; price: number; awaiting_price: number; is_active: number; wishes: number }>();
    if (!results.length) return "هنوز محصولی ندارید.";
    return (
      "🛍 محصولات:\n" +
      results
        .map((p) => `${n(p.id)}. ${p.title} — ${p.awaiting_price ? "بدون قیمت" : toman(p.price)}${p.is_active ? "" : " (ناموجود)"} — ${n(p.wishes)} آرزو`)
        .join("\n") +
      "\n\nتغییر قیمت: قیمت شماره مبلغ"
    );
  }

  if ((m = t.match(/^(?:قیمت|price)\s+(?:(\d+)\s+)?([\d,٬]+)\s*(هزار|k)?\s*(?:تومان)?$/i))) {
    let id = m[1] ? Number(m[1]) : 0;
    let price = Number(m[2].replace(/[,٬]/g, "")) * (m[3] ? 1000 : 1);
    if (!id) {
      const { results } = await db.prepare("SELECT id FROM products WHERE shop_id = ? AND awaiting_price = 1").bind(shop.id).all<{ id: number }>();
      if (results.length !== 1) return "شماره محصول را هم بنویسید، مثلاً: قیمت 12 850000\nفهرست: محصولات";
      id = results[0].id;
    }
    if (!Number.isInteger(price) || price < 1000 || price > 1_000_000_000) return "❌ قیمت را به تومان بنویسید، مثلاً: قیمت 12 850000";
    const r = await db.prepare("UPDATE products SET price = ?, awaiting_price = 0, updated_at = ? WHERE id = ? AND shop_id = ? RETURNING title").bind(price, now(), id, shop.id).first<{ title: string }>();
    if (!r) return `محصول ${n(id)} پیدا نشد. فهرست: محصولات`;
    const todo = await setupTodo(db, shop);
    return [`✅ قیمت «${r.title}» شد ${toman(price)}.`, ...todo, todo.length ? "" : "حالا خریداران می‌توانند آن را بخرند 🎁"].filter(Boolean).join("\n\n");
  }

  if ((m = t.match(/^(ناموجود|موجود)\s+(\d+)$/))) {
    const active = m[1] === "موجود" ? 1 : 0;
    const r = await db.prepare("UPDATE products SET is_active = ?, updated_at = ? WHERE id = ? AND shop_id = ? RETURNING title").bind(active, now(), Number(m[2]), shop.id).first<{ title: string }>();
    if (!r) return `محصول ${n(Number(m[2]))} پیدا نشد.`;
    return active ? `✅ «${r.title}» دوباره قابل خرید است.` : `🚫 «${r.title}» ناموجود شد و فعلاً خریده نمی‌شود.`;
  }

  if (/^(سفارشها|سفارشات|orders)$/i.test(t)) {
    const { results } = await db
      .prepare("SELECT * FROM orders WHERE shop_id = ? AND status IN ('awaiting', 'paid', 'shipped') ORDER BY (status = 'awaiting') DESC, (status = 'paid') DESC, id DESC LIMIT 20")
      .bind(shop.id)
      .all<Order>();
    if (!results.length) return "سفارش بازی ندارید.";
    return "📦 سفارش‌ها:\n" + results.map(orderLine).join("\n") + "\n\nجزئیات: سفارش شماره";
  }

  if ((m = t.match(/^(?:سفارش|order)\s+(\d+)$/i))) {
    const o = await order(m[1]);
    return o ? orderDetails(o) : `سفارش ${n(Number(m[1]))} پیدا نشد.`;
  }

  if ((m = t.match(/^(?:تایید|تأیید|ok|confirm)\s+(\d+)$/i))) {
    const o = await order(m[1]);
    if (!o) return `سفارش ${n(Number(m[1]))} پیدا نشد.`;
    if (o.status !== "awaiting") return `سفارش ${n(o.id)}: ${STATUS[o.status] ?? o.status}.`;
    await confirmOrder(d, o.id, shop.id);
    const after = (await order(m[1]))!;
    return `✅ واریز سفارش ${n(o.id)} تأیید شد و به خریدار خبر دادیم.\n\n${orderDetails(after)}`;
  }

  if ((m = t.match(/^(?:رد|reject)\s+(\d+)\s*(.*)$/i))) {
    const o = await order(m[1]);
    if (!o) return `سفارش ${n(Number(m[1]))} پیدا نشد.`;
    if (o.status !== "awaiting") return `سفارش ${n(o.id)}: ${STATUS[o.status] ?? o.status}.`;
    await rejectOrder(d, o.id, shop.id, m[2].trim().slice(0, 300) || "واریز به کارت فروشگاه نرسید");
    return `❌ واریز سفارش ${n(o.id)} رد شد و آرزو دوباره قابل خرید است.`;
  }

  if ((m = t.match(/^(?:ارسال|ship)\s+(\d+)\s*(.*)$/i))) {
    const o = await order(m[1]);
    if (!o) return `سفارش ${n(Number(m[1]))} پیدا نشد.`;
    if (o.status !== "paid" && o.status !== "shipped") return `سفارش ${n(o.id)}: ${STATUS[o.status] ?? o.status}.`;
    const tracking = m[2].replace(/\s+/g, "").slice(0, 60);
    await shipOrder(d, o.id, shop.id, tracking || o.tracking_code);
    return `🚚 سفارش ${n(o.id)} ارسال‌شده ثبت شد${tracking ? ` (کد رهگیری ${tracking})` : ""} و به خریدار و گیرنده خبر دادیم.`;
  }

  if ((m = t.match(/^(?:لغو|cancel)\s+(\d+)\s*(.*)$/i))) {
    const o = await order(m[1]);
    if (!o) return `سفارش ${n(Number(m[1]))} پیدا نشد.`;
    if (o.status !== "awaiting" && o.status !== "paid") return `سفارش ${n(o.id)}: ${STATUS[o.status] ?? o.status}؛ قابل لغو نیست.`;
    const ok = await cancelForStock(d, o.id, shop.id, m[2].trim().slice(0, 300), "فروشگاه مبلغ را به کارت خریدار برمی‌گرداند");
    return ok
      ? `⛔️ سفارش ${n(o.id)} لغو شد و به خریدار خبر دادیم.${o.status === "paid" ? `\nلطفاً ${toman(o.amount)} را به کارت خریدار برگردانید.` : ""}`
      : "لغو انجام نشد.";
  }

  // Sign up by phone: the number gets a one-time code (in Bale), the code comes back here.
  if (shop.is_external && (m = t.match(/^(?:ثبت ?نام|شماره|موبایل|signup)?\s*(?:\+98|0098|0)?(9\d{9})$/i))) {
    const phone = `0${m[1]}`;
    const owner = await db.prepare("SELECT id, shop_id FROM users WHERE phone = ?").bind(phone).first<{ id: number; shop_id: number | null }>();
    if (owner?.shop_id || (owner && (await db.prepare("SELECT 1 AS x FROM shops WHERE owner_id = ?").bind(owner.id).first()))) {
      return "این شماره از قبل فروشگاه دیگری در سایت دارد؛ شماره‌ی دیگری بفرستید.";
    }
    const issued = await issueCode(db, phone);
    if ("wait" in issued) return issued.wait;
    try {
      await sendSafirOtp(d.settings, phone, issued.code);
    } catch (e) {
      if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(d.siteUrl)) {
        await cancelCode(db, phone);
        return `ارسال کد به ${phone} ممکن نشد${e instanceof SafirError ? `: ${e.message}` : ""}. دوباره امتحان کنید.`;
      }
      console.log(`[dev] login code for ${phone}: ${issued.code}`); // local development only
    }
    await db.prepare("UPDATE shops SET claim_phone = ? WHERE id = ?").bind(phone, shop.id).run();
    return `📩 یک کد ۶ رقمی در «بله» به شماره ${phone} فرستادیم. همان کد را همین‌جا بفرستید.`;
  }

  if (shop.is_external && shop.claim_phone && (m = t.match(/^(?:کد|code)?\s*(\d{6})$/i))) {
    const phone = shop.claim_phone;
    const ok = await verifyCode(db, phone, m[1]);
    if (ok !== true) return `❌ ${ok}`;
    let user = await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();
    if (!user) {
      user = await db
        .prepare("INSERT INTO users (phone, name, first_name, password_hash, created_at) VALUES (?, ?, ?, '!', ?) ON CONFLICT (phone) DO NOTHING RETURNING id")
        .bind(phone, shop.name, shop.name, now())
        .first<{ id: number }>();
      user ??= await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();
      await assignUsername(db, user!.id);
    }
    const error = await handOver(db, shop.id, user!.id);
    await db.prepare("UPDATE shops SET claim_phone = '' WHERE id = ?").bind(shop.id).run();
    if (error) return `❌ ${error}`;
    return [
      "🎉 ثبت‌نام انجام شد و فروشگاه کامل شما در سایت آماده است!",
      `ورود به پنل: ${d.siteUrl}/panel (با شماره ${phone})`,
      "آنجا محصول تازه اضافه کنید، قیمت‌ها و ارسال را تنظیم کنید و بات بله یا تلگرام را وصل کنید تا سفارش‌ها همیشه به دستتان برسد.",
      "همین دستورها اینجا و در بات هم کار می‌کنند.",
    ].join("\n");
  }

  if (/^(عضویت|join|فروشگاه|پنل|panel)$/i.test(t)) {
    if (!shop.is_external) return `فروشگاه شما در سایت فعال است: ${d.siteUrl}/panel`;
    let token = shop.claim_token;
    if (!token) {
      token = randomSlug(24);
      await db.prepare("UPDATE shops SET claim_token = ? WHERE id = ?").bind(token, shop.id).run();
    }
    return [
      "🏪 فروشگاه کامل خودتان در سایت: پنل مدیریت، همه محصولات، دریافت سفارش‌ها در بات بله/تلگرام و CRM.",
      "محصولات، آرزوها و سفارش‌های فعلی هم منتقل می‌شوند.",
      "",
      `این لینک را باز کنید و با شماره موبایل خودتان وارد شوید:\n${d.siteUrl}/claim/${token}`,
      "",
      "این لینک مخصوص شماست؛ آن را برای کسی نفرستید.",
    ].join("\n");
  }

  return `دستور را متوجه نشدم 🙏\n\n${COMMANDS_HELP}`;
}
