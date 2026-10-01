import type { User } from "./auth";
import { CONTACT_KEY, CORE_NAMES, contactName, type ContactData } from "./fields";
import { diffContact, type Extras, type LogEntry, type LogRow } from "./history";
import { normalizePhone, toLatinDigits } from "./normalize";

export type ContactRow = ContactData & { id: number; created_at: string; updated_at: string; created_by: number | null };
export interface FieldDef {
  id: number;
  name: string;
}

export class DuplicateNationalCode extends Error {}

export const PAGE_SIZE = 50;

export async function getContact(db: D1Database, id: number) {
  return db.prepare("SELECT * FROM contacts WHERE id = ?").bind(id).first<ContactRow>();
}

export async function getExtras(db: D1Database, contactId: number): Promise<Extras> {
  const { results } = await db
    .prepare("SELECT field_id, value FROM extra_values WHERE contact_id = ?")
    .bind(contactId)
    .all<{ field_id: number; value: string }>();
  return new Map(results.map((r) => [r.field_id, r.value]));
}

export async function getFieldDefs(db: D1Database) {
  const { results } = await db.prepare("SELECT id, name FROM field_definitions ORDER BY name").all<FieldDef>();
  return results;
}

export async function getLogs(db: D1Database, contactId: number, fieldName?: string) {
  const sql = fieldName
    ? "SELECT * FROM change_log WHERE contact_id = ? AND field_name = ? ORDER BY changed_at DESC, id DESC"
    : "SELECT * FROM change_log WHERE contact_id = ? ORDER BY changed_at DESC, id DESC";
  const stmt = fieldName ? db.prepare(sql).bind(contactId, fieldName) : db.prepare(sql).bind(contactId);
  return (await stmt.all<LogRow>()).results;
}

export async function recentLogs(db: D1Database, page: number) {
  const { results } = await db
    .prepare("SELECT * FROM change_log ORDER BY changed_at DESC, id DESC LIMIT ? OFFSET ?")
    .bind(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .all<LogRow>();
  return results;
}

function logStatements(db: D1Database, contactId: number, repr: string, entries: LogEntry[], user: User, at: string) {
  const stmt = db.prepare(
    `INSERT INTO change_log (contact_id, contact_repr, field_name, field_label, action, old_value, new_value, user_id, username, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return entries.map((e) =>
    stmt.bind(contactId, repr, e.field_name, e.field_label, e.action, e.old_value, e.new_value, user.id, user.username, at),
  );
}

function isUniqueError(e: unknown) {
  return String((e as Error)?.message ?? e).includes("UNIQUE constraint failed: contacts.national_code");
}

/** Create (id = null) or update a contact and its extra values, logging every changed field. Returns the id. */
export async function saveContact(
  db: D1Database,
  id: number | null,
  core: ContactData,
  extras: Extras,
  labels: Map<number, string>,
  user: User,
): Promise<number> {
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let before: { core: ContactData; extras: Extras } | null = null;

  try {
    if (id === null) {
      const cols = [...CORE_NAMES, "created_at", "updated_at", "created_by"];
      const row = await db
        .prepare(`INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING id`)
        .bind(...CORE_NAMES.map((n) => core[n]), now, now, user.id)
        .first<{ id: number }>();
      id = row!.id;
    } else {
      const old = await getContact(db, id);
      if (!old) throw new Error("not found");
      before = { core: old, extras: await getExtras(db, id) };
    }

    const entries = diffContact(before, { core, extras }, labels);
    if (before && entries.length === 0) return id;

    if (before && entries.some((e) => !e.field_name.startsWith("extra:"))) {
      stmts.push(
        db
          .prepare(`UPDATE contacts SET ${CORE_NAMES.map((n) => `${n} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
          .bind(...CORE_NAMES.map((n) => core[n]), now, id),
      );
    } else if (before) {
      stmts.push(db.prepare("UPDATE contacts SET updated_at = ? WHERE id = ?").bind(now, id));
    }
    for (const fid of new Set([...(before?.extras.keys() ?? []), ...extras.keys()])) {
      const value = extras.get(fid);
      if (value === before?.extras.get(fid)) continue;
      stmts.push(
        value === undefined
          ? db.prepare("DELETE FROM extra_values WHERE contact_id = ? AND field_id = ?").bind(id, fid)
          : db
              .prepare(
                `INSERT INTO extra_values (contact_id, field_id, value) VALUES (?, ?, ?)
                 ON CONFLICT (contact_id, field_id) DO UPDATE SET value = excluded.value`,
              )
              .bind(id, fid, value),
      );
    }
    stmts.push(...logStatements(db, id, contactName({ ...core, id }), entries, user, now));
    await db.batch(stmts); // one transaction
    return id;
  } catch (e) {
    if (isUniqueError(e)) throw new DuplicateNationalCode();
    throw e;
  }
}

export async function deleteContact(db: D1Database, id: number, labels: Map<number, string>, user: User) {
  const old = await getContact(db, id);
  if (!old) return;
  const extras = await getExtras(db, id);
  const now = new Date().toISOString();
  const entries: LogEntry[] = [...extras].map(([fid, value]) => ({
    field_name: `extra:${fid}`,
    field_label: labels.get(fid) ?? `فیلد ${fid}`,
    action: "delete",
    old_value: value,
    new_value: "",
  }));
  entries.push({ field_name: CONTACT_KEY, field_label: "مخاطب", action: "delete", old_value: "", new_value: "" });
  await db.batch([
    ...logStatements(db, id, contactName(old), entries, user, now),
    db.prepare("DELETE FROM extra_values WHERE contact_id = ?").bind(id),
    db.prepare("DELETE FROM contacts WHERE id = ?").bind(id),
  ]);
}

const SEARCH_COLUMNS = [...CORE_NAMES, "first_name || ' ' || last_name"];

/** Search every field (incl. extra values); Persian digits and +98 phone formats also match. */
export async function searchContacts(db: D1Database, q: string, page: number) {
  const term = toLatinDigits(q).trim();
  const offset = (page - 1) * PAGE_SIZE;
  if (!term) {
    const { results } = await db
      .prepare("SELECT * FROM contacts ORDER BY updated_at DESC LIMIT ? OFFSET ?")
      .bind(PAGE_SIZE + 1, offset)
      .all<ContactRow>();
    return results;
  }
  const like = `%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const phone = normalizePhone(term);
  const conds = SEARCH_COLUMNS.map((c) => `${c} LIKE ?1 ESCAPE '\\'`);
  conds.push("EXISTS (SELECT 1 FROM extra_values e WHERE e.contact_id = c.id AND e.value LIKE ?1 ESCAPE '\\')");
  conds.push("phone = ?2", "phone2 = ?2", "father_phone = ?2");
  const { results } = await db
    .prepare(`SELECT * FROM contacts c WHERE ${conds.join(" OR ")} ORDER BY updated_at DESC LIMIT ?3 OFFSET ?4`)
    .bind(like, phone, PAGE_SIZE + 1, offset)
    .all<ContactRow>();
  return results;
}

export async function allContactsWithExtras(db: D1Database) {
  const [contacts, extras] = await db.batch([
    db.prepare("SELECT * FROM contacts ORDER BY id"),
    db.prepare("SELECT contact_id, field_id, value FROM extra_values"),
  ]);
  const byContact = new Map<number, Extras>();
  for (const r of extras.results as { contact_id: number; field_id: number; value: string }[]) {
    if (!byContact.has(r.contact_id)) byContact.set(r.contact_id, new Map());
    byContact.get(r.contact_id)!.set(r.field_id, r.value);
  }
  return (contacts.results as ContactRow[]).map((c) => ({ contact: c, extras: byContact.get(c.id) ?? new Map() }));
}
