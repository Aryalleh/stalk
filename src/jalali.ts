// Jalali ⇄ Gregorian conversion (algorithm from jalaali-js) and Tehran-time helpers.

import { toLatinDigits } from "./normalize";

const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number) {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) throw new RangeError("سال خارج از محدوده است");
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  const d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  let k = jdn - g2d(gy, 3, r.march);
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function toJalali(gy: number, gm: number, gd: number) {
  return d2j(g2d(gy, gm, gd));
}

export function toGregorian(jy: number, jm: number, jd: number) {
  return d2g(j2d(jy, jm, jd));
}

// Iran has used a fixed UTC+03:30 offset (no DST) since 2022.
const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** ISO UTC timestamp → "1405/07/09 14:30:00" in Tehran time. */
export function formatJalali(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() + TEHRAN_OFFSET_MS);
  const { jy, jm, jd } = toJalali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  const date = `${jy}/${pad(jm)}/${pad(jd)}`;
  return withTime ? `${date} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}` : date;
}

/**
 * "1405/07/09", "1405/07/09 14:30" or "1405/07/09 14:30:15" (Persian digits OK), Tehran time
 * → ISO UTC. A bare date means the end of that day. Returns null if invalid.
 */
export function parseJalali(text: string): string | null {
  const m = toLatinDigits(text)
    .trim()
    .replace(/-/g, "/")
    .match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31 || (jm > 6 && jd > 30)) return null;
  const [h, mi, s] = m[4] === undefined ? [23, 59, 59] : [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  let g;
  try {
    g = toGregorian(jy, jm, jd);
  } catch {
    return null;
  }
  // .999 so every change made within the given second is included.
  const ms = Date.UTC(g.gy, g.gm - 1, g.gd, h, mi, s, 999) - TEHRAN_OFFSET_MS;
  return new Date(ms).toISOString();
}
