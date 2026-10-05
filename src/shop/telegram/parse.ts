// Reading a shop's Telegram channel post as a product: title, price, description and colors from
// the caption the shop already writes, e.g.
//   تی‌شرت نخی 👕
//   پارچه پنبه، قابل شستشو
//   رنگ: مشکی، سفید
//   قیمت: ۴۵۰ هزار تومان
//   #محصول
import { toLatinDigits } from "../../../lib/normalize";

export interface ParsedPost {
  title: string;
  price: number;
  description: string;
  colors: string[];
}

const PRICE_WORD = /(قیمت|فی|price|💰|💵)/i;
const UNIT = /(میلیون|ملیون|م\b|هزار|k\b|تومان|تومن|ت\b|ریال|t\b)/i;

/** "۴۵۰ هزار تومان" → 450000; "1.2 میلیون" → 1200000; "4,500,000 ریال" → 450000; "450ت" → 450000. */
export function parsePrice(line: string): number {
  const s = toLatinDigits(line).replace(/[٬،,'’]/g, (m) => (m === "،" ? " " : "")).replace(/(\d)\s+(?=000\b)/g, "$1"); // "4 500 000"
  // The last number on the line: a discounted price usually follows the old one.
  const nums = [...s.matchAll(/(\d+(?:[./]\d+)?)\s*(میلیون|ملیون|هزار|k|تومان|تومن|ریال|ت|t|م)?/gi)].filter((m) => m[1]);
  if (!nums.length) return 0;
  const last = nums[nums.length - 1];
  let n = Number(last[1].replace("/", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = (last[2] ?? s.slice((last.index ?? 0) + last[0].length).match(UNIT)?.[1] ?? "").toLowerCase();
  if (/میلیون|ملیون|^م$/.test(unit)) n *= 1_000_000;
  else if (/هزار|^k$/.test(unit)) n *= 1_000;
  else if (/ریال/.test(unit) || /ریال/.test(s)) n /= 10;
  // "۴۵۰ تومن" in a shop post means 450 thousand: nothing here costs under 10,000 toman.
  if (n > 0 && n < 10_000) n *= 1_000;
  return Math.round(n);
}

const isTagLine = (l: string) => /^(#[\p{L}\p{N}_‌]+\s*)+$/u.test(l.trim());

/** The product in a caption, or null when the post isn't one (no tag, or no price). */
export function parsePost(caption: string, tag: string): ParsedPost | null {
  const text = (caption ?? "").replace(/\r/g, "");
  const want = tag.trim().replace(/^#?/, "#");
  if (want !== "#" && !text.includes(want)) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let price = 0;
  let priceLine = -1;
  lines.forEach((l, i) => {
    if (PRICE_WORD.test(l) && /\d|[۰-۹]/.test(l)) {
      const p = parsePrice(l);
      if (p) {
        price = p;
        priceLine = i;
      }
    }
  });
  if (!price) {
    // No "قیمت:" line: a line that is only an amount with a unit.
    const i = lines.findIndex((l) => /^[\d۰-۹.,٬/\s]+(\s*(میلیون|هزار|تومان|تومن|ت|ریال))+\s*$/.test(l));
    if (i >= 0) {
      price = parsePrice(lines[i]);
      priceLine = i;
    }
  }
  if (!price) return null;
  let colors: string[] = [];
  const colorLine = lines.findIndex((l) => /^(رنگ(‌?بندی)?|رنگها|رنگ‌ها|colors?)\s*[:：]/i.test(l));
  if (colorLine >= 0) {
    colors = lines[colorLine]
      .replace(/^[^:：]+[:：]/, "")
      .split(/[،,|/]|\s+و\s+/)
      .map((c) => c.replace(/[#*_]/g, "").trim())
      .filter((c) => c && c.length <= 30)
      .slice(0, 20);
  }
  const rest = lines.filter((l, i) => i !== priceLine && i !== colorLine && !isTagLine(l));
  const strip = (l: string) => l.replace(new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "").trim();
  const title = strip(rest[0] ?? "").replace(/[*_~`]/g, "").slice(0, 120);
  if (!title) return null;
  return { title, price, description: rest.slice(1).map(strip).filter(Boolean).join("\n").slice(0, 3000), colors };
}
