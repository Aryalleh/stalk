import type { Context } from "hono";
import type { User } from "./session";
import type { Shop } from "./shop/db";

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  SITE_URL: string;
  SETUP_TOKEN?: string;
  BALE_BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  BOT_WEBHOOK_SECRET?: string;
};

export type Env = { Bindings: Bindings; Variables: { user: User | null; shop: Shop } };
export type C = Context<Env>;
