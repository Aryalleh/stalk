import type { Context } from "hono";
import type { Shop } from "./db";
import type { User } from "./session";

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  SITE_URL: string;
  SETUP_TOKEN?: string;
  ZARINPAL_MERCHANT_ID?: string;
  ZARINPAL_SANDBOX?: string;
  DEV_PAYMENTS?: string; // "1" enables the fake gateway (local development only)
  BALE_BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  BOT_WEBHOOK_SECRET?: string;
};

export type Env = { Bindings: Bindings; Variables: { user: User | null; shop: Shop } };
export type C = Context<Env>;
