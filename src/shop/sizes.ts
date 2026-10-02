// Size guide stored on a product as JSON: { columns: ["سایز", "دور سینه", ...], rows: [["M", "100", ...], ...] }.
// The first column holds the size names that a wishlist owner chooses from.

export interface SizeGuide {
  columns: string[];
  rows: string[][];
}

const MAX_COLS = 10;
const MAX_ROWS = 30;
const MAX_CELL = 30;

/** Parse and tidy a submitted guide. Returns null for "no guide", or an error message. */
export function parseSizeGuide(json: string): { guide: SizeGuide | null } | { error: string } {
  if (!json.trim()) return { guide: null };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: "جدول راهنمای سایز نامعتبر است." };
  }
  const r = raw as Partial<SizeGuide>;
  if (!Array.isArray(r.columns) || !Array.isArray(r.rows)) return { error: "جدول راهنمای سایز نامعتبر است." };
  const cell = (v: unknown) => String(v ?? "").trim().slice(0, MAX_CELL);
  let columns = r.columns.map(cell);
  let rows = r.rows.filter(Array.isArray).map((row) => columns.map((_, i) => cell((row as unknown[])[i])));
  rows = rows.filter((row) => row.some(Boolean)); // drop empty rows
  // Drop columns that have neither a header nor any value (except the size column).
  const keep = columns.map((h, i) => i === 0 || !!h || rows.some((row) => row[i]));
  columns = columns.filter((_, i) => keep[i]);
  rows = rows.map((row) => row.filter((_, i) => keep[i]));
  if (!rows.length) return { guide: null };
  if (columns.length > MAX_COLS) return { error: `جدول سایز حداکثر ${MAX_COLS} ستون دارد.` };
  if (rows.length > MAX_ROWS) return { error: `جدول سایز حداکثر ${MAX_ROWS} ردیف دارد.` };
  if (!columns[0]) columns[0] = "سایز";
  const names = rows.map((row) => row[0]);
  if (names.some((n) => !n)) return { error: "ستون اول جدول (نام سایز) برای همه ردیف‌ها لازم است." };
  if (new Set(names).size !== names.length) return { error: "نام سایزها در جدول تکراری است." };
  return { guide: { columns, rows } };
}

export function readSizeGuide(stored: string): SizeGuide | null {
  if (!stored) return null;
  try {
    const g = JSON.parse(stored) as SizeGuide;
    return Array.isArray(g.columns) && Array.isArray(g.rows) && g.rows.length ? g : null;
  } catch {
    return null;
  }
}

/** Size names a buyer can pick (first column). */
export const sizeNames = (stored: string) => readSizeGuide(stored)?.rows.map((r) => r[0]) ?? [];

/** Starter table for clothing. */
export const CLOTHING_TEMPLATE: SizeGuide = {
  columns: ["سایز", "دور سینه (cm)", "قد لباس (cm)", "دور کمر (cm)", "قد آستین (cm)"],
  rows: [
    ["S", "", "", "", ""],
    ["M", "", "", "", ""],
    ["L", "", "", "", ""],
    ["XL", "", "", "", ""],
  ],
};
