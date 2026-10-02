import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { crm } from "./crm/routes";
import type { Env } from "./env";
import { SESSION_COOKIE, sessionUser } from "./session";
import { account } from "./shop/routes/account";
import { admin, bot, panel } from "./shop/routes/panel";
import { store } from "./shop/routes/store";

// One Worker: the public gift shop at /, the internal CRM at /crm, sharing accounts and the database.
const app = new Hono<Env>();

app.use(secureHeaders());
app.use(csrf()); // rejects cross-origin form posts; bot webhooks send JSON and are unaffected

app.use(async (c, next) => {
  c.set("user", await sessionUser(c.env.DB, getCookie(c, SESSION_COOKIE)));
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

export default app;
