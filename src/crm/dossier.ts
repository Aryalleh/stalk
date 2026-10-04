// Everything the site knows about a CRM client, matched by their phone numbers: the site account,
// every address, gifts bought and received, the people those gifts connect them to, wishlists and
// their records in shops' CRMs. Shown to platform staff on the client profile.
import type { ContactRow } from "./db";

const SOLD = "('awaiting', 'paid', 'shipped', 'delivered')";
const PAID = ["paid", "shipped", "delivered"];

export interface Account {
  id: number;
  name: string;
  username: string | null;
  birth_date: string;
  created_at: string;
  bale_chat_id: string;
  telegram_chat_id: string;
  is_admin: number;
  shop_name: string | null;
  shop_slug: string | null;
}

export interface Address {
  source: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  postal: string;
  at: string | null;
}

export interface Gift {
  id: number;
  token: string;
  product_title: string;
  amount: number;
  status: string;
  created_at: string;
  is_anonymous: number;
  shop_name: string;
  /** The other side: the recipient for a gift bought, the giver for a gift received. */
  other_name: string;
  other_phone: string;
  other_username: string | null;
  wishlist_title: string;
  is_direct: number;
  ship_city: string;
}

export interface Friend {
  name: string;
  phone: string;
  username: string | null;
  contactId: number | null;
  gaveCount: number; // gifts this client bought for them
  gaveAmount: number;
  gotCount: number; // gifts they bought for this client
  gotAmount: number;
  anonymous: boolean;
  last: string;
}

export interface Dossier {
  phones: string[];
  account: Account | null;
  addresses: Address[];
  bought: Gift[];
  received: Gift[];
  friends: Friend[];
  wishlists: { id: number; title: string; slug: string; items: number; is_open: number; is_direct: number; occasion_date: string; created_at: string }[];
  shops: { shop_name: string; stage: string; total_spent: number; orders_count: number; last_order_at: string | null; source: string }[];
  totals: { spent: number; received: number };
}

const norm = (s: string) => s.replace(/[\s،,.\-]/g, "");

export async function clientDossier(db: D1Database, c: ContactRow): Promise<Dossier> {
  const phones = [...new Set([c.phone, c.phone2].filter((p) => /^09\d{9}$/.test(p)))];
  const empty: Dossier = { phones, account: null, addresses: [], bought: [], received: [], friends: [], wishlists: [], shops: [], totals: { spent: 0, received: 0 } };
  const addresses: Address[] = [];
  if (c.address || c.postal_code) addresses.push({ source: "پرونده CRM", name: "", phone: c.phone, city: "", address: c.address, postal: c.postal_code, at: c.updated_at });
  if (!phones.length) return { ...empty, addresses };

  const inList = phones.map(() => "?").join(",");
  const account = await db
    .prepare(
      `SELECT u.id, u.name, u.username, u.birth_date, u.created_at, u.bale_chat_id, u.telegram_chat_id, u.is_admin, s.name AS shop_name, s.slug AS shop_slug
       FROM users u LEFT JOIN shops s ON s.owner_id = u.id WHERE u.phone IN (${inList}) ORDER BY u.id LIMIT 1`,
    )
    .bind(...phones)
    .first<Account>();
  const uid = account?.id ?? -1;

  const [bought, received, wishlists, shopRows, shipped] = await db.batch([
    // Gifts this client paid for (as giver), with the recipient (the wishlist's owner).
    db
      .prepare(
        `SELECT o.id, o.token, o.product_title, o.amount, o.status, o.created_at, o.is_anonymous, o.ship_city, s.name AS shop_name,
                COALESCE(NULLIF(u.name, ''), w.recipient_name) AS other_name, u.phone AS other_phone, u.username AS other_username,
                w.title AS wishlist_title, w.is_direct
         FROM orders o JOIN wishlists w ON w.id = o.wishlist_id JOIN users u ON u.id = w.user_id JOIN shops s ON s.id = o.shop_id
         WHERE o.giver_phone IN (${inList}) AND o.status IN ${SOLD} ORDER BY o.created_at DESC LIMIT 200`,
      )
      .bind(...phones),
    // Gifts others bought from this client's wishlists.
    db
      .prepare(
        `SELECT o.id, o.token, o.product_title, o.amount, o.status, o.created_at, o.is_anonymous, o.ship_city, s.name AS shop_name,
                o.giver_name AS other_name, o.giver_phone AS other_phone, gu.username AS other_username, w.title AS wishlist_title, w.is_direct
         FROM orders o JOIN wishlists w ON w.id = o.wishlist_id JOIN shops s ON s.id = o.shop_id LEFT JOIN users gu ON gu.phone = o.giver_phone
         WHERE w.user_id = ? AND w.is_direct = 0 AND o.status IN ${SOLD} ORDER BY o.created_at DESC LIMIT 200`,
      )
      .bind(uid),
    db
      .prepare(
        `SELECT w.id, w.title, w.slug, w.is_open, w.is_direct, w.occasion_date, w.created_at, w.recipient_name, w.recipient_phone, w.city, w.address, w.postal_code,
                (SELECT COUNT(*) FROM wishlist_items i WHERE i.wishlist_id = w.id) AS items
         FROM wishlists w WHERE w.user_id = ? OR w.recipient_phone IN (${inList}) ORDER BY w.created_at DESC LIMIT 100`,
      )
      .bind(uid, ...phones),
    db
      .prepare(
        `SELECT s.name AS shop_name, cu.stage, cu.total_spent, cu.orders_count, cu.last_order_at, cu.source, cu.name, cu.phone, cu.city, cu.address, cu.updated_at
         FROM customers cu JOIN shops s ON s.id = cu.shop_id WHERE cu.phone IN (${inList}) ORDER BY cu.total_spent DESC`,
      )
      .bind(...phones),
    // Deliveries made to these phones (the shipping snapshot of confirmed orders).
    db
      .prepare(
        `SELECT ship_name, ship_phone, ship_address, ship_postal_code, ship_city, paid_at FROM orders
         WHERE ship_phone IN (${inList}) AND ship_address <> '' ORDER BY paid_at DESC LIMIT 50`,
      )
      .bind(...phones),
  ]);

  type W = Dossier["wishlists"][number] & { recipient_name: string; recipient_phone: string; city: string; address: string; postal_code: string };
  for (const w of wishlists.results as W[]) {
    if (w.address || w.postal_code) {
      addresses.push({
        source: w.is_direct ? "خرید برای خودش" : `لیست «${w.title}»`,
        name: w.recipient_name,
        phone: w.recipient_phone,
        city: w.city,
        address: w.address,
        postal: w.postal_code,
        at: w.created_at,
      });
    }
  }
  type S = Dossier["shops"][number] & { name: string; phone: string; city: string; address: string; updated_at: string };
  for (const s of shopRows.results as S[]) {
    if (s.address) addresses.push({ source: `مشتری «${s.shop_name}»`, name: s.name, phone: s.phone, city: s.city, address: s.address, postal: "", at: s.updated_at });
  }
  type O = { ship_name: string; ship_phone: string; ship_address: string; ship_postal_code: string; ship_city: string; paid_at: string | null };
  for (const o of shipped.results as O[]) {
    addresses.push({ source: "ارسال کادو", name: o.ship_name, phone: o.ship_phone, city: o.ship_city, address: o.ship_address, postal: o.ship_postal_code, at: o.paid_at });
  }
  // The same address from several places is listed once (first source wins).
  const seen = new Set<string>();
  const unique = addresses.filter((a) => {
    const k = norm(a.address) + "|" + norm(a.postal);
    if (!k.replace("|", "") || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // People connected through gifts, both directions.
  const friends = new Map<string, Friend>();
  const friend = (phone: string, name: string, username: string | null, at: string) => {
    const key = phone || `name:${name}`;
    let f = friends.get(key);
    if (!f) friends.set(key, (f = { name, phone, username, contactId: null, gaveCount: 0, gaveAmount: 0, gotCount: 0, gotAmount: 0, anonymous: false, last: at }));
    if (at > f.last) f.last = at;
    if (!f.username && username) f.username = username;
    return f;
  };
  const boughtRows = bought.results as Gift[];
  const receivedRows = received.results as Gift[];
  for (const g of boughtRows) {
    if (g.is_direct || phones.includes(g.other_phone)) continue;
    const f = friend(g.other_phone, g.other_name, g.other_username, g.created_at);
    f.gaveCount++;
    f.gaveAmount += g.amount;
  }
  for (const g of receivedRows) {
    const f = friend(g.other_phone, g.other_name, g.other_username, g.created_at);
    f.gotCount++;
    f.gotAmount += g.amount;
    if (g.is_anonymous) f.anonymous = true;
  }
  const friendList = [...friends.values()].sort((a, b) => b.gaveCount + b.gotCount - (a.gaveCount + a.gotCount) || (a.last < b.last ? 1 : -1));
  const friendPhones = friendList.map((f) => f.phone).filter(Boolean);
  if (friendPhones.length) {
    const marks = friendPhones.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, phone, phone2 FROM contacts WHERE phone IN (${marks}) OR phone2 IN (${marks})`)
      .bind(...friendPhones, ...friendPhones)
      .all<{ id: number; phone: string; phone2: string }>();
    for (const f of friendList) f.contactId = results.find((r) => r.phone === f.phone || r.phone2 === f.phone)?.id ?? null;
  }

  const sum = (gs: Gift[]) => gs.filter((g) => PAID.includes(g.status)).reduce((s, g) => s + g.amount, 0);
  return {
    phones,
    account,
    addresses: unique,
    bought: boughtRows,
    received: receivedRows,
    friends: friendList,
    wishlists: (wishlists.results as W[]).filter((w) => !w.is_direct),
    shops: shopRows.results as S[],
    totals: { spent: sum(boughtRows), received: sum(receivedRows) },
  };
}

/** Per contact on a list page: has a site account, has bought gifts, last change. */
export async function listFacts(db: D1Database, rows: ContactRow[]) {
  const phones = [...new Set(rows.flatMap((r) => [r.phone, r.phone2]).filter((p) => /^09\d{9}$/.test(p)))];
  const ids = rows.map((r) => r.id);
  const out = { accounts: new Set<string>(), buyers: new Set<string>(), last: new Map<number, string>() };
  if (!rows.length) return out;
  const pm = phones.map(() => "?").join(",") || "''";
  const im = ids.map(() => "?").join(",");
  const [acc, buy, last] = await db.batch([
    db.prepare(`SELECT phone FROM users WHERE phone IN (${pm})`).bind(...phones),
    db.prepare(`SELECT DISTINCT giver_phone AS phone FROM orders WHERE giver_phone IN (${pm}) AND status IN ${SOLD}`).bind(...phones),
    db
      .prepare(
        `SELECT l.contact_id, l.field_label, l.action FROM change_log l
         WHERE l.contact_id IN (${im}) AND l.id = (SELECT MAX(id) FROM change_log WHERE contact_id = l.contact_id)`,
      )
      .bind(...ids),
  ]);
  for (const r of acc.results as { phone: string }[]) out.accounts.add(r.phone);
  for (const r of buy.results as { phone: string }[]) out.buyers.add(r.phone);
  for (const r of last.results as { contact_id: number; field_label: string; action: string }[]) {
    out.last.set(r.contact_id, r.action === "update" ? `ویرایش ${r.field_label}` : r.action === "create" ? "ثبت پرونده" : r.field_label);
  }
  return out;
}
