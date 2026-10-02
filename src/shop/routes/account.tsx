import { Hono } from "hono";
import { render } from "../../render";
import { deleteCookie, getCookie } from "hono/cookie";
import { deleteSession, hashPassword, verifyPassword } from "../../../lib/auth";
import { normalizeDigits, normalizePhone } from "../../../lib/normalize";
import { normCity, now, randomSlug, wishlistItems, type Order, type Wishlist } from "../db";
import { upsertCustomer } from "../../crm/sync";
import type { C, Env } from "../../env";
import { SESSION_COOKIE } from "../../session";
import { cancelCode, issueCode, verifyCode } from "../../bale/otp";
import { SafirError, sendSafirOtp } from "../../bale/safir";
import { safirReady } from "../../settings";
import { CodeLoginPage, LoginPage, MyWishlistsPage, RegisterPage, WishlistFormPage } from "../views/account";
import { SetupPage } from "../views/panel";
import { currentUser, form, intParam, safeNext, siteUrl, startSession } from "./helpers";

export const account = new Hono<Env>();
const MOBILE = /^09\d{9}$/;

account.get("/login", (c) => render(c, <LoginPage next={safeNext(c.req.query("next"))} codeLogin={safirReady(c.get("settings"))} />));

account.post("/login", async (c) => {
  const f = await form(c);
  const phone = normalizePhone(f.phone);
  const user = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE phone = ?").bind(phone).first<{ id: number; password_hash: string }>();
  if (!user || !(await verifyPassword(f.password ?? "", user.password_hash))) {
    return render(c, <LoginPage next={safeNext(f.next)} phone={f.phone} codeLogin={safirReady(c.get("settings"))} error="شماره موبایل یا رمز عبور اشتباه است." />, 401);
  }
  return startSession(c, user.id, f.next);
});

account.get("/register", (c) => render(c, <RegisterPage next={safeNext(c.req.query("next"))} codeLogin={safirReady(c.get("settings"))} />));

account.post("/register", async (c) => {
  const f = await form(c);
  const phone = normalizePhone(f.phone);
  const errors: string[] = [];
  if (!f.name) errors.push("نام لازم است.");
  if (!MOBILE.test(phone)) errors.push("شماره موبایل نامعتبر است.");
  if ((f.password ?? "").length < 8) errors.push("رمز عبور باید حداقل ۸ کاراکتر باشد.");
  const fail = (errs: string[]) => render(c, <RegisterPage next={safeNext(f.next)} errors={errs} values={f} />, 400);
  if (errors.length) return fail(errors);
  const row = await c.env.DB.prepare("INSERT INTO users (phone, name, password_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (phone) DO NOTHING RETURNING id")
    .bind(phone, f.name, await hashPassword(f.password), now())
    .first<{ id: number }>();
  if (!row) return fail(["این شماره قبلاً ثبت‌نام کرده است. وارد شوید."]);
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: f.name, phone, source: "ثبت‌نام در سایت" }));
  return startSession(c, row.id, f.next);
});

// ---------- login / sign-up with a one-time code sent in Bale (Safir) ----------

account.get("/login/code", (c) => {
  if (!safirReady(c.get("settings"))) return c.redirect("/login");
  return render(c, <CodeLoginPage next={safeNext(c.req.query("next"))} step="phone" />);
});

account.post("/login/code", async (c) => {
  const s = c.get("settings");
  if (!safirReady(s)) return c.redirect("/login");
  const f = await form(c);
  const next = safeNext(f.next);
  const phone = normalizePhone(f.phone ?? "");
  const again = (error: string) => render(c, <CodeLoginPage next={next} step="phone" phone={f.phone} error={error} />, 400);
  if (!MOBILE.test(phone)) return again("شماره موبایل نامعتبر است.");
  const issued = await issueCode(c.env.DB, phone);
  if ("wait" in issued) return again(issued.wait);
  try {
    await sendSafirOtp(s, phone, issued.code);
  } catch (e) {
    await cancelCode(c.env.DB, phone);
    console.error(e);
    return again(e instanceof SafirError ? e.message : "ارسال کد ناموفق بود؛ دوباره تلاش کنید.");
  }
  return c.redirect(`/login/code/verify?phone=${phone}&next=${encodeURIComponent(next)}`);
});

const userByPhone = (c: C, phone: string) => c.env.DB.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: number }>();

account.get("/login/code/verify", async (c) => {
  const phone = normalizePhone(c.req.query("phone") ?? "");
  if (!MOBILE.test(phone)) return c.redirect("/login/code");
  const isNew = !(await userByPhone(c, phone));
  return render(c, <CodeLoginPage next={safeNext(c.req.query("next"))} step="code" phone={phone} isNew={isNew} />);
});

account.post("/login/code/verify", async (c) => {
  const f = await form(c);
  const next = safeNext(f.next);
  const phone = normalizePhone(f.phone ?? "");
  if (!MOBILE.test(phone)) return c.redirect("/login/code");
  const existing = await userByPhone(c, phone);
  const fail = (error: string) => render(c, <CodeLoginPage next={next} step="code" phone={phone} isNew={!existing} name={f.name} error={error} />, 400);
  if (!existing && !f.name) return fail("نام و نام خانوادگی را وارد کنید.");
  const ok = await verifyCode(c.env.DB, phone, normalizeDigits(f.code ?? ""));
  if (ok !== true) return fail(ok);
  if (existing) return startSession(c, existing.id, next);
  // New account without a password ("!" never matches a hash); they can always log in with a code.
  const row = await c.env.DB.prepare("INSERT INTO users (phone, name, password_hash, created_at) VALUES (?, ?, '!', ?) ON CONFLICT (phone) DO NOTHING RETURNING id")
    .bind(phone, f.name.slice(0, 80), now())
    .first<{ id: number }>();
  const id = row?.id ?? (await userByPhone(c, phone))!.id;
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: f.name, phone, source: "ثبت‌نام در سایت (کد بله)" }));
  return startSession(c, id, next);
});

account.post("/logout", async (c) => {
  await deleteSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.redirect("/");
});

// The first person to complete /setup becomes platform admin; the page closes once an admin exists,
// so run it right after deploying.
const hasAdmin = async (c: C) => !!(await c.env.DB.prepare("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1").first());

account.get("/setup", async (c) => {
  if (await hasAdmin(c)) return c.redirect("/login");
  return render(c, <SetupPage />);
});

account.post("/setup", async (c) => {
  if (await hasAdmin(c)) return c.redirect("/login");
  const f = await form(c);
  const phone = normalizePhone(f.phone);
  if (!f.name || !MOBILE.test(phone) || (f.password ?? "").length < 10) {
    return render(c, <SetupPage error="نام، موبایل معتبر و رمز حداقل ۱۰ کاراکتری لازم است." values={f} />, 400);
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO users (phone, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (phone) DO NOTHING RETURNING id",
  )
    .bind(phone, f.name, await hashPassword(f.password), now())
    .first<{ id: number }>();
  if (!row) return render(c, <SetupPage error="این شماره قبلاً در سایت حساب دارد؛ شماره دیگری وارد کنید." values={f} />, 400);
  c.executionCtx.waitUntil(upsertCustomer(c.env.DB, { name: f.name, phone, source: "مدیر سایت" }));
  return startSession(c, row.id, "/admin/settings");
});

// ---------- my wishlists (login required; enforced in index) ----------

account.get("/me/wishlists", async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, (SELECT COUNT(*) FROM wishlist_items i WHERE i.wishlist_id = w.id) AS items
     FROM wishlists w WHERE w.user_id = ? ORDER BY w.created_at DESC`,
  )
    .bind(user.id)
    .all<Wishlist & { items: number }>();
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
  return c.env.DB.prepare("SELECT * FROM wishlists WHERE id = ? AND user_id = ?").bind(intParam(c, "id"), currentUser(c).id).first<Wishlist>();
}

async function addItem(db: D1Database, wishlistId: number, productId: number, quantity = 1, note = "") {
  await db
    .prepare(
      `INSERT INTO wishlist_items (wishlist_id, product_id, quantity, note, created_at)
       SELECT ?, p.id, ?, ?, ? FROM products p WHERE p.id = ? AND p.is_active = 1
       ON CONFLICT (wishlist_id, product_id) DO UPDATE SET quantity = excluded.quantity, note = excluded.note`,
    )
    .bind(wishlistId, quantity, note, now(), productId)
    .run();
}

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
  if (f.product) await addItem(c.env.DB, row!.id, Number(f.product));
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
  const w = await c.env.DB.prepare("SELECT id, title FROM wishlists WHERE id = ? AND user_id = ?").bind(Number(f.wishlist_id), user.id).first<{ id: number; title: string }>();
  if (!w) return c.text("لیست پیدا نشد", 404);
  const qty = Math.min(20, Math.max(1, Math.floor(Number(f.quantity) || 1)));
  await addItem(c.env.DB, w.id, intParam(c, "id"), qty, (f.note ?? "").slice(0, 200));
  return c.redirect(`/p/${intParam(c, "id")}?added=${encodeURIComponent(w.title)}`);
});
