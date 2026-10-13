// Run a shop from a chat: the same text commands work in an Instagram DM to the platform's page
// (for Instagram pages not on the site yet) and in the site's Bale/Telegram bot (for any shop).
// Each command returns the reply text.
import { cardNumberError, formatCard, toLatinDigits } from "../../lib/normalize";
import { cancelForStock, confirmOrder, rejectOrder, shipOrder, type Deps } from "./orders";
import { deleteProduct, now, toman, type Order, type Shop } from "./db";
import { variantLabel } from "./variants";
import { cancelCode, issueCode, verifyCode } from "../bale/otp";
import { SafirError, sendSafirOtp } from "../bale/safir";
import { joinWithPhone, loginLink } from "./instagram-shops";

const n = (x: number) => x.toLocaleString("fa-IR", { useGrouping: false });

export const COMMANDS_HELP = [
  "👇 کارها را با دکمه‌ها انجام دهید؛ یا این دستورها را تایپ کنید (عدد فارسی یا انگلیسی فرقی ندارد):",
  "",
  "💳 کارت 6037991234567890 نام صاحب کارت — کارتی که خریداران به آن واریز می‌کنند",
  "🛍 محصولات — فهرست محصولات با شماره‌شان",
  "🏷 قیمت 12 850000 — قیمت محصول ۱۲ به تومان",
  "🚫 ناموجود 12 — و «موجود 12» برای برگرداندن",
  "🗑 حذف 12 — حذف محصول (با تأیید)",
  "📦 سفارش‌ها — سفارش‌های باز",
  "🔎 سفارش 34 — جزئیات سفارش و آدرس گیرنده",
  "✅ تایید 34 — واریز به کارتتان رسید",
  "❌ رد 34 دلیل — واریز نرسید",
  "🚚 ارسال 34 کدرهگیری — ثبت ارسال و کد رهگیری",
  "⛔️ لغو 34 دلیل — لغو سفارش (کالا تمام شده)",
  "📱 شماره موبایلتان (مثل 09121234567) — ثبت‌نام و فروشگاه کامل خودتان در سایت",
  "🔗 پنل — لینک ورود به پنل وب فروشگاه (تکمیل اطلاعات و ثبت‌نام)",
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
    .prepare("SELECT id, title, source_url FROM products WHERE shop_id = ? AND deleted_at IS NULL AND awaiting_price = 1 AND is_active = 1 ORDER BY id")
    .bind(shop.id)
    .all<{ id: number; title: string; source_url: string }>();
  const lines: string[] = [];
  if (!shop.card_number) lines.push("💳 شماره کارتتان را ثبت کنید (دکمه‌ی «ثبت شماره کارت»).");
  if (results.length) {
    lines.push("🏷 قیمت این محصولات را بدهید (دکمه‌ی «قیمت …» هر کدام):\n" + results.map((p) => `• ${p.title}${p.source_url ? `\n  ${p.source_url}` : ""}`).join("\n"));
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
  if (o.status === "paid" && !o.ship_address.trim()) {
    lines.push("📍 منتظر آدرس گیرنده: از او خواستیم آدرس فعلی‌اش را ثبت کند؛ به‌محض ثبت، آدرس را همین‌جا می‌فرستیم. تا آن موقع ارسال نکنید.");
  } else if (o.status === "paid" || o.status === "shipped") {
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
      .prepare("SELECT id, title, price, awaiting_price, is_active, (SELECT COUNT(*) FROM wishlist_items i WHERE i.product_id = p.id) AS wishes FROM products p WHERE shop_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30")
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
      const { results } = await db.prepare("SELECT id FROM products WHERE shop_id = ? AND deleted_at IS NULL AND awaiting_price = 1").bind(shop.id).all<{ id: number }>();
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
    if (!o.ship_address.trim()) return `📍 سفارش ${n(o.id)} هنوز آدرس ندارد: گیرنده باید آدرس فعلی‌اش را ثبت کند؛ به‌محض ثبت برایتان می‌فرستیم.`;
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
    const joined = await joinWithPhone(db, shop, phone);
    if (typeof joined === "string") return `❌ ${joined}`;
    return [
      "🎉 ثبت‌نام انجام شد و فروشگاه کامل شما در سایت آماده است!",
      `ورود به پنل: ${d.siteUrl}/panel (با شماره ${phone})`,
      "آنجا محصول تازه اضافه کنید، قیمت‌ها و ارسال را تنظیم کنید و بات بله یا تلگرام را وصل کنید تا سفارش‌ها همیشه به دستتان برسد.",
      "همین دستورها اینجا و در بات هم کار می‌کنند.",
    ].join("\n");
  }

  // The web panel: a one-time sign-in link (the page completes its details and its phone there).
  if (/^(عضویت|join|فروشگاه|پنل|panel|ورود|وب|web)$/i.test(t)) {
    if (!shop.is_external) return `فروشگاه شما در سایت فعال است: ${d.siteUrl}/panel`;
    return [
      "🔗 ورود به پنل وب فروشگاه شما (یک‌بار مصرف، تا ۳۰ دقیقه):",
      await loginLink(db, d.siteUrl, shop),
      "",
      "آنجا اطلاعات فروشگاه (نام، توضیح، شهر، تلفن، روش ارسال، لوگو) را کامل کنید، محصول اضافه کنید و با ثبت شماره موبایل، حساب دائمی و فروشگاه کامل خودتان را داشته باشید: پنل، CRM و دریافت سفارش‌ها در بات بله/تلگرام.",
      "",
      "این لینک مخصوص شماست؛ آن را برای کسی نفرستید.",
    ].join("\n");
  }

  return `دستور را متوجه نشدم 🙏\n\n${COMMANDS_HELP}`;
}

// ---------- buttons ----------
// Replies carry buttons (Instagram quick replies, Bale/Telegram inline buttons). A button sends a
// short code (payload); one that needs a value asks for it and the next message is the answer.

export interface ChatButton {
  title: string;
  payload: string;
}
export interface ChatReply {
  text: string;
  buttons: ChatButton[];
  /** Products to show one by one (photo + caption); a reply to one sets its price. */
  cards?: ProductCard[];
}

export interface ProductCard {
  id: number;
  title: string;
  image_key: string;
  caption: string;
}

/** The shop's products as chat cards: unpriced first. */
async function productCards(db: D1Database, shop: Shop): Promise<ProductCard[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, price, awaiting_price, is_active, image_key, source_url, (SELECT COUNT(*) FROM wishlist_items i WHERE i.product_id = p.id) AS wishes
       FROM products p WHERE shop_id = ? AND deleted_at IS NULL ORDER BY awaiting_price DESC, id DESC LIMIT 10`,
    )
    .bind(shop.id)
    .all<{ id: number; title: string; price: number; awaiting_price: number; is_active: number; image_key: string; source_url: string; wishes: number }>();
  return results.map((p) => ({
    id: p.id,
    title: p.title,
    image_key: p.image_key,
    caption: [
      `🛍 ${p.title}`,
      `${p.awaiting_price ? "🏷 هنوز قیمت ندارد" : `🏷 ${toman(p.price)}`}${p.is_active ? "" : " — ناموجود"} — ${n(p.wishes)} آرزو`,
      p.source_url ? `🔗 ${p.source_url}` : "",
      `↩️ برای ${p.awaiting_price ? "ثبت" : "تغییر"} قیمت، روی همین پیام ریپلای کنید و فقط مبلغ را بنویسید (یا «ناموجود» / «حذف»).`,
    ]
      .filter(Boolean)
      .join("\n"),
  }));
}

/** Remember a card sent in a chat, so a reply to it means that product. */
export async function rememberCard(db: D1Database, channel: string, chatId: string, messageId: string, productId: number) {
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO chat_cards (channel, chat_id, message_id, product_id, created_at) VALUES (?, ?, ?, ?, ?)").bind(channel, chatId, messageId, productId, now()),
    db.prepare("DELETE FROM chat_cards WHERE created_at < ?").bind(new Date(Date.now() - 30 * 86400_000).toISOString()),
  ]);
}

/** The product whose card a chat message replied to. */
export async function cardProduct(db: D1Database, channel: string, chatId: string, messageId: string | undefined) {
  if (!messageId) return 0;
  const r = await db.prepare("SELECT product_id FROM chat_cards WHERE channel = ? AND chat_id = ? AND message_id = ?").bind(channel, chatId, messageId).first<{ product_id: number }>();
  return r?.product_id ?? 0;
}

const STATE_TTL_MS = 30 * 60_000;
const short = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

async function setState(db: D1Database, shop: Shop, state: string) {
  shop.chat_state = state;
  await db.prepare("UPDATE shops SET chat_state = ?, chat_state_at = ? WHERE id = ?").bind(state, state ? now() : null, shop.id).run();
}

/** The buttons that fit the shop right now: open orders first, then what's missing, then the menu. */
export async function buttonsFor(db: D1Database, shop: Shop): Promise<ChatButton[]> {
  const [orders, unpriced] = await db.batch([
    db.prepare("SELECT id, status FROM orders WHERE shop_id = ? AND status IN ('awaiting', 'paid') ORDER BY (status = 'awaiting') DESC, id LIMIT 4").bind(shop.id),
    db.prepare("SELECT id, title FROM products WHERE shop_id = ? AND deleted_at IS NULL AND awaiting_price = 1 AND is_active = 1 ORDER BY id LIMIT 3").bind(shop.id),
  ]);
  const b: ChatButton[] = [];
  for (const o of orders.results as { id: number; status: string }[]) {
    if (o.status === "awaiting") b.push({ title: `✅ تایید #${n(o.id)}`, payload: `ok:${o.id}` }, { title: `❌ رد #${n(o.id)}`, payload: `no:${o.id}` });
    else b.push({ title: `🚚 ارسال #${n(o.id)}`, payload: `sh:${o.id}` });
  }
  if (!shop.card_number) b.push({ title: "💳 ثبت شماره کارت", payload: "card" });
  for (const p of unpriced.results as { id: number; title: string }[]) b.push({ title: `🏷 قیمت ${short(p.title, 12)}`, payload: `pr:${p.id}` });
  b.push({ title: "📦 سفارش‌ها", payload: "o" }, { title: "🛍 محصولات", payload: "p" });
  if (shop.is_external) b.push({ title: "🔗 پنل وب فروشگاه", payload: "web" }, { title: "📱 ثبت‌نام در سایت", payload: "su" });
  b.push({ title: "❓ راهنما", payload: "h" });
  return b.slice(0, 13);
}

const CANCEL: ChatButton = { title: "انصراف", payload: "x" };
const COMMAND_WORD = /^(حذف|delete|کارت|card|قیمت|price|سفارش|order|تایید|تأیید|ok|confirm|رد|reject|ارسال|ship|لغو|cancel|محصولات|کالاها|products|راهنما|help|منو|menu|عضویت|join|موجود|ناموجود)(\s|$)/i;

/** A message or a button press from the shop's chat: run it and say what's next. */
export async function runShopChat(d: Deps, shop: Shop, input: { text?: string; payload?: string; replyTo?: number }): Promise<ChatReply> {
  const db = d.db;
  const ask = async (state: string, text: string, extra: ChatButton[] = []): Promise<ChatReply> => {
    await setState(db, shop, state);
    return { text, buttons: [...extra, CANCEL] };
  };
  let command = "";
  if (input.payload) {
    if (shop.chat_state) await setState(db, shop, "");
    const [kind, arg] = input.payload.split(":");
    const id = Number(arg) || 0;
    switch (kind) {
      case "m":
      case "h":
        command = "راهنما";
        break;
      case "o":
        command = "سفارشها";
        break;
      case "p":
        command = "محصولات";
        break;
      case "ok":
        command = `تایید ${id}`;
        break;
      case "no":
        command = `رد ${id}`;
        break;
      case "od":
        command = `سفارش ${id}`;
        break;
      case "sh0":
        command = `ارسال ${id}`;
        break;
      case "join":
      case "web":
        command = "پنل";
        break;
      case "card":
        return ask("card", "💳 شماره کارت ۱۶ رقمی و نام صاحب کارت را بفرستید، مثلاً:\n6037991234567890 علی رضایی");
      case "pr": {
        const p = await db.prepare("SELECT title FROM products WHERE id = ? AND shop_id = ?").bind(id, shop.id).first<{ title: string }>();
        if (!p) break;
        return ask(`price:${id}`, `🏷 قیمت «${p.title}» را به تومان بفرستید، مثلاً 850000`);
      }
      case "sh":
        return ask(`ship:${id}`, `🚚 کد رهگیری مرسوله‌ی سفارش ${n(id)} را بفرستید.`, [{ title: "بدون کد رهگیری", payload: `sh0:${id}` }]);
      case "su":
        return ask("signup", "📱 شماره موبایلتان را بفرستید (مثل 09121234567). یک کد در «بله» برایتان می‌آید که همین‌جا می‌فرستید.");
      case "x":
        return { text: "لغو شد. 👇", buttons: await buttonsFor(db, shop) };
      case "del": {
        const p = await db.prepare("SELECT id, title FROM products WHERE id = ? AND shop_id = ? AND deleted_at IS NULL").bind(id, shop.id).first<{ id: number; title: string }>();
        if (!p) return { text: "این محصول پیدا نشد.", buttons: await buttonsFor(db, shop) };
        const how = await deleteProduct(db, d.images, p.id);
        return { text: `🗑 «${p.title}» حذف شد${how === "archived" ? " (سفارش‌های قبلی‌اش در سوابق می‌ماند)" : ""}.`, buttons: await buttonsFor(db, shop) };
      }
    }
  }
  // A reply to a product card: an amount is its price, "ناموجود" / "موجود" its availability.
  if (!command && input.replyTo) {
    const t = normalizeCommand(input.text ?? "");
    const p = await db.prepare("SELECT id FROM products WHERE id = ? AND shop_id = ?").bind(input.replyTo, shop.id).first<{ id: number }>();
    if (p && /^[\d,٬]+\s*(هزار|k)?\s*(تومان)?$/i.test(t)) command = `قیمت ${p.id} ${t}`;
    else if (p && /^(ناموجود|موجود|حذف)$/.test(t)) command = `${t} ${p.id}`;
    if (command && shop.chat_state) await setState(db, shop, "");
  }
  if (!command) {
    const raw = (input.text ?? "").trim();
    const fresh = shop.chat_state && shop.chat_state_at && Date.now() - Date.parse(shop.chat_state_at) < STATE_TTL_MS;
    const t = normalizeCommand(raw);
    if (fresh && !COMMAND_WORD.test(t)) {
      const [st, arg] = shop.chat_state.split(":");
      command = st === "card" ? `کارت ${raw}` : st === "price" ? `قیمت ${arg} ${raw}` : st === "ship" ? `ارسال ${arg} ${raw}` : raw;
    } else command = raw;
    if (shop.chat_state) await setState(db, shop, ""); // the question is answered (or set aside for a typed command)
  }
  const after = () => db.prepare("SELECT * FROM shops WHERE id = ?").bind(shop.id).first<Shop>().then((x) => x ?? shop);
  // Deleting asks first.
  const del = normalizeCommand(command).match(/^(?:حذف|delete)\s+(\d+)$/i);
  if (del) {
    const p = await db.prepare("SELECT id, title FROM products WHERE id = ? AND shop_id = ? AND deleted_at IS NULL").bind(Number(del[1]), shop.id).first<{ id: number; title: string }>();
    if (!p) return { text: `محصول ${n(Number(del[1]))} پیدا نشد.`, buttons: await buttonsFor(db, shop) };
    return { text: `🗑 «${p.title}» حذف شود؟ از لیست‌های آرزویی که هنوز خریده نشده‌اند هم برداشته می‌شود.`, buttons: [{ title: "بله، حذف شود", payload: `del:${p.id}` }, CANCEL] };
  }
  // The products as cards (photo + caption) to reply to, rather than a list of numbers.
  if (/^(محصولات|کالاها|products)$/i.test(normalizeCommand(command))) {
    const cards = await productCards(db, shop);
    if (cards.length) {
      return { text: "🛍 محصولات شما 👇\nبرای ثبت یا تغییر قیمت هر محصول، روی پیام همان محصول ریپلای کنید و فقط مبلغ را بنویسید (مثلاً 850000 یا ۸۵۰ هزار).", buttons: await buttonsFor(db, await after()), cards };
    }
  }
  const text = await runShopCommand(d, shop, command);
  return { text, buttons: await buttonsFor(db, await after()) };
}

/** Chat buttons as a Bale/Telegram inline keyboard, two per row ("c:<code>" comes back as a callback). */
export function inlineKeyboard(buttons: ChatButton[]) {
  if (!buttons.length) return undefined;
  const rows: { text: string; callback_data: string }[][] = [];
  buttons.forEach((b, i) => {
    if (i % 2 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: b.title, callback_data: `c:${b.payload}`.slice(0, 64) });
  });
  return { inline_keyboard: rows };
}
