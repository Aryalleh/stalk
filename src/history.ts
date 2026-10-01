import { CONTACT_KEY, CORE_FIELDS, extraKey } from "./fields";

export type Action = "create" | "update" | "delete";

export interface LogEntry {
  field_name: string;
  field_label: string;
  action: Action;
  old_value: string;
  new_value: string;
}

export interface LogRow extends LogEntry {
  id: number;
  contact_id: number;
  contact_repr: string;
  username: string;
  changed_at: string;
}

/** extras: field_id → value; labels: field_id → field name. */
export type Extras = Map<number, string>;

/** Compute change_log entries between two states. `before` null means the contact is new. */
export function diffContact(
  before: { core: Record<string, string>; extras: Extras } | null,
  after: { core: Record<string, string>; extras: Extras },
  labels: Map<number, string>,
): LogEntry[] {
  const out: LogEntry[] = [];
  if (!before) out.push({ field_name: CONTACT_KEY, field_label: "مخاطب", action: "create", old_value: "", new_value: "" });
  for (const f of CORE_FIELDS) {
    const old = before?.core[f.name] ?? "";
    const now = after.core[f.name] ?? "";
    if (old === now) continue;
    out.push({ field_name: f.name, field_label: f.label, action: before ? "update" : "create", old_value: old, new_value: now });
  }
  const ids = new Set([...(before?.extras.keys() ?? []), ...after.extras.keys()]);
  for (const id of [...ids].sort((a, b) => a - b)) {
    const old = before?.extras.get(id);
    const now = after.extras.get(id);
    if (old === now) continue;
    const action: Action = old === undefined ? "create" : now === undefined ? "delete" : "update";
    out.push({ field_name: extraKey(id), field_label: labels.get(id) ?? `فیلد ${id}`, action, old_value: old ?? "", new_value: now ?? "" });
  }
  return out;
}

export interface Snapshot {
  exists: boolean;
  deleted: boolean;
  fields: [string, string][];
  extras: [string, string][];
}

/** Rebuild a contact's state from its log rows (any order) up to and including `at` (ISO UTC). */
export function buildSnapshot(logs: LogRow[], at: string): Snapshot {
  const rows = logs.filter((l) => l.changed_at <= at).sort((a, b) => a.changed_at.localeCompare(b.changed_at) || a.id - b.id);
  let exists = false;
  let deleted = false;
  const values: Record<string, string> = {};
  const extras = new Map<string, [string, string]>();
  for (const l of rows) {
    if (l.field_name === CONTACT_KEY) {
      exists = l.action === "create";
      deleted = l.action === "delete";
    } else if (l.field_name.startsWith("extra:")) {
      if (l.action === "delete") extras.delete(l.field_name);
      else extras.set(l.field_name, [l.field_label, l.new_value]);
    } else {
      values[l.field_name] = l.new_value;
    }
  }
  return {
    exists,
    deleted,
    fields: CORE_FIELDS.map((f) => [f.label, values[f.name] ?? ""]),
    extras: [...extras.values()].sort((a, b) => a[0].localeCompare(b[0], "fa")),
  };
}
