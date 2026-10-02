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
