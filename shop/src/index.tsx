import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./env";
import { account } from "./routes/account";
import { admin, bot, panel } from "./routes/panel";
import { store } from "./routes/store";
import { SESSION_COOKIE, sessionUser } from "./session";

const app = new Hono<Env>();

app.use(secureHeaders());
app.use(csrf()); // rejects cross-origin form posts; bot webhooks send JSON and are unaffected

app.use(async (c, next) => {
  c.set("user", await sessionUser(c.env.DB, getCookie(c, SESSION_COOKIE)));
  await next();
});

// Pages that need a logged-in user.
const LOGIN_REQUIRED = /^\/(me|panel|admin)(\/|$)|^\/p\/\d+\/wish$/;
app.use(async (c, next) => {
  if (!c.get("user") && LOGIN_REQUIRED.test(c.req.path)) {
    const back = c.req.method === "GET" ? c.req.path : "/";
    return c.redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  await next();
});

app.route("/", store);
app.route("/", account);
app.route("/", panel);
app.route("/", admin);
app.route("/", bot);

app.notFound((c) => c.text("پیدا نشد", 404));

export default app;
