import type { Context } from "hono";
import type { User } from "./session";
import type { Settings } from "./settings";
import type { Shop } from "./shop/db";

// Only infrastructure bindings come from wrangler.jsonc; every setting is in D1 (see settings.ts).
export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
};

export type Env = { Bindings: Bindings; Variables: { user: User | null; shop: Shop; settings: Settings } };
export type C = Context<Env>;
