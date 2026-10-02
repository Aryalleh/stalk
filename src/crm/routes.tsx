import { Hono } from "hono";
import { render } from "../render";
import { inviteLink, linksFor } from "../bale/links";
import { sendSafirText } from "../bale/safir";
import { safirReady } from "../settings";
import { sendBotMessage } from "../bale/botapi";
import { normalizePhone } from "../../lib/normalize";
import type { C as Ctx, Env } from "../env";
import { assignUsername, canUseCrm, type User } from "../session";
import {
  DuplicateNationalCode,
  PAGE_SIZE,
  allContactsWithExtras,
  contactMessages,
  deleteContact,
  getContact,
  getExtras,
  getFieldDefs,
  getLogs,
  logMessage,
  recentLogs,
  saveContact,
  searchContacts,
  type ContactRow,
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
  type Messaging,
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
  return render(c, 
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
  const renderForm = (formErrors: string[], status: 400 | 409) =>
    render(c, 
      <ContactPage user={user} contact={contact} data={data} extras={extras} defs={defs} errors={errors} formErrors={formErrors}
        logs={[]} />,
      status,
    );
  if (Object.keys(errors).length) return renderForm(["لطفاً خطاهای فرم را برطرف کنید."], 400);
  if (CORE_NAMES.every((n) => !data[n]) && extras.size === 0) return renderForm(["حداقل یک فیلد را پر کنید."], 400);
  try {
    const savedId = await saveContact(c.env.DB, id, data, extras, labels, user);
    return c.redirect(`/crm/contacts/${savedId}?saved=1`);
  } catch (e) {
    if (e instanceof DuplicateNationalCode) {
      const other = await c.env.DB.prepare("SELECT id FROM contacts WHERE national_code = ?").bind(data.national_code).first<{ id: number }>();
      errors.national_code = `مخاطبی با این کد ملی قبلاً ثبت شده است${other ? ` (#${other.id})` : ""}.`;
      return renderForm(["کد ملی تکراری است."], 409);
    }
    throw e;
  }
}

crm.get("/contacts/new", async (c) => {
  const defs = await getFieldDefs(c.env.DB);
  return render(c, <ContactPage user={me(c)} contact={null} data={{}} extras={new Map()} defs={defs} />);
});

crm.post("/contacts/new", (c) => handleSave(c, null));

crm.get("/contacts/:id{[0-9]+}", async (c) => {
  const id = idParam(c);
  const contact = await getContact(c.env.DB, id);
  if (!contact) return c.notFound();
  const [extras, defs, logs, messaging] = await Promise.all([
    getExtras(c.env.DB, id),
    getFieldDefs(c.env.DB),
    getLogs(c.env.DB, id),
    messagingInfo(c, contact),
  ]);
  return render(c, 
    <ContactPage
      user={me(c)}
      contact={contact}
      data={contact}
      extras={extras}
      defs={defs}
      logs={logs}
      saved={c.req.query("saved") === "1"}
      messaging={messaging}
      notice={MESSAGE_NOTICES[c.req.query("msg") ?? ""]}
    />,
  );
});

// ---------- messaging contacts in Bale ----------

const PHONE_FIELDS = ["phone", "phone2", "father_phone"] as const;
const MESSAGE_NOTICES: Record<string, { ok: boolean; text: string }> = {
  sent: { ok: true, text: "پیام ارسال شد." },
  failed: { ok: false, text: "ارسال پیام ناموفق بود؛ جزئیات در جدول پیام‌ها." },
};

async function messagingInfo(c: C, contact: ContactRow): Promise<Messaging> {
  const s = c.get("settings");
  const phones = PHONE_FIELDS.map((f) => ({ field: f, label: fieldLabel(f), phone: contact[f] })).filter((p) => /^09\d{9}$/.test(p.phone));
  const [links, messages] = await Promise.all([linksFor(c.env.DB, phones.map((p) => p.phone)), contactMessages(c.env.DB, contact.id)]);
  return {
    phones: phones.map((p) => ({ ...p, link: links.get(p.phone) ?? null })),
    botReady: !!s.bale_bot_token,
    safirReady: safirReady(s),
    invite: inviteLink(s.bale_bot_username),
    messages,
  };
}

crm.post("/contacts/:id{[0-9]+}/message", async (c) => {
  const id = idParam(c);
  const contact = await getContact(c.env.DB, id);
  if (!contact) return c.notFound();
  const s = c.get("settings");
  const f = await c.req.parseBody();
  const phone = String(f.phone ?? "");
  const text = String(f.text ?? "").trim().slice(0, 4000);
  const channel = f.channel === "safir" ? "safir" : "bot";
  if (!text || !PHONE_FIELDS.some((k) => contact[k] === phone)) return c.redirect(`/crm/contacts/${id}`);

  let error = "";
  try {
    if (channel === "bot") {
      const link = (await linksFor(c.env.DB, [phone])).get(phone);
      if (!link) throw new Error("این شماره هنوز به بات بله وصل نشده است.");
      await sendBotMessage(s, "bale", link.chat_id, text);
    } else {
      await sendSafirText(s, phone, text);
    }
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  const user = me(c);
  await logMessage(c.env.DB, {
    contact_id: id, phone, channel, text, status: error ? "failed" : "sent", error, user_id: user.id, username: user.name,
  });
  return c.redirect(`/crm/contacts/${id}?msg=${error ? "failed" : "sent"}#messages`);
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
  return render(c, <FieldHistoryPage user={me(c)} contactId={id} name={name} label={label} logs={logs} />);
});

crm.get("/contacts/:id{[0-9]+}/snapshot", async (c) => {
  const id = idParam(c);
  const name = await nameForHistory(c, id);
  if (!name) return c.notFound();
  const atText = (c.req.query("at") ?? "").trim();
  const at = atText ? parseJalali(atText) : new Date().toISOString();
  const props = { user: me(c), contactId: id, name, atText: atText || formatJalali(at) };
  if (!at) return render(c, <SnapshotPage {...props} snap={null} error="تاریخ نامعتبر است. نمونه: 1405/07/09 14:30" />, 400);
  return render(c, <SnapshotPage {...props} snap={buildSnapshot(await getLogs(c.env.DB, id), at)} />);
});

crm.get("/history", async (c) => {
  const page = pageParam(c);
  const logs = await recentLogs(c.env.DB, page);
  return render(c, <HistoryPage user={me(c)} logs={logs.slice(0, PAGE_SIZE)} page={page} hasNext={logs.length > PAGE_SIZE} />);
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

crm.get("/fields", async (c) => render(c, <FieldsPage user={me(c)} defs={await getFieldDefs(c.env.DB)} />));

async function saveFieldName(c: C, id: number | null) {
  const name = String((await c.req.parseBody()).name ?? "").trim();
  const fail = async (error: string) =>
    render(c, <FieldsPage user={me(c)} defs={await getFieldDefs(c.env.DB)} error={error} />, 400);
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
  return render(c, <UsersPage user={me(c)} users={results} {...extra} />, status);
}

crm.get("/users", requireAdmin, (c) => staffPage(c));

crm.post("/users", requireAdmin, async (c) => {
  const form = await c.req.parseBody();
  const phone = normalizePhone(String(form.phone ?? ""));
  const name = String(form.name ?? "").trim();
  if (!/^09\d{9}$/.test(phone)) return staffPage(c, { error: "شماره موبایل نامعتبر است." }, 400);
  const existing = await c.env.DB.prepare("SELECT id, name FROM users WHERE phone = ?").bind(phone).first<{ id: number; name: string }>();
  if (existing) {
    await c.env.DB.prepare("UPDATE users SET is_staff = 1 WHERE id = ?").bind(existing.id).run();
    return staffPage(c, { ok: `دسترسی CRM به ${existing.name} داده شد.` });
  }
  if (!name) return staffPage(c, { error: "این شماره هنوز در سایت حساب ندارد؛ برای ساختن حساب، نام را هم وارد کنید." }, 400);
  // No password: the person signs in with a Bale one-time code on their own phone.
  // Names and birth date are completed by the person at first sign-in.
  const row = await c.env.DB.prepare("INSERT INTO users (phone, name, first_name, password_hash, is_staff, created_at) VALUES (?, ?, ?, '!', 1, ?) RETURNING id")
    .bind(phone, name, name.slice(0, 40), new Date().toISOString())
    .first<{ id: number }>();
  if (row) await assignUsername(c.env.DB, row.id);
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
