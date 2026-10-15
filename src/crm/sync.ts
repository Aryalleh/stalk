// Puts site users and gift buyers into the CRM automatically (matched by phone).
import { CORE_NAMES, contactName, fieldLabel } from "./fields";
import { normalizeHandle } from "../../lib/normalize";
import { saveContact, type Actor } from "./db";
import { formatJalali } from "../../lib/jalali";

export const SYSTEM: Actor = { id: null, name: "سیستم" };

export function splitName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  const i = n.indexOf(" ");
  return i > 0 ? { first: n.slice(0, i), last: n.slice(i + 1) } : { first: n, last: "" };
}

/**
 * Make sure a person with this phone exists in the CRM. Existing contacts (phone or second phone)
 * are left untouched; new ones are created with the name and a note saying where they came from.
 */
export async function upsertCustomer(db: D1Database, person: { name: string; phone: string; source: string }) {
  if (!/^09\d{9}$/.test(person.phone)) return;
  const existing = await db.prepare("SELECT id FROM contacts WHERE phone = ?1 OR phone2 = ?1 LIMIT 1").bind(person.phone).first();
  if (existing) return;
  const { first, last } = splitName(person.name);
  const core = Object.fromEntries(CORE_NAMES.map((n) => [n, ""]));
  Object.assign(core, { first_name: first, last_name: last, phone: person.phone, notes: `${person.source} (${formatJalali(new Date().toISOString(), false)})` });
  try {
    await saveContact(db, null, core, new Map(), new Map(), SYSTEM);
  } catch (e) {
    console.error("CRM sync failed", e); // never block sign-up or checkout on the CRM
  }
}

/**
 * Keep a contact's "آیدی تلگرام" / "آیدی بله" in step with the @username the bots see: whenever the
 * person behind a chat (matched by the phone of the account / Bale link of that chat, or `phone` when
 * they just shared it) has a username different from the CRM's, it's updated and logged as «سیستم».
 */
export async function syncMessengerHandle(db: D1Database, kind: "bale" | "telegram", chat: string, username: string, phone?: string) {
  const handle = normalizeHandle(username ?? "");
  if (!handle) return; // no username (or hidden): leave what's there
  const col = kind === "bale" ? "bale_chat_id" : "telegram_chat_id";
  const field = kind === "bale" ? "bale_id" : "telegram_id";
  const phones = new Set<string>(phone && /^09\d{9}$/.test(phone) ? [phone] : []);
  const { results: users } = await db.prepare(`SELECT phone FROM users WHERE ${col} = ?`).bind(chat).all<{ phone: string }>();
  for (const u of users) if (/^09\d{9}$/.test(u.phone)) phones.add(u.phone);
  if (kind === "bale") {
    const { results: links } = await db.prepare("SELECT phone FROM bale_links WHERE chat_id = ?").bind(chat).all<{ phone: string }>();
    for (const l of links) phones.add(l.phone);
  }
  if (!phones.size) return;
  const list = [...phones];
  const marks = list.map(() => "?").join(",");
  const { results: contacts } = await db
    .prepare(`SELECT id, first_name, last_name, phone, ${field} AS cur FROM contacts WHERE (phone IN (${marks}) OR phone2 IN (${marks})) AND ${field} <> ?`)
    .bind(...list, ...list, handle)
    .all<{ id: number; first_name: string; last_name: string; phone: string; cur: string }>();
  if (!contacts.length) return;
  const at = new Date().toISOString();
  await db.batch(
    contacts.flatMap((c) => [
      db.prepare(`UPDATE contacts SET ${field} = ?, updated_at = ? WHERE id = ?`).bind(handle, at, c.id),
      db
        .prepare(
          `INSERT INTO change_log (contact_id, contact_repr, field_name, field_label, action, old_value, new_value, user_id, username, changed_at)
           VALUES (?, ?, ?, ?, 'update', ?, ?, NULL, ?, ?)`,
        )
        .bind(c.id, contactName(c), field, fieldLabel(field), c.cur, handle, SYSTEM.name, at),
    ]),
  );
}
