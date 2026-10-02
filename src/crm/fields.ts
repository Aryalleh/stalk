import { nationalCodeError, normalizeDigits, normalizeHandle, normalizePhone, phoneError, postalCodeError } from "../../lib/normalize";

type Kind = "text" | "phone" | "handle" | "national" | "postal" | "textarea";

export interface CoreField {
  name: string;
  label: string;
  kind: Kind;
  section: string;
}

export const CORE_FIELDS: CoreField[] = [
  { name: "first_name", label: "نام", kind: "text", section: "مشخصات" },
  { name: "last_name", label: "نام خانوادگی", kind: "text", section: "مشخصات" },
  { name: "father_name", label: "نام پدر", kind: "text", section: "مشخصات" },
  { name: "national_code", label: "کد ملی", kind: "national", section: "مشخصات" },
  { name: "phone", label: "شماره تماس", kind: "phone", section: "تماس" },
  { name: "phone2", label: "شماره تماس دوم", kind: "phone", section: "تماس" },
  { name: "father_phone", label: "شماره پدر", kind: "phone", section: "تماس" },
  { name: "telegram_id", label: "آیدی تلگرام", kind: "handle", section: "شبکه‌های اجتماعی" },
  { name: "instagram_id", label: "آیدی اینستاگرام", kind: "handle", section: "شبکه‌های اجتماعی" },
  { name: "twitter_id", label: "آیدی توییتر (X)", kind: "handle", section: "شبکه‌های اجتماعی" },
  { name: "bale_id", label: "آیدی بله", kind: "handle", section: "شبکه‌های اجتماعی" },
  { name: "postal_code", label: "کد پستی", kind: "postal", section: "آدرس" },
  { name: "address", label: "آدرس", kind: "textarea", section: "آدرس" },
  { name: "notes", label: "یادداشت", kind: "textarea", section: "سایر" },
];

export const CORE_NAMES = CORE_FIELDS.map((f) => f.name);
export const SECTIONS = [...new Set(CORE_FIELDS.map((f) => f.section))];
export const fieldLabel = (name: string) => CORE_FIELDS.find((f) => f.name === name)?.label ?? name;

/** Pseudo field_name for whole-contact create/delete rows in change_log. */
export const CONTACT_KEY = "__contact__";
export const extraKey = (fieldId: number) => `extra:${fieldId}`;

export type ContactData = Record<string, string>;

export function normalizeField(kind: Kind, raw: string): string {
  const v = (raw ?? "").trim();
  switch (kind) {
    case "phone":
      return normalizePhone(v);
    case "handle":
      return normalizeHandle(v);
    case "national":
    case "postal":
      return normalizeDigits(v);
    default:
      return v;
  }
}

function fieldError(kind: Kind, value: string): string | null {
  if (kind === "phone") return phoneError(value);
  if (kind === "national") return nationalCodeError(value);
  if (kind === "postal") return postalCodeError(value);
  return null;
}

/** Normalize the submitted core fields and collect validation errors keyed by field name. */
export function cleanContact(input: Record<string, string>) {
  const data: ContactData = {};
  const errors: Record<string, string> = {};
  for (const f of CORE_FIELDS) {
    data[f.name] = normalizeField(f.kind, input[f.name] ?? "");
    const err = fieldError(f.kind, data[f.name]);
    if (err) errors[f.name] = err;
  }
  return { data, errors };
}

export function contactName(c: { first_name?: string; last_name?: string; phone?: string; id?: number }): string {
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return name || c.phone || `مخاطب #${c.id ?? ""}`;
}
