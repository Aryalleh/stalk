// Phone <-> Bale chat links, created when a person shares their own contact with the site's bot.

export interface BaleLink {
  phone: string;
  chat_id: string;
  bale_user_id: string;
  name: string;
  username: string;
  linked_at: string;
}

export async function saveLink(db: D1Database, link: BaleLink) {
  await db
    .prepare(
      `INSERT INTO bale_links (phone, chat_id, bale_user_id, name, username, linked_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (phone) DO UPDATE SET chat_id = excluded.chat_id, bale_user_id = excluded.bale_user_id,
         name = excluded.name, username = excluded.username, linked_at = excluded.linked_at`,
    )
    .bind(link.phone, link.chat_id, link.bale_user_id, link.name, link.username, link.linked_at)
    .run();
}

/** Links for the given phones, keyed by phone. */
export async function linksFor(db: D1Database, phones: string[]) {
  const list = [...new Set(phones.filter(Boolean))];
  if (!list.length) return new Map<string, BaleLink>();
  const { results } = await db
    .prepare(`SELECT * FROM bale_links WHERE phone IN (${list.map(() => "?").join(", ")})`)
    .bind(...list)
    .all<BaleLink>();
  return new Map(results.map((r) => [r.phone, r]));
}

/** Deep link that opens the bot and asks the person to share their number. */
export const inviteLink = (botUsername: string) => (botUsername ? `https://ble.ir/${botUsername}?start=link` : "");
