import { sizeNames } from "./sizes";

// A product's variants are its sizes (from the size guide) × its colors (one per line). Products
// without sizes or colors have one variant with an empty size / color. The pair is written as
// "size|color" in forms and stock maps.

export const MAX_COLORS = 20;

export const colorList = (colors: string) =>
  [...new Set(colors.split("\n").map((c) => c.replace(/\|/g, "").trim().slice(0, 30)).filter(Boolean))].slice(0, MAX_COLORS);

export const variantKey = (size: string, color: string) => `${size}|${color}`;

export interface Variant {
  size: string;
  color: string;
  key: string;
  label: string;
}

/** "سایز M · رنگ مشکی" ("" when the product has neither). */
export function variantLabel(size: string, color: string) {
  return [size && `سایز ${size}`, color && `رنگ ${color}`].filter(Boolean).join(" · ");
}

export function variants(p: { size_guide: string; colors: string }): Variant[] {
  const sizes = sizeNames(p.size_guide);
  const colors = colorList(p.colors);
  const out: Variant[] = [];
  for (const size of sizes.length ? sizes : [""]) {
    for (const color of colors.length ? colors : [""]) out.push({ size, color, key: variantKey(size, color), label: variantLabel(size, color) });
  }
  return out;
}

/** The product has a choice to make (more than one size or color). */
export const hasChoice = (p: { size_guide: string; colors: string }) => sizeNames(p.size_guide).length > 0 || colorList(p.colors).length > 0;

/** The product's sizes and colors, each listed once (for the two dropdowns buyers pick from). */
export function sizesAndColors(p: { size_guide: string; colors: string }) {
  return { sizes: sizeNames(p.size_guide), colors: colorList(p.colors) };
}

/** The "size|color" a form sent: the size and color dropdowns (v_size, v_color), or one combined "variant" field. */
export function variantFromForm(f: Record<string, string | undefined>) {
  if (f.variant !== undefined && f.variant !== "") return f.variant;
  if (f.v_size === undefined && f.v_color === undefined) return undefined;
  return variantKey(f.v_size ?? "", f.v_color ?? "");
}

/** The variant a form picked ("size|color"), if it is one of the product's. */
export function pickVariant(p: { size_guide: string; colors: string }, value: string | undefined) {
  return variants(p).find((v) => v.key === (value ?? "")) ?? null;
}
