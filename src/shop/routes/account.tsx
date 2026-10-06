import { Hono } from "hono";
import { stopImpersonation } from "../../impersonate";
import { render } from "../../render";
import { deleteCookie, getCookie } from "hono/cookie";
import { deleteSession } from "../../../lib/auth";
import { normalizeDigits, normalizePhone } from "../../../lib/normalize";
import { availableByVariant, getPublicProduct, normCity, now, productImages, randomSlug, wishlistItems, type Order, type Wishlist } from "../db";
import { upsertCustomer } from "../../crm/sync";
import { hasChoice, pickVariant } from "../variants";
import type { C, Env } from "../../env";
import { SESSION_COOKIE, USER_COLUMNS, assignUsername, needsProfile } from "../../session";
import { birthDate, fullName } from "../../../lib/people";
import { cancelCode, issueCode, verifyCode } from "../../bale/otp";
import { SafirError, sendSafirOtp } from "../../bale/safir";
import { loadSettings, safirReady, saveSettings } from "../../settings";
import { activeBots, botLink } from "../../bale/botapi";
import { connectToken } from "../../bale/connect";
import type { User } from "../../session";
import { fileField, imageError, storeImage } from "../images";
import { ChangeRequestPage, CodeLoginPage, CompleteProfilePage, profileValues, MyOrdersPage, MyWishlistsPage, ProfilePage, ProfileSettingsPage, WishlistFormPage, type MyOrder, type ProfileItem } from "../views/account";
import { DirectBuyPage } from "../views/store";
import { answerChange } from "../orders";

const sessionUserById = (db: D1Database, id: number) => db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();
import { SetupPage } from "../views/panel";
import { currentUser, form, intParam, safeNext, siteUrl, startSession } from "./helpers";

export const account = new Hono<Env>();
const MOBILE = /^09\d{9}$/;

// Accounts are created and signed in to only with a one-time code sent in Bale (Safir); there are no passwords.

const isLocal = (c: C) => ["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname);

/** Issue a code for the phone and deliver it in Bale. Returns an error message, or "" on success. */
async function sendCode(c: C, phone: string): Promise<string> {
  const issued = await issueCode(c.env.DB, phone);
  if ("wait" in issued) return issued.wait;
  try {
    await sendSafirOtp(c.get("settings"), phone, issued.code);
    return "";
  } catch (e) {
    if (isLocal(c)) {
      // Local development only: Safir is usually unreachable, so show the code in the wrangler console.
      console.log(`[dev] login code for ${phone}: ${issued.code}`);
      return "";
    }
    await cancelCode(c.env.DB, phone);
    console.error(e);
    return e instanceof SafirError ? e.message : "ارسال کد ناموفق بود؛ دوباره تلاش کنید.";
  }
}

const userByPhone = (c: C, phone: string) => c.env.DB.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();
const hasAdmin = async (c: C) => !!(await c.env.DB.prepare("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1").first());

account.get("/login", async (c) => {
  const next = safeNext(c.req.query("next"));
  if (!safirReady(c.get("settings"))) return render(c, <CodeLoginPage next={next} step="unavailable" setupOpen={!(await hasAdmin(c))} />, 503);
  return render(c, <CodeLoginPage next={next} step="phone" />);
});

account.post("/login", async (c) => {
  if (!safirReady(c.get("settings"))) return c.redirect("/login");
  const f = await form(c);
  const next = safeNext(f.next);
  const phone = normalizePhone(f.phone ?? "");
  const again = (error: string) => render(c, <CodeLoginPage next={next} step="phone" phone={f.phone} error={error} />, 400);
  if (!MOBILE.test(phone)) return again("شماره موبایل نامعتبر است.");
  const error = await sendCode(c, phone);
  if (error) return again(error);
  return c.redirect(`/login/verify?phone=${phone}&next=${encodeURIComponent(next)}`);
});

account.get("/login/verify", async (c) => {
  const phone = normalizePhone(c.req.query("phone") ?? "");
  if (!MOBILE.test(phone)) return c.redirect("/login");
  const isNew = !(await userByPhone(c, phone));
  return render(c, <CodeLoginPage next={safeNext(c.req.query("next"))} step="code" phone={phone} isNew={isNew} />);
});

/** Name and birth date from a form (signup, profile completion, settings). */
function readProfile(f: Record<string, string>) {
  const first = (f.first_name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const last = (f.last_name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const birth = birthDate(f.birth_year, f.birth_month, f.birth_day);
  const error = !first || !last ? "نام و نام خانوادگی را وارد کنید." : !birth ? "تاریخ تولد را درست انتخاب کنید." : "";
  const accent = f.accent === "blue" ? "blue" : "pink";
  const theme = f.theme === "dark" ? "dark" : "light";
  return { first, last, birth: birth ?? "", accent, theme, error };
}

account.post("/login/verify", async (c) => {
  const f = await form(c);
  const next = safeNext(f.next);
  const phone = normalizePhone(f.phone ?? "");
  if (!MOBILE.test(phone)) return c.redirect("/login");
  const existing = await userByPhone(c, phone);
  const fail = (error: string) => render(c, <CodeLoginPage next={next} step="code" phone={phone} isNew={!existing} values={f} error={error} />, 400);
  const profile = readProfile(f);
  if (!existing && profile.error) return fail(profile.error);
  const ok = await verifyCode(c.env.DB, phone, normalizeDigits(f.code ?? ""));
  if (ok !== true) return fail(ok);
  if (existing) return startSession(c, existing.id, next);
  const name = fullName(profile.first, profile.last);
  const row = await c.env.DB.prepare(
    `INSERT INTO users (phone, name, first_name, last_name, birth_date, accent, theme, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, '!', ?)
     ON CONFLICT (phone) DO NOTHING RETURNING id`,
  )
    .bind(phone, name, profile.first, profile.last, profile.birth, profile.accent, profile.theme, now())
    .first<{ id: number }>();
  const id = row?.id ?? (await userByPhone(c, phone))!.id;
  await assignUsername(c.env.DB, id);
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name, phone, source: "ثبت‌نام در سایت" }));
  return startSession(c, id, next);
});

// ---------- completing the profile (accounts from before names and birth date were required) ----------

account.get("/me/complete", async (c) => {
  const user = currentUser(c);
  const next = safeNext(c.req.query("next"));
  if (!needsProfile(user)) return c.redirect(next);
  return render(c, <CompleteProfilePage user={user} next={next} values={profileValues(user)} origin={siteUrl(c)} />);
});

account.post("/me/complete", async (c) => {
  const user = currentUser(c);
  const f = await form(c);
  const next = safeNext(f.next);
  const error = await saveProfile(c, user.id, f);
  if (error) return render(c, <CompleteProfilePage user={user} next={next} values={f} origin={siteUrl(c)} error={error} />, 400);
  return c.redirect(next);
});

/** Validate and store names, birth date and look (the public handle is fixed). Returns an error message or "". */
async function saveProfile(c: C, userId: number, f: Record<string, string>, extra: Record<string, number | string> = {}) {
  const p = readProfile(f);
  if (p.error) return p.error;
  const cols = Object.keys(extra);
  await c.env.DB.prepare(
    `UPDATE users SET first_name = ?, last_name = ?, name = ?, birth_date = ?, accent = ?, theme = ?${cols.map((k) => `, ${k} = ?`).join("")} WHERE id = ?`,
  )
    .bind(p.first, p.last, fullName(p.first, p.last), p.birth, p.accent, p.theme, ...Object.values(extra), userId)
    .run();
  return "";
}

// Old addresses.
account.get("/register", (c) => c.redirect(`/login${new URL(c.req.url).search}`));
account.get("/login/code", (c) => c.redirect(`/login${new URL(c.req.url).search}`));

// While an admin is signed in as a user, logging out (or "back to admin") returns to the admin's own account.
account.post("/logout/return", async (c) => c.redirect((await stopImpersonation(c)) ? "/admin/users" : "/"));

account.post("/logout", async (c) => {
  if (await stopImpersonation(c)) return c.redirect("/admin/users");
  await deleteSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.redirect("/");
});

// ---------- first platform admin ----------
// Login needs Safir, so setup takes the Safir key and bot id and proves the admin's phone with a code.
// The first person to finish becomes admin and the page closes, so run it right after deploying.

account.get("/setup", async (c) => {
  if (await hasAdmin(c)) return c.redirect("/login");
  return render(c, <SetupPage step="details" values={{ safir_bot_id: c.get("settings").safir_bot_id }} />);
});

account.post("/setup", async (c) => {
  if (await hasAdmin(c)) return c.redirect("/login");
  const f = await form(c);
  const phone = normalizePhone(f.phone ?? "");
  const botId = normalizeDigits(f.safir_bot_id ?? "");
  const fail = (error: string) => render(c, <SetupPage step="details" values={f} error={error} />, 400);
  if (!f.name || !MOBILE.test(phone)) return fail("نام و شماره موبایل معتبر لازم است.");
  if (!/^[\w.:-]{10,300}$/.test(f.safir_api_key ?? "")) return fail("کلید API سفیر را وارد کنید.");
  if (!/^\d{1,20}$/.test(botId)) return fail("شناسه عددی بازو را وارد کنید.");
  if (await userByPhone(c, phone)) return fail("این شماره قبلاً در سایت حساب دارد؛ شماره دیگری وارد کنید.");
  await saveSettings(c.env.DB, { safir_api_key: f.safir_api_key, safir_bot_id: botId });
  c.set("settings", await loadSettings(c.env.DB));
  const error = await sendCode(c, phone);
  if (error) return fail(`ارسال کد ناموفق بود (کلید و شناسه بازو را بررسی کنید): ${error}`);
  return render(c, <SetupPage step="code" values={{ name: f.name, phone }} />);
});

account.post("/setup/verify", async (c) => {
  if (await hasAdmin(c)) return c.redirect("/login");
  const f = await form(c);
  const phone = normalizePhone(f.phone ?? "");
  if (!f.name || !MOBILE.test(phone)) return c.redirect("/setup");
  const ok = await verifyCode(c.env.DB, phone, normalizeDigits(f.code ?? ""));
  if (ok !== true) return render(c, <SetupPage step="code" values={{ name: f.name, phone }} error={ok} />, 400);
  const row = await c.env.DB.prepare(
    "INSERT INTO users (phone, name, first_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, '!', 1, ?) ON CONFLICT (phone) DO NOTHING RETURNING id",
  )
    .bind(phone, f.name.slice(0, 80), f.name.slice(0, 40), now())
    .first<{ id: number }>();
  if (!row) return c.redirect("/setup");
  await assignUsername(c.env.DB, row.id); // the rest of the profile is asked for right after
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: f.name, phone, source: "مدیر سایت" }));
  return startSession(c, row.id, "/admin/settings");
});

// ---------- my wishlists (login required; enforced in index) ----------

// ---------- profile (html/profile.html) ----------

account.get("/me", async (c) => {
  const user = currentUser(c);
  const db = c.env.DB;
  const SOLD = "('paid', 'shipped', 'delivered')";
  const [items, stats, latest] = await Promise.all([
    db
      .prepare(
        `SELECT i.id, i.wishlist_id, i.quantity, p.title, p.image_key,
                (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND o.status IN ${SOLD}) AS bought,
                (SELECT COUNT(DISTINCT o.giver_phone) FROM orders o WHERE o.item_id = i.id AND o.status IN ${SOLD}) AS givers
         FROM wishlist_items i JOIN wishlists w ON w.id = i.wishlist_id JOIN products p ON p.id = i.product_id
         WHERE w.user_id = ? AND w.is_open = 1 AND w.is_direct = 0 ORDER BY i.created_at DESC LIMIT 30`,
      )
      .bind(user.id)
      .all<ProfileItem>(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM wishlist_items i JOIN wishlists w ON w.id = i.wishlist_id WHERE w.user_id = ?1 AND w.is_direct = 0) AS wishes,
                (SELECT COUNT(*) FROM orders o JOIN wishlists w ON w.id = o.wishlist_id WHERE w.user_id = ?1 AND w.is_direct = 0 AND o.status IN ${SOLD}) AS gifts`,
      )
      .bind(user.id)
      .first<{ wishes: number; gifts: number }>(),
    db.prepare("SELECT slug FROM wishlists WHERE user_id = ? AND is_direct = 0 ORDER BY created_at DESC LIMIT 1").bind(user.id).first<{ slug: string }>(),
  ]);
  const s = c.get("settings");
  const bots = activeBots(s).map((k) => ({ kind: k, connected: !!(k === "bale" ? user.bale_chat_id : user.telegram_chat_id) }));
  const { results: changes } = await db
    .prepare("SELECT o.id, o.product_title FROM orders o JOIN wishlists w ON w.id = o.wishlist_id WHERE w.user_id = ? AND o.change_status = 'pending'")
    .bind(user.id)
    .all<{ id: number; product_title: string }>();
  return render(
    c,
    <ProfilePage changes={changes} user={user} stats={stats ?? { wishes: 0, gifts: 0 }} items={items.results} shareUrl={user.username ? `${siteUrl(c)}/u/${user.username}` : latest ? `${siteUrl(c)}/w/${latest.slug}` : ""} bots={bots} />,
  );
});

async function settingsView(c: C, extra: { error?: string; saved?: boolean; values?: Record<string, string> } = {}, status: 200 | 400 = 200) {
  const user = (await sessionUserById(c.env.DB, currentUser(c).id))!;
  const s = c.get("settings");
  const token = await connectToken(c.env.DB, user.id);
  const bots = activeBots(s).map((k) => ({
    kind: k,
    connected: !!(k === "bale" ? user.bale_chat_id : user.telegram_chat_id),
    link: botLink(s, k, token),
  }));
  return render(c, <ProfileSettingsPage user={user} bots={bots} origin={siteUrl(c)} {...extra} />, status);
}

account.get("/me/settings", (c) => settingsView(c, { saved: c.req.query("saved") === "1" }));

account.post("/me/settings", async (c) => {
  const user = currentUser(c);
  const body = await c.req.parseBody();
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") f[k] = v.trim();
  let avatar = user.avatar_key;
  const file = fileField(body.avatar);
  if (file) {
    const err = imageError(file, 2, "عکس پروفایل");
    if (err) return settingsView(c, { error: err, values: f }, 400);
  }
  const error = await saveProfile(c, user.id, f, {
    show_received: f.show_received === "1" ? 1 : 0,
    show_givers: f.show_givers === "1" ? 1 : 0,
    show_birthday: f.show_birthday === "1" ? 1 : 0,
  });
  if (error) return settingsView(c, { error, values: f }, 400);
  if (file) avatar = await storeImage(c.env.IMAGES, file, "a");
  else if (f.remove_avatar === "1") avatar = "";
  await c.env.DB.prepare("UPDATE users SET avatar_key = ? WHERE id = ?").bind(avatar, user.id).run();
  if (user.avatar_key && user.avatar_key !== avatar) c.executionCtx.waitUntil(c.env.IMAGES.delete(user.avatar_key));
  return c.redirect("/me/settings?saved=1");
});

account.get("/me/wishlists", async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, (SELECT COUNT(*) FROM wishlist_items i WHERE i.wishlist_id = w.id) AS items,
            COALESCE((SELECT p.image_key FROM wishlist_items i JOIN products p ON p.id = i.product_id
                      WHERE i.wishlist_id = w.id ORDER BY i.created_at LIMIT 1), '') AS cover
     FROM wishlists w WHERE w.user_id = ? AND w.is_direct = 0 ORDER BY w.created_at DESC`,
  )
    .bind(user.id)
    .all<Wishlist & { items: number; cover: string }>();
  return render(c, <MyWishlistsPage user={user} lists={results} siteUrl={siteUrl(c)} />);
});

function cleanWishlist(f: Record<string, string>) {
  const values = {
    title: f.title ?? "",
    description: f.description ?? "",
    occasion_date: f.occasion_date ?? "",
    recipient_name: f.recipient_name ?? "",
    recipient_phone: normalizePhone(f.recipient_phone ?? ""),
    address: f.address ?? "",
    postal_code: normalizeDigits(f.postal_code ?? ""),
    city: normCity(f.city ?? ""),
    is_open: f.is_open === "1" ? "1" : "0",
  };
  const errors: string[] = [];
  if (!values.title) errors.push("عنوان لیست لازم است.");
  if (!values.recipient_name || !values.address) errors.push("نام گیرنده و آدرس برای ارسال لازم است.");
  if (!MOBILE.test(values.recipient_phone)) errors.push("موبایل گیرنده نامعتبر است.");
  if (!/^\d{10}$/.test(values.postal_code)) errors.push("کد پستی باید ۱۰ رقم باشد.");
  if (!values.city) errors.push("شهر گیرنده را انتخاب کنید.");
  return { values, errors };
}

async function ownWishlist(c: C) {
  return c.env.DB.prepare("SELECT * FROM wishlists WHERE id = ? AND user_id = ? AND is_direct = 0").bind(intParam(c, "id"), currentUser(c).id).first<Wishlist>();
}

async function addItem(db: D1Database, wishlistId: number, productId: number, quantity = 1, note = "", size = "", color = "") {
  await db
    .prepare(
      `INSERT INTO wishlist_items (wishlist_id, product_id, quantity, note, size, color, created_at)
       SELECT ?, p.id, ?, ?, ?, ?, ? FROM products p WHERE p.id = ? AND p.is_active = 1
       ON CONFLICT (wishlist_id, product_id) DO UPDATE SET quantity = excluded.quantity, note = excluded.note, size = excluded.size, color = excluded.color`,
    )
    .bind(wishlistId, quantity, note, size, color, now(), productId)
    .run();
}

/** A product's size table and colors (to validate the variant a form picked). */
const productOptions = async (db: D1Database, productId: number) =>
  (await db.prepare("SELECT size_guide, colors FROM products WHERE id = ?").bind(productId).first<{ size_guide: string; colors: string }>()) ?? {
    size_guide: "",
    colors: "",
  };

account.get("/me/wishlists/new", async (c) => {
  const user = currentUser(c);
  // Prefill delivery details from the user's latest list.
  const last = await c.env.DB.prepare("SELECT * FROM wishlists WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(user.id).first<Wishlist>();
  const values: Record<string, string> = last
    ? { recipient_name: last.recipient_name, recipient_phone: last.recipient_phone, address: last.address, postal_code: last.postal_code, city: last.city }
    : { recipient_name: user.name, recipient_phone: user.phone };
  return render(c, <WishlistFormPage user={user} wishlist={null} values={values} productId={c.req.query("product")} siteUrl={siteUrl(c)} />);
});

account.post("/me/wishlists/new", async (c) => {
  const user = currentUser(c);
  const f = await form(c);
  const { values, errors } = cleanWishlist({ ...f, is_open: "1" });
  if (errors.length) return render(c, <WishlistFormPage user={user} wishlist={null} values={values} errors={errors} productId={f.product} siteUrl={siteUrl(c)} />, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO wishlists (user_id, slug, title, description, occasion_date, recipient_name, recipient_phone, address, postal_code, city, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(user.id, randomSlug(), values.title, values.description, values.occasion_date, values.recipient_name, values.recipient_phone, values.address, values.postal_code, values.city, now())
    .first<{ id: number }>();
  if (f.product) {
    // A product with sizes needs the owner to pick one, so send them back to the product page for it.
    if (hasChoice(await productOptions(c.env.DB, Number(f.product)))) return c.redirect(`/p/${Number(f.product)}?pick=1`);
    await addItem(c.env.DB, row!.id, Number(f.product));
  }
  return c.redirect(`/me/wishlists/${row!.id}?saved=1`);
});

account.get("/me/wishlists/:id{[0-9]+}", async (c) => {
  const user = currentUser(c);
  const w = await ownWishlist(c);
  if (!w) return c.notFound();
  const [items, gifts] = await Promise.all([
    wishlistItems(c.env.DB, w.id),
    c.env.DB.prepare("SELECT * FROM orders WHERE wishlist_id = ? AND status IN ('paid', 'shipped', 'delivered') ORDER BY paid_at DESC").bind(w.id).all<Order>(),
  ]);
  const values = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, String(v)]));
  return render(c, 
    <WishlistFormPage user={user} wishlist={w} values={values} items={items} gifts={gifts.results} siteUrl={siteUrl(c)} saved={c.req.query("saved") === "1"} />,
  );
});

account.post("/me/wishlists/:id{[0-9]+}", async (c) => {
  const user = currentUser(c);
  const w = await ownWishlist(c);
  if (!w) return c.notFound();
  const { values, errors } = cleanWishlist(await form(c));
  if (errors.length) {
    return render(c, <WishlistFormPage user={user} wishlist={w} values={values} errors={errors} items={await wishlistItems(c.env.DB, w.id)} siteUrl={siteUrl(c)} />, 400);
  }
  await c.env.DB.prepare(
    `UPDATE wishlists SET title = ?, description = ?, occasion_date = ?, recipient_name = ?, recipient_phone = ?,
       address = ?, postal_code = ?, city = ?, is_open = ? WHERE id = ?`,
  )
    .bind(values.title, values.description, values.occasion_date, values.recipient_name, values.recipient_phone, values.address, values.postal_code, values.city, Number(values.is_open), w.id)
    .run();
  return c.redirect(`/me/wishlists/${w.id}?saved=1`);
});

account.post("/me/items/:id{[0-9]+}/delete", async (c) => {
  const user = currentUser(c);
  const item = await c.env.DB.prepare(
    `SELECT i.id, i.wishlist_id FROM wishlist_items i JOIN wishlists w ON w.id = i.wishlist_id WHERE i.id = ? AND w.user_id = ?`,
  )
    .bind(intParam(c, "id"), user.id)
    .first<{ id: number; wishlist_id: number }>();
  if (!item) return c.notFound();
  // Items that ever had an order are kept so order history stays intact.
  await c.env.DB.prepare("DELETE FROM wishlist_items WHERE id = ? AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.item_id = ?)")
    .bind(item.id, item.id)
    .run();
  return c.redirect(`/me/wishlists/${item.wishlist_id}`);
});

account.post("/p/:id{[0-9]+}/wish", async (c) => {
  const user = currentUser(c);
  const f = await form(c);
  const w = await c.env.DB.prepare("SELECT id, title FROM wishlists WHERE id = ? AND user_id = ? AND is_direct = 0").bind(Number(f.wishlist_id), user.id).first<{ id: number; title: string }>();
  if (!w) return c.text("لیست پیدا نشد", 404);
  const qty = Math.min(20, Math.max(1, Math.floor(Number(f.quantity) || 1)));
  const options = await productOptions(c.env.DB, intParam(c, "id"));
  const v = pickVariant(options, hasChoice(options) ? f.variant : "|");
  if (!v) return c.redirect(`/p/${intParam(c, "id")}?err=size`);
  await addItem(c.env.DB, w.id, intParam(c, "id"), qty, (f.note ?? "").slice(0, 200), v.size, v.color);
  return c.redirect(`/p/${intParam(c, "id")}?added=${encodeURIComponent(w.title)}`);
});

// ---------- buy for myself ----------
// A direct purchase is a hidden, single-item list holding the buyer's own address; it then goes
// through the same checkout, reservation and card-to-card flow as a gift.

async function directBuyPage(c: C, values: Record<string, string>, errors?: string[], status: 200 | 400 = 200) {
  const product = await getPublicProduct(c.env.DB, intParam(c, "id"));
  if (!product) return c.notFound();
  const image = (await productImages(c.env.DB, product.id))[0]?.image_key ?? product.image_key;
  const available = await availableByVariant(c.env.DB, product);
  return render(c, <DirectBuyPage user={currentUser(c)} product={product} image={image} available={available} values={values} errors={errors} />, status);
}

account.get("/p/:id{[0-9]+}/buy", async (c) => {
  const user = currentUser(c);
  // Prefill from the last address this person used.
  const last = await c.env.DB.prepare("SELECT * FROM wishlists WHERE user_id = ? ORDER BY is_direct DESC, id DESC LIMIT 1").bind(user.id).first<Wishlist>();
  const values: Record<string, string> = last?.is_direct
    ? { recipient_name: last.recipient_name, recipient_phone: last.recipient_phone, address: last.address, postal_code: last.postal_code, city: last.city }
    : { recipient_name: user.name, recipient_phone: user.phone, city: last?.city ?? "" };
  return directBuyPage(c, values);
});

account.post("/p/:id{[0-9]+}/buy", async (c) => {
  const user = currentUser(c);
  const productId = intParam(c, "id");
  const product = await getPublicProduct(c.env.DB, productId);
  if (!product) return c.notFound();
  const f = await form(c);
  const { values, errors } = cleanWishlist({ ...f, title: `خرید مستقیم: ${product.title}`.slice(0, 120), is_open: "1" });
  const v = pickVariant(product, hasChoice(product) ? f.variant : "|");
  if (!v) errors.push("سایز / رنگ را انتخاب کنید.");
  const available = await availableByVariant(c.env.DB, product);
  if (v && available && !errors.length && !available[v.key]) errors.push(v.label ? `${v.label} ناموجود است.` : "این محصول ناموجود است.");
  if (errors.length) return directBuyPage(c, { ...f, ...values }, errors, 400);
  const db = c.env.DB;
  const w = await db
    .prepare(
      `INSERT INTO wishlists (user_id, slug, title, description, occasion_date, recipient_name, recipient_phone, address, postal_code, city, is_direct, created_at)
       VALUES (?, ?, ?, '', '', ?, ?, ?, ?, ?, 1, ?) RETURNING id`,
    )
    .bind(user.id, randomSlug(), values.title, values.recipient_name, values.recipient_phone, values.address, values.postal_code, values.city, now())
    .first<{ id: number }>();
  await addItem(db, w!.id, productId, 1, (f.note ?? "").slice(0, 200), v!.size, v!.color);
  const item = await db.prepare("SELECT id FROM wishlist_items WHERE wishlist_id = ?").bind(w!.id).first<{ id: number }>();
  if (!item) return directBuyPage(c, { ...f, ...values }, ["این محصول دیگر قابل خرید نیست."], 400);
  return c.redirect(`/gift/${item.id}`);
});

account.get("/me/orders", async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT o.token, o.id, o.product_title, o.amount, o.status, o.cancel_kind, o.created_at, w.is_direct, u.name AS owner_name,
            COALESCE(p.image_key, '') AS image_key
     FROM orders o JOIN wishlists w ON w.id = o.wishlist_id JOIN users u ON u.id = w.user_id LEFT JOIN products p ON p.id = o.product_id
     WHERE o.giver_phone = ? ORDER BY o.created_at DESC LIMIT 100`,
  )
    .bind(user.phone)
    .all<MyOrder>();
  return render(c, <MyOrdersPage user={user} orders={results} />);
});

// ---------- the recipient answers an out-of-stock change proposal ----------

const changeOrder = (c: C) =>
  c.env.DB.prepare(
    `SELECT o.*, COALESCE(p.image_key, '') AS image_key, s.name AS shop_name
     FROM orders o JOIN wishlists w ON w.id = o.wishlist_id JOIN shops s ON s.id = o.shop_id LEFT JOIN products p ON p.id = o.product_id
     WHERE o.id = ? AND w.user_id = ? AND o.change_status <> ''`,
  )
    .bind(intParam(c, "id"), currentUser(c).id)
    .first<Order & { image_key: string; shop_name: string }>();

account.get("/me/changes/:id{[0-9]+}", async (c) => {
  const order = await changeOrder(c);
  if (!order) return c.notFound();
  return render(c, <ChangeRequestPage user={currentUser(c)} order={order} />);
});

account.post("/me/changes/:id{[0-9]+}", async (c) => {
  const f = await form(c);
  const deps = { db: c.env.DB, images: c.env.IMAGES, settings: c.get("settings"), siteUrl: siteUrl(c) };
  await answerChange(deps, intParam(c, "id"), currentUser(c).id, f.answer === "accept", (f.reply ?? "").slice(0, 200));
  return c.redirect(`/me/changes/${intParam(c, "id")}`);
});
