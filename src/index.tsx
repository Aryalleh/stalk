import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { crm } from "./crm/routes";
import type { Env } from "./env";
import { SESSION_COOKIE, sessionUser } from "./session";
import { ensureMigrated } from "./migrate";
import { loadSettings } from "./settings";
import { account } from "./shop/routes/account";
import { admin, panel } from "./shop/routes/panel";
import { bot } from "./bale/bot";
import { store } from "./shop/routes/store";

// One Worker: the public gift shop at /, the internal CRM at /crm, sharing accounts and the database.
const app = new Hono<Env>();

app.use(async (c, next) => {
  await ensureMigrated(c.env.DB);
  await next();
});
app.use(secureHeaders());
app.use(csrf()); // rejects cross-origin form posts; bot webhooks send JSON and are unaffected

app.use(async (c, next) => {
  const [user, settings] = await Promise.all([sessionUser(c.env.DB, getCookie(c, SESSION_COOKIE)), loadSettings(c.env.DB)]);
  c.set("user", user);
  c.set("settings", settings);
  await next();
});

// Shop pages that need a logged-in user (the CRM checks for itself).
const LOGIN_REQUIRED = /^\/(me|panel|admin)(\/|$)|^\/p\/\d+\/wish$/;
app.use(async (c, next) => {
  if (!c.get("user") && LOGIN_REQUIRED.test(c.req.path)) {
    const back = c.req.method === "GET" ? c.req.path : "/";
    return c.redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  await next();
});

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
