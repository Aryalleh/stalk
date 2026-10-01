import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  hashPassword,
  safeEqual,
  sessionUser,
  verifyPassword,
  type User,
} from "./auth";
import {
  DuplicateNationalCode,
  PAGE_SIZE,
  allContactsWithExtras,
  deleteContact,
  getContact,
  getExtras,
  getFieldDefs,
  getLogs,
  recentLogs,
  saveContact,
  searchContacts,
} from "./db";
import { CORE_FIELDS, CORE_NAMES, cleanContact, contactName, fieldLabel } from "./fields";
import { buildSnapshot, type Extras } from "./history";
import { formatJalali, parseJalali } from "./jalali";
import {
  AccountPage,
  ContactPage,
  FieldHistoryPage,
  FieldsPage,
  HistoryPage,
  ListPage,
  LoginPage,
  SetupPage,
  SnapshotPage,
  UsersPage,
} from "./views/pages";

type Env = { Bindings: { DB: D1Database; SETUP_TOKEN?: string }; Variables: { user: User } };
type C = Context<Env>;

const app = new Hono<Env>();

app.use(secureHeaders());
app.use(csrf()); // rejects cross-origin form POSTs

const PUBLIC = new Set(["/login", "/setup"]);

app.use(async (c, next) => {
  if (PUBLIC.has(c.req.path)) return next();
  const user = await sessionUser(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!user) {
    const anyUser = await c.env.DB.prepare("SELECT 1 FROM users LIMIT 1").first();
    return c.redirect(anyUser ? "/login" : "/setup");
  }
  c.set("user", user);
  await next();
});

const requireAdmin = async (c: C, next: () => Promise<void>) => {
  if (!c.get("user").is_admin) return c.text("دسترسی ندارید", 403);
  await next();
};

const pageParam = (c: C) => Math.max(1, Number(c.req.query("page")) || 1);
const idParam = (c: C) => Number(c.req.param("id"));

async function startSession(c: C, userId: number) {
  const { token, maxAge } = await createSession(c.env.DB, userId);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge });
  return c.redirect("/");
}

// ---------- auth ----------

app.get("/login", (c) => c.html(<LoginPage />));

app.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const user = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE username = ?")
    .bind(String(form.username ?? "").trim())
    .first<{ id: number; password_hash: string }>();
  if (!user || !(await verifyPassword(String(form.password ?? ""), user.password_hash))) {
    return c.html(<LoginPage error="نام کاربری یا رمز عبور اشتباه است." />, 401);
  }
  return startSession(c, user.id);
});

app.post("/logout", async (c) => {
  await deleteSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.redirect("/login");
});

const hasUsers = async (c: C) => !!(await c.env.DB.prepare("SELECT 1 FROM users LIMIT 1").first());

app.get("/setup", async (c) => {
  if (await hasUsers(c)) return c.redirect("/login");
  return c.html(<SetupPage configured={!!c.env.SETUP_TOKEN} />);
});

app.post("/setup", async (c) => {
  if (await hasUsers(c)) return c.redirect("/login");
  const form = await c.req.parseBody();
  const username = String(form.username ?? "").trim();
  const password = String(form.password ?? "");
  const configured = !!c.env.SETUP_TOKEN;
  if (!configured || !safeEqual(String(form.token ?? ""), c.env.SETUP_TOKEN!)) {
    return c.html(<SetupPage configured={configured} error="SETUP_TOKEN اشتباه است." />, 403);
  }
  if (!username || password.length < 10) {
    return c.html(<SetupPage configured error="نام کاربری و رمز حداقل ۱۰ کاراکتری لازم است." />, 400);
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?) RETURNING id",
  )
    .bind(username, await hashPassword(password), new Date().toISOString())
    .first<{ id: number }>();
  return startSession(c, row!.id);
});

app.get("/account", (c) => c.html(<AccountPage user={c.get("user")} />));

app.post("/account", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(form.current ?? ""), row.password_hash))) {
    return c.html(<AccountPage user={user} error="رمز فعلی اشتباه است." />, 400);
  }
  const password = String(form.password ?? "");
  if (password.length < 10) return c.html(<AccountPage user={user} error="رمز جدید باید حداقل ۱۰ کاراکتر باشد." />, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), user.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  return startSession(c, user.id);
});

// ---------- contacts ----------

app.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const page = pageParam(c);
  const rows = await searchContacts(c.env.DB, q, page);
  return c.html(
    <ListPage user={c.get("user")} q={q} page={page} rows={rows.slice(0, PAGE_SIZE)} hasNext={rows.length > PAGE_SIZE} />,
  );
});

async function readForm(c: C) {
  const form = (await c.req.parseBody()) as Record<string, string>;
  const defs = await getFieldDefs(c.env.DB);
  const { data, errors } = cleanContact(form);
  const extras: Extras = new Map();
  for (const d of defs) {
    const v = String(form[`extra_${d.id}`] ?? "").trim();
    if (v) extras.set(d.id, v);
  }
  return { data, errors, extras, defs, labels: new Map(defs.map((d) => [d.id, d.name])) };
}

async function handleSave(c: C, id: number | null) {
  const user = c.get("user");
  const contact = id === null ? null : await getContact(c.env.DB, id);
  if (id !== null && !contact) return c.notFound();
  const { data, errors, extras, defs, labels } = await readForm(c);
  const render = (formErrors: string[], status: 400 | 409) =>
    c.html(
      <ContactPage user={user} contact={contact} data={data} extras={extras} defs={defs} errors={errors} formErrors={formErrors}
        logs={[]} />,
      status,
    );
  if (Object.keys(errors).length) return render(["لطفاً خطاهای فرم را برطرف کنید."], 400);
  if (CORE_NAMES.every((n) => !data[n]) && extras.size === 0) return render(["حداقل یک فیلد را پر کنید."], 400);
  try {
    const savedId = await saveContact(c.env.DB, id, data, extras, labels, user);
    return c.redirect(`/contacts/${savedId}?saved=1`);
  } catch (e) {
    if (e instanceof DuplicateNationalCode) {
      const other = await c.env.DB.prepare("SELECT id FROM contacts WHERE national_code = ?").bind(data.national_code).first<{ id: number }>();
      errors.national_code = `مخاطبی با این کد ملی قبلاً ثبت شده است${other ? ` (#${other.id})` : ""}.`;
      return render(["کد ملی تکراری است."], 409);
    }
    throw e;
  }
}

app.get("/contacts/new", async (c) => {
  const defs = await getFieldDefs(c.env.DB);
  return c.html(<ContactPage user={c.get("user")} contact={null} data={{}} extras={new Map()} defs={defs} />);
});

app.post("/contacts/new", (c) => handleSave(c, null));

app.get("/contacts/:id{[0-9]+}", async (c) => {
  const id = idParam(c);
  const contact = await getContact(c.env.DB, id);
  if (!contact) return c.notFound();
  const [extras, defs, logs] = await Promise.all([getExtras(c.env.DB, id), getFieldDefs(c.env.DB), getLogs(c.env.DB, id)]);
  return c.html(
    <ContactPage user={c.get("user")} contact={contact} data={contact} extras={extras} defs={defs} logs={logs} saved={c.req.query("saved") === "1"} />,
  );
});

app.post("/contacts/:id{[0-9]+}", (c) => handleSave(c, idParam(c)));

app.post("/contacts/:id{[0-9]+}/delete", async (c) => {
  const defs = await getFieldDefs(c.env.DB);
  await deleteContact(c.env.DB, idParam(c), new Map(defs.map((d) => [d.id, d.name])), c.get("user"));
  return c.redirect("/");
});

async function nameForHistory(c: C, id: number) {
  const contact = await getContact(c.env.DB, id);
  if (contact) return contactName(contact);
  const last = await c.env.DB.prepare("SELECT contact_repr FROM change_log WHERE contact_id = ? ORDER BY id DESC LIMIT 1")
    .bind(id)
    .first<{ contact_repr: string }>();
  return last ? `${last.contact_repr} (حذف‌شده)` : null;
}

app.get("/contacts/:id{[0-9]+}/history", async (c) => {
  const id = idParam(c);
  const field = c.req.query("field") ?? "";
  const name = await nameForHistory(c, id);
  if (!name) return c.notFound();
  const logs = await getLogs(c.env.DB, id, field || undefined);
  const label = logs[0]?.field_label ?? fieldLabel(field);
  return c.html(<FieldHistoryPage user={c.get("user")} contactId={id} name={name} label={label} logs={logs} />);
});

app.get("/contacts/:id{[0-9]+}/snapshot", async (c) => {
  const id = idParam(c);
  const name = await nameForHistory(c, id);
  if (!name) return c.notFound();
  const atText = (c.req.query("at") ?? "").trim();
  const at = atText ? parseJalali(atText) : new Date().toISOString();
  const props = { user: c.get("user"), contactId: id, name, atText: atText || formatJalali(at) };
  if (!at) return c.html(<SnapshotPage {...props} snap={null} error="تاریخ نامعتبر است. نمونه: 1405/07/09 14:30" />, 400);
  return c.html(<SnapshotPage {...props} snap={buildSnapshot(await getLogs(c.env.DB, id), at)} />);
});

app.get("/history", async (c) => {
  const page = pageParam(c);
  const logs = await recentLogs(c.env.DB, page);
  return c.html(<HistoryPage user={c.get("user")} logs={logs.slice(0, PAGE_SIZE)} page={page} hasNext={logs.length > PAGE_SIZE} />);
});

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Prefix formula-looking cells so Excel doesn't execute them; quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^\+?\d+$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

app.get("/export.csv", async (c) => {
  const q = c.req.query("q") ?? "";
  const defs = await getFieldDefs(c.env.DB);
  let rows = await allContactsWithExtras(c.env.DB);
  if (q) {
    const ids = new Set((await searchContacts(c.env.DB, q, 1)).map((r) => r.id));
    rows = rows.filter((r) => ids.has(r.contact.id));
  }
  const header = ["id", ...CORE_FIELDS.map((f) => f.label), ...defs.map((d) => d.name), "تاریخ ایجاد", "آخرین ویرایش"];
  const lines = [header.map(csvCell).join(",")];
  for (const { contact, extras } of rows) {
    lines.push(
      [contact.id, ...CORE_NAMES.map((n) => contact[n]), ...defs.map((d) => extras.get(d.id) ?? ""),
        formatJalali(contact.created_at), formatJalali(contact.updated_at)].map(csvCell).join(","),
    );
  }
  return c.body("﻿" + lines.join("\r\n"), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="contacts.csv"',
  });
});

// ---------- extra field definitions ----------

app.get("/fields", async (c) => c.html(<FieldsPage user={c.get("user")} defs={await getFieldDefs(c.env.DB)} />));

async function saveFieldName(c: C, id: number | null) {
  const name = String((await c.req.parseBody()).name ?? "").trim();
  const fail = async (error: string) =>
    c.html(<FieldsPage user={c.get("user")} defs={await getFieldDefs(c.env.DB)} error={error} />, 400);
  if (!name) return fail("عنوان فیلد لازم است.");
  if (CORE_FIELDS.some((f) => f.label === name)) return fail("این فیلد جزو فیلدهای اصلی است.");
  try {
    const stmt = id === null
      ? c.env.DB.prepare("INSERT INTO field_definitions (name) VALUES (?)").bind(name)
      : c.env.DB.prepare("UPDATE field_definitions SET name = ? WHERE id = ?").bind(name, id);
    await stmt.run();
  } catch {
    return fail("فیلدی با این عنوان وجود دارد.");
  }
  return c.redirect("/fields");
}

app.post("/fields", requireAdmin, (c) => saveFieldName(c, null));
app.post("/fields/:id{[0-9]+}/rename", requireAdmin, (c) => saveFieldName(c, idParam(c)));

// ---------- users (admin) ----------

async function usersPage(c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) {
  const { results } = await c.env.DB.prepare("SELECT id, username, is_admin, created_at FROM users ORDER BY id").all<
    User & { created_at: string }
  >();
  return c.html(<UsersPage user={c.get("user")} users={results} {...extra} />, status);
}

app.get("/users", requireAdmin, (c) => usersPage(c));

app.post("/users", requireAdmin, async (c) => {
  const form = await c.req.parseBody();
  const username = String(form.username ?? "").trim();
  const password = String(form.password ?? "");
  if (!username || password.length < 10) return usersPage(c, { error: "نام کاربری و رمز حداقل ۱۰ کاراکتری لازم است." }, 400);
  try {
    await c.env.DB.prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)")
      .bind(username, await hashPassword(password), form.is_admin === "1" ? 1 : 0, new Date().toISOString())
      .run();
  } catch {
    return usersPage(c, { error: "این نام کاربری وجود دارد." }, 400);
  }
  return usersPage(c, { ok: `کاربر ${username} ساخته شد.` });
});

app.post("/users/:id{[0-9]+}/delete", requireAdmin, async (c) => {
  const id = idParam(c);
  if (id !== c.get("user").id) await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.redirect("/users");
});

app.notFound((c) => c.text("پیدا نشد", 404));

export default app;
