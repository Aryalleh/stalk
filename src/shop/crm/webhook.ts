import { Hono } from "hono";
import type { Env } from "../../env";
import { safeEqual } from "../../../lib/auth";
import { handleIgEvent, shopForAccount } from "./automation";
import { parseWebhook, validSignature } from "./instagram";

// Instagram webhook for every shop: set the callback URL <site>/ig/webhook and the verify token from
// /admin/settings in the Meta app, and subscribe to the "messages" field.

export const igWebhook = new Hono<Env>();

igWebhook.get("/ig/webhook", (c) => {
  const s = c.get("settings");
  const ok = c.req.query("hub.mode") === "subscribe" && s.ig_verify_token && safeEqual(c.req.query("hub.verify_token") ?? "", s.ig_verify_token);
  return ok ? c.text(c.req.query("hub.challenge") ?? "") : c.text("forbidden", 403);
});

igWebhook.post("/ig/webhook", async (c) => {
  const raw = await c.req.text();
  if (!(await validSignature(raw, c.req.header("x-hub-signature-256"), c.get("settings").meta_app_secret))) return c.text("forbidden", 403);
  let events;
  try {
    events = parseWebhook(JSON.parse(raw));
  } catch {
    return c.text("bad request", 400);
  }
  const db = c.env.DB;
  // Answer Meta at once; file the messages and run the automation in the background.
  c.executionCtx.waitUntil(
    (async () => {
      for (const ev of events) {
        const shop = await shopForAccount(db, ev.accountId);
        if (shop) await handleIgEvent(db, shop, ev).catch((e) => console.error("instagram event", e));
      }
    })(),
  );
  return c.text("ok");
});
