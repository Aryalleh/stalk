// Applies pending migrations from /migrations on the first request of each isolate, so a deploy
// can never run code against an older schema. Uses wrangler's own `d1_migrations` table, so
// `wrangler d1 migrations apply/list` stays in agreement.
import m0001 from "../migrations/0001_init.sql";
import m0002 from "../migrations/0002_settings.sql";
import m0003 from "../migrations/0003_bale.sql";
import m0004 from "../migrations/0004_shop_v2.sql";
import m0005 from "../migrations/0005_sizes.sql";
import m0006 from "../migrations/0006_design.sql";
import m0007 from "../migrations/0007_pwa_seo.sql";
import m0008 from "../migrations/0008_stock.sql";
import m0009 from "../migrations/0009_profiles_colors.sql";
import m0010 from "../migrations/0010_user_theme.sql";
import m0011 from "../migrations/0011_default_pink_light.sql";
import m0012 from "../migrations/0012_random_handles.sql";
import m0013 from "../migrations/0013_shop_crm.sql";
import m0014 from "../migrations/0014_ig_comments.sql";
import m0015 from "../migrations/0015_telegram_channel.sql";
import m0016 from "../migrations/0016_impersonation.sql";
import m0017 from "../migrations/0017_nickname_tg_share.sql";
import m0018 from "../migrations/0018_shop_packages_codes.sql";
import m0019 from "../migrations/0019_profile_banner.sql";
import m0020 from "../migrations/0020_pages.sql";
import m0021 from "../migrations/0021_miniapp_log.sql";
import m0022 from "../migrations/0022_bale_channel.sql";
import m0023 from "../migrations/0023_instagram_shops.sql";
import m0024 from "../migrations/0024_instagram_chat.sql";
import m0025 from "../migrations/0025_instagram_signup.sql";
import m0026 from "../migrations/0026_ig_log.sql";
import m0027 from "../migrations/0027_chat_state.sql";
import m0028 from "../migrations/0028_mention_post.sql";
import m0029 from "../migrations/0029_chat_cards.sql";
import m0030 from "../migrations/0030_product_delete.sql";
import m0031 from "../migrations/0031_login_links.sql";
import m0032 from "../migrations/0032_ig_wishers.sql";
import m0033 from "../migrations/0033_ask_address.sql";
import m0034 from "../migrations/0034_address_confirm.sql";
import m0035 from "../migrations/0035_friends.sql";
import m0036 from "../migrations/0036_session_renew.sql";
import m0037 from "../migrations/0037_anon_messages.sql";
import m0038 from "../migrations/0038_web_shop.sql";
import m0039 from "../migrations/0039_chat_threads.sql";
import m0040 from "../migrations/0040_referral_points.sql";
import m0041 from "../migrations/0041_anon_cross.sql";
import { statements } from "./sql-statements";

// Keep in sync with the files in /migrations (a test checks this).
export const MIGRATIONS: [string, string][] = [
  ["0001_init.sql", m0001],
  ["0002_settings.sql", m0002],
  ["0003_bale.sql", m0003],
  ["0004_shop_v2.sql", m0004],
  ["0005_sizes.sql", m0005],
  ["0006_design.sql", m0006],
  ["0007_pwa_seo.sql", m0007],
  ["0008_stock.sql", m0008],
  ["0009_profiles_colors.sql", m0009],
  ["0010_user_theme.sql", m0010],
  ["0011_default_pink_light.sql", m0011],
  ["0012_random_handles.sql", m0012],
  ["0013_shop_crm.sql", m0013],
  ["0014_ig_comments.sql", m0014],
  ["0015_telegram_channel.sql", m0015],
  ["0016_impersonation.sql", m0016],
  ["0017_nickname_tg_share.sql", m0017],
  ["0018_shop_packages_codes.sql", m0018],
  ["0019_profile_banner.sql", m0019],
  ["0020_pages.sql", m0020],
  ["0021_miniapp_log.sql", m0021],
  ["0022_bale_channel.sql", m0022],
  ["0023_instagram_shops.sql", m0023],
  ["0024_instagram_chat.sql", m0024],
  ["0025_instagram_signup.sql", m0025],
  ["0026_ig_log.sql", m0026],
  ["0027_chat_state.sql", m0027],
  ["0028_mention_post.sql", m0028],
  ["0029_chat_cards.sql", m0029],
  ["0030_product_delete.sql", m0030],
  ["0031_login_links.sql", m0031],
  ["0032_ig_wishers.sql", m0032],
  ["0033_ask_address.sql", m0033],
  ["0034_address_confirm.sql", m0034],
  ["0035_friends.sql", m0035],
  ["0036_session_renew.sql", m0036],
  ["0037_anon_messages.sql", m0037],
  ["0038_web_shop.sql", m0038],
  ["0039_chat_threads.sql", m0039],
  ["0040_referral_points.sql", m0040],
  ["0041_anon_cross.sql", m0041],
];

let done: Promise<void> | null = null;

export function ensureMigrated(db: D1Database) {
  done ??= migrate(db).catch((e) => {
    done = null; // retry on the next request
    throw e;
  });
  return done;
}

async function migrate(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    )
    .run();
  const { results } = await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
  const applied = new Set(results.map((r) => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (applied.has(name)) continue;
    try {
      // One transaction per file, recorded together with the file name.
      await db.batch([...statements(sql).map((s) => db.prepare(s)), db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(name)]);
      console.log(`applied migration ${name}`);
    } catch (e) {
      // Another isolate may have applied it at the same moment.
      const again = await db.prepare("SELECT 1 FROM d1_migrations WHERE name = ?").bind(name).first();
      if (!again) throw e;
    }
  }
}
