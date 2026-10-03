import { Hono } from "hono";
import type { Env } from "../../env";
import { safeEqual } from "../../../lib/auth";
import { handleIgEvent, shopForAccount } from "./automation";
import { handleIgComment } from "./comments";
import { parseComments, parseWebhook, refreshToken, validSignature } from "./instagram";

// Instagram webhook for every shop: set the callback URL <site>/ig/webhook and the verify token from
// /admin/settings in the Meta app, and subscribe to the "messages" and "comments" fields.

export const igWebhook = new Hono<Env>();

igWebhook.get("/ig/webhook", (c) => {
  const s = c.get("settings");
  const ok = c.req.query("hub.mode") === "subscribe" && s.ig_verify_token && safeEqual(c.req.query("hub.verify_token") ?? "", s.ig_verify_token);
  return ok ? c.text(c.req.query("hub.challenge") ?? "") : c.text("forbidden", 403);
});

igWebhook.post("/ig/webhook", async (c) => {
  const raw = await c.req.text();
  if (!(await validSignature(raw, c.req.header("x-hub-signature-256"), c.get("settings").meta_app_secret))) return c.text("forbidden", 403);
  let events, comments;
  try {
    const body = JSON.parse(raw);
    events = parseWebhook(body);
    comments = parseComments(body);
  } catch {
    return c.text("bad request", 400);
  }
  const db = c.env.DB;
  const site = (c.get("settings").site_url || new URL(c.req.url).origin).replace(/\/$/, "");
  // Answer Meta at once; file the messages and comments and run the automation in the background.
  c.executionCtx.waitUntil(
    (async () => {
      for (const ev of events) {
        const shop = await shopForAccount(db, ev.accountId);
        if (shop) await handleIgEvent(db, shop, ev).catch((e) => console.error("instagram event", e));
      }
      for (const cm of comments) {
        const shop = await shopForAccount(db, cm.accountId);
        if (shop) await handleIgComment(db, shop, cm, site).catch((e) => console.error("instagram comment", e));
      }
    })(),
  );
  return c.text("ok");
});

/**
 * Daily (cron): long-lived Instagram tokens expire after 60 days, so refresh every token that is a
 * week old. A token that can no longer be refreshed stays as it is; the shop reconnects in settings.
 */
export async function refreshIgTokens(db: D1Database) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { results } = await db
    .prepare("SELECT id, ig_access_token FROM shops WHERE ig_access_token <> '' AND (ig_token_refreshed_at IS NULL OR ig_token_refreshed_at < ?)")
    .bind(weekAgo)
    .all<{ id: number; ig_access_token: string }>();
  for (const s of results) {
    try {
      const token = await refreshToken(s.ig_access_token);
      await db.prepare("UPDATE shops SET ig_access_token = ?, ig_token_refreshed_at = ? WHERE id = ?").bind(token, new Date().toISOString(), s.id).run();
    } catch (e) {
      console.error("instagram token refresh", s.id, e);
    }
  }
}
