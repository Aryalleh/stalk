import { Hono } from "hono";
import { hashPassword } from "../../lib/auth";
import { normalizePhone } from "../../lib/normalize";
import type { C as Ctx, Env } from "../env";
import { canUseCrm, type User } from "../session";
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
import { formatJalali, parseJalali } from "../../lib/jalali";
import {
  ContactPage,
  FieldHistoryPage,
  FieldsPage,
  HistoryPage,
  ListPage,
  SnapshotPage,
  UsersPage,
} from "./views/pages";

// Mounted at /crm. Uses the site-wide login; only staff and platform admins get in.
export const crm = new Hono<Env>();

crm.use(async (c, next) => {
  const user = c.get("user");
  if (!user) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  if (!canUseCrm(user)) return c.text("دسترسی به CRM ندارید", 403);
  await next();
});

type C = Ctx;
const me = (c: C) => c.get("user") as User;

const requireAdmin = async (c: C, next: () => Promise<void>) => {
  if (!me(c).is_admin) return c.text("دسترسی ندارید", 403);
  await next();
};

const pageParam = (c: C) => Math.max(1, Number(c.req.query("page")) || 1);
const idParam = (c: C) => Number(c.req.param("id"));

// ---------- contacts ----------

crm.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const page = pageParam(c);
  const rows = await searchContacts(c.env.DB, q, page);
  return c.html(
    <ListPage user={me(c)} q={q} page={page} rows={rows.slice(0, PAGE_SIZE)} hasNext={rows.length > PAGE_SIZE} />,
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
  const user = me(c);
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
    return c.redirect(`/crm/contacts/${savedId}?saved=1`);
  } catch (e) {
    if (e instanceof DuplicateNationalCode) {
      const other = await c.env.DB.prepare("SELECT id FROM contacts WHERE national_code = ?").bind(data.national_code).first<{ id: number }>();
      errors.national_code = `مخاطبی با این کد ملی قبلاً ثبت شده است${other ? ` (#${other.id})` : ""}.`;
      return render(["کد ملی تکراری است."], 409);
    }
    throw e;
  }
}

crm.get("/contacts/new", async (c) => {
  const defs = await getFieldDefs(c.env.DB);
  return c.html(<ContactPage user={me(c)} contact={null} data={{}} extras={new Map()} defs={defs} />);
});

crm.post("/contacts/new", (c) => handleSave(c, null));

crm.get("/contacts/:id{[0-9]+}", async (c) => {
  const id = idParam(c);
  const contact = await getContact(c.env.DB, id);
  if (!contact) return c.notFound();
  const [extras, defs, logs] = await Promise.all([getExtras(c.env.DB, id), getFieldDefs(c.env.DB), getLogs(c.env.DB, id)]);
  return c.html(
    <ContactPage user={me(c)} contact={contact} data={contact} extras={extras} defs={defs} logs={logs} saved={c.req.query("saved") === "1"} />,
  );
});

crm.post("/contacts/:id{[0-9]+}", (c) => handleSave(c, idParam(c)));

crm.post("/contacts/:id{[0-9]+}/delete", async (c) => {
  const defs = await getFieldDefs(c.env.DB);
  await deleteContact(c.env.DB, idParam(c), new Map(defs.map((d) => [d.id, d.name])), me(c));
  return c.redirect("/crm");
});

async function nameForHistory(c: C, id: number) {
  const contact = await getContact(c.env.DB, id);
  if (contact) return contactName(contact);
  const last = await c.env.DB.prepare("SELECT contact_repr FROM change_log WHERE contact_id = ? ORDER BY id DESC LIMIT 1")
    .bind(id)
    .first<{ contact_repr: string }>();
  return last ? `${last.contact_repr} (حذف‌شده)` : null;
}

crm.get("/contacts/:id{[0-9]+}/history", async (c) => {
  const id = idParam(c);
  const field = c.req.query("field") ?? "";
  const name = await nameForHistory(c, id);
  if (!name) return c.notFound();
  const logs = await getLogs(c.env.DB, id, field || undefined);
  const label = logs[0]?.field_label ?? fieldLabel(field);
  return c.html(<FieldHistoryPage user={me(c)} contactId={id} name={name} label={label} logs={logs} />);
});

crm.get("/contacts/:id{[0-9]+}/snapshot", async (c) => {
  const id = idParam(c);
  const name = await nameForHistory(c, id);
  if (!name) return c.notFound();
  const atText = (c.req.query("at") ?? "").trim();
  const at = atText ? parseJalali(atText) : new Date().toISOString();
  const props = { user: me(c), contactId: id, name, atText: atText || formatJalali(at) };
  if (!at) return c.html(<SnapshotPage {...props} snap={null} error="تاریخ نامعتبر است. نمونه: 1405/07/09 14:30" />, 400);
  return c.html(<SnapshotPage {...props} snap={buildSnapshot(await getLogs(c.env.DB, id), at)} />);
});

crm.get("/history", async (c) => {
  const page = pageParam(c);
  const logs = await recentLogs(c.env.DB, page);
  return c.html(<HistoryPage user={me(c)} logs={logs.slice(0, PAGE_SIZE)} page={page} hasNext={logs.length > PAGE_SIZE} />);
});

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Prefix formula-looking cells so Excel doesn't execute them; quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^\+?\d+$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

crm.get("/export.csv", async (c) => {
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

crm.get("/fields", async (c) => c.html(<FieldsPage user={me(c)} defs={await getFieldDefs(c.env.DB)} />));

async function saveFieldName(c: C, id: number | null) {
  const name = String((await c.req.parseBody()).name ?? "").trim();
  const fail = async (error: string) =>
    c.html(<FieldsPage user={me(c)} defs={await getFieldDefs(c.env.DB)} error={error} />, 400);
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
  return c.redirect("/crm/fields");
}

crm.post("/fields", requireAdmin, (c) => saveFieldName(c, null));
crm.post("/fields/:id{[0-9]+}/rename", requireAdmin, (c) => saveFieldName(c, idParam(c)));

// ---------- staff (admin): which site users may use the CRM ----------

async function staffPage(c: C, extra: { error?: string; ok?: string } = {}, status: 200 | 400 = 200) {
  const { results } = await c.env.DB.prepare(
    "SELECT id, phone, name, is_admin, is_staff, created_at FROM users WHERE is_staff = 1 OR is_admin = 1 ORDER BY id",
  ).all<User & { created_at: string }>();
  return c.html(<UsersPage user={me(c)} users={results} {...extra} />, status);
}

crm.get("/users", requireAdmin, (c) => staffPage(c));

crm.post("/users", requireAdmin, async (c) => {
  const form = await c.req.parseBody();
  const phone = normalizePhone(String(form.phone ?? ""));
  const name = String(form.name ?? "").trim();
  const password = String(form.password ?? "");
  if (!/^09\d{9}$/.test(phone)) return staffPage(c, { error: "شماره موبایل نامعتبر است." }, 400);
  const existing = await c.env.DB.prepare("SELECT id, name FROM users WHERE phone = ?").bind(phone).first<{ id: number; name: string }>();
  if (existing) {
    await c.env.DB.prepare("UPDATE users SET is_staff = 1 WHERE id = ?").bind(existing.id).run();
    return staffPage(c, { ok: `دسترسی CRM به ${existing.name} داده شد.` });
  }
  if (!name || password.length < 10) {
    return staffPage(c, { error: "این شماره هنوز در سایت حساب ندارد؛ برای ساختن حساب، نام و رمز حداقل ۱۰ کاراکتری لازم است." }, 400);
  }
  await c.env.DB.prepare("INSERT INTO users (phone, name, password_hash, is_staff, created_at) VALUES (?, ?, ?, 1, ?)")
    .bind(phone, name, await hashPassword(password), new Date().toISOString())
    .run();
  return staffPage(c, { ok: `حساب ${name} با دسترسی CRM ساخته شد.` });
});

crm.post("/users/:id{[0-9]+}/revoke", requireAdmin, async (c) => {
  const id = idParam(c);
  if (id !== me(c).id) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET is_staff = 0 WHERE id = ?").bind(id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    ]);
  }
  return c.redirect("/crm/users");
});
