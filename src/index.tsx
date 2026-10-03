import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { crm } from "./crm/routes";
import type { Env } from "./env";
import { SESSION_COOKIE, assignUsername, isConnected, needsProfile, sessionUser } from "./session";
import { activeBots } from "./bale/botapi";
import { CONNECT_EXEMPT, connect } from "./bale/connect";
import { appCss } from "./assets";
import { ensureMigrated } from "./migrate";
import { loadSettings } from "./settings";
import { account } from "./shop/routes/account";
import { admin, panel } from "./shop/routes/panel";
import { bot } from "./bale/bot";
import { store } from "./shop/routes/store";
import { miniapp } from "./bale/miniapp";
import { fonts } from "./fonts";
import { pwa } from "./pwa";
import { seo } from "./seo";

// One Worker: the public gift shop at /, the internal CRM at /crm, sharing accounts and the database.
const app = new Hono<Env>();

// Plain-http visits get a permanent redirect to https (local development excepted).
app.use(async (c, next) => {
  const url = new URL(c.req.url);
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.protocol = "https:";
    return c.redirect(url.toString(), 301);
  }
  await next();
});

// Static files that need neither the database nor a session.
app.route("/", fonts);

app.get("/static/app.css", (c) =>
  c.body(appCss, 200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" }),
);

app.use(async (c, next) => {
  await ensureMigrated(c.env.DB);
  await next();
});
// Bale/Telegram web clients show mini apps in an iframe, so those (and only those) may frame the site.
const FRAME_ANCESTORS = ["'self'", "https://web.telegram.org", "https://*.telegram.org", "https://web.bale.ai", "https://*.bale.ai", "https://bale.ai"];
app.use(secureHeaders({ xFrameOptions: false, contentSecurityPolicy: { frameAncestors: FRAME_ANCESTORS } }));
app.use(csrf()); // rejects cross-origin form posts; bot webhooks send JSON and are unaffected

app.use(async (c, next) => {
  const [user, settings] = await Promise.all([sessionUser(c.env.DB, getCookie(c, SESSION_COOKIE)), loadSettings(c.env.DB)]);
  c.set("user", user);
  c.set("settings", settings);
  await next();
});

// Several domains can point at this Worker (custom domains, workers.dev); everything is served on the
// one set as "site address" in /admin/settings — other hosts get a permanent redirect to the same
// path there. Bot webhooks, sign-in and the settings page stay reachable on every host, so a wrong
// address can always be fixed (sign in on workers.dev, open /admin/settings).
const ANY_HOST = /^\/(bot\/|login|logout|setup|admin\/settings|connect|me\/complete|static\/|webfonts\/)/;
app.use(async (c, next) => {
  const canonical = c.get("settings").site_url;
  if (canonical && !ANY_HOST.test(c.req.path)) {
    const url = new URL(c.req.url);
    const target = new URL(canonical);
    if (url.host !== target.host) {
      const to = target.origin + url.pathname + url.search;
      return c.redirect(to, c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308);
    }
  }
  await next();
});

// Every signed-in account must connect the site's Bale/Telegram bot before using the site. Only the
// admin is let through while no bot is connected yet, so they can set one up in /admin/settings.
app.use(async (c, next) => {
  const user = c.get("user");
  const adminSettingUp = user?.is_admin && !activeBots(c.get("settings")).length;
  if (user && !isConnected(user) && !adminSettingUp && !CONNECT_EXEMPT.test(c.req.path)) {
    const back = c.req.method === "GET" ? c.req.path + (new URL(c.req.url).search || "") : "/";
    return c.redirect(`/connect?next=${encodeURIComponent(back)}`);
  }
  await next();
});

// Then every account needs first name, last name and birth date (older accounts are asked once, at
// /me/complete) and a public handle (assigned automatically).
app.use(async (c, next) => {
  const user = c.get("user");
  if (user && !user.username) {
    await assignUsername(c.env.DB, user.id);
    c.set("user", await sessionUser(c.env.DB, getCookie(c, SESSION_COOKIE)));
  }
  if (user && needsProfile(user) && !CONNECT_EXEMPT.test(c.req.path) && c.req.path !== "/me/complete") {
    const back = c.req.method === "GET" ? c.req.path + (new URL(c.req.url).search || "") : "/";
    return c.redirect(`/me/complete?next=${encodeURIComponent(back)}`);
  }
  await next();
});

// Shop pages that need a logged-in user (the CRM checks for itself).
const LOGIN_REQUIRED = /^\/(me|panel|admin)(\/|$)|^\/p\/\d+\/(wish|buy)$/;
app.use(async (c, next) => {
  if (!c.get("user") && LOGIN_REQUIRED.test(c.req.path)) {
    const back = c.req.method === "GET" ? c.req.path : "/";
    return c.redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  await next();
});

app.route("/", pwa);
app.route("/", seo);
app.route("/", miniapp);
app.route("/", connect);
app.route("/crm", crm);
app.route("/", store);
app.route("/", account);
app.route("/", panel);
app.route("/", admin);
app.route("/", bot);

app.notFound((c) => c.text("پیدا نشد", 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse(); // e.g. the CSRF guard's 403
  console.error(err);
  const missingTable = /no such (table|column)/i.test(String(err));
  const body = missingTable
    ? "خطای سرور: جدول‌های دیتابیس به‌روز نیستند. دستور «npx wrangler d1 migrations apply app --remote» را اجرا کنید."
    : "خطای سرور رخ داد. لطفاً دوباره تلاش کنید؛ اگر تکرار شد، لاگ Worker را در داشبورد Cloudflare ببینید.";
  return c.html(
    `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>خطا</title><body style="font-family:Tahoma,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.9">` +
      `<h1>⚠️ خطا</h1><p>${body}</p><p><a href="/">بازگشت به صفحه اصلی</a></p></body></html>`,
    500,
  );
});

export default app;
