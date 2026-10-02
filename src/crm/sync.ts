// Puts site users and gift buyers into the CRM automatically (matched by phone).
import { CORE_NAMES } from "./fields";
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
