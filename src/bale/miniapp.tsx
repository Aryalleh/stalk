import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createSession } from "../../lib/auth";
import { verifyInitData, type InitData } from "../../lib/initdata";
import type { Env } from "../env";
import { render } from "../render";
import { SESSION_COOKIE } from "../session";
import { randomSlug } from "../shop/db";
import { cookieOptions, safeNext } from "../shop/routes/helpers";
import { Layout } from "../shop/views/layout";
import { BOT_KINDS, botToken, type BotKind } from "./botapi";
import { MINIAPP_COOKIE, PENDING_TTL_MS, linkChat, userByChat } from "./chatlink";

// Sign-in from inside Bale / Telegram. Set the bot's mini app (or menu button) URL to <site>/app:
//  - the page reads the signed initData the messenger gives it and posts it here;
//  - a chat already linked to an account is signed in at once (auto login);
//  - otherwise the person signs in once with the usual one-time code, and the chat is linked
//    to their account automatically (which also completes the mandatory bot connection).

export const miniapp = new Hono<Env>();

/** start_param from a t.me/<bot>/<app>?startapp=… link → page to open. */
export function startTarget(param: string) {
  const m = param.match(/^(p|b|h|s|w)_([\w-]{1,60})$/);
  if (!m) return "";
  const [, kind, id] = m;
  if ("pbh".includes(kind) && !/^\d+$/.test(id)) return "";
  // p_ product · b_ buy it (channel post button) · h_ add it to a wishlist · s_ shop · w_ wishlist
  return { p: `/p/${id}`, b: `/p/${id}/buy`, h: `/p/${id}#wish`, s: `/s/${id}`, w: `/w/${id}` }[kind] ?? "";
}

const pageScript = (next: string) => `
(function () {
  var next = ${JSON.stringify(next).replace(/</g, "\\u003c")};
  function sdk() { return (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null) || (window.Bale && Bale.WebApp && Bale.WebApp.initData ? Bale.WebApp : null); }
  function fromHash() { var m = (location.hash || '').match(/tgWebAppData=([^&]*)/); return m ? decodeURIComponent(m[1]) : ''; }
  var tries = 0;
  function go() {
    var app = sdk(), data = app ? app.initData : fromHash();
    if (!data && tries++ < 15) return setTimeout(go, 100); // give the SDK script a moment to load
    if (app) { try { app.ready(); app.expand(); } catch (e) {} }
    if (!data) { document.getElementById('outside').classList.remove('hidden'); document.getElementById('wait').classList.add('hidden'); return; }
    fetch('/app/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ initData: data, next: next }) })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (r.next) location.replace(r.next); else throw new Error(r.error || 'auth'); })
      .catch(function () { document.getElementById('failed').classList.remove('hidden'); document.getElementById('wait').classList.add('hidden'); });
  }
  go();
})();`;

miniapp.get("/app", (c) => {
  const next = safeNext(c.req.query("next"));
  return render(
    c,
    <Layout title="ورود" user={null} nav="none" bare header={<></>}>
      <script src="https://telegram.org/js/telegram-web-app.js" async></script>
      <script src="https://tapi.bale.ai/miniapp.js" async></script>
      <div class="px-6 py-24 text-center">
        <div class="text-6xl mb-6">🎁</div>
        <p id="wait" class="text-sm text-muted"><i class="fa-solid fa-spinner fa-spin ml-2"></i>در حال ورود…</p>
        <div id="outside" class="hidden space-y-4">
          <p class="text-sm text-muted">این صفحه برای باز شدن داخل بله یا تلگرام است.</p>
          <a href="/" class="inline-block px-6 py-3 rounded-2xl bg-brand text-white font-bold">رفتن به سایت</a>
        </div>
        <div id="failed" class="hidden space-y-4">
          <p class="text-sm text-muted">ورود خودکار انجام نشد. با شماره موبایل وارد شوید.</p>
          <a href={`/login?next=${encodeURIComponent(next)}`} class="inline-block px-6 py-3 rounded-2xl bg-brand text-white font-bold">ورود با کد</a>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: pageScript(next) }} />
    </Layout>,
  );
});

miniapp.post("/app/auth", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { initData?: string; next?: string };
  const s = c.get("settings");
  // The data is signed by one of the site's bots; whichever token verifies it tells us which messenger.
  let found: { kind: BotKind; data: InitData } | null = null;
  for (const kind of BOT_KINDS) {
    const data = await verifyInitData(String(body.initData ?? ""), botToken(s, kind));
    if (data) {
      found = { kind, data };
      break;
    }
  }
  if (!found) return c.json({ error: "invalid" }, 401);
  const { kind, data } = found;
  const chatId = String(data.user.id); // a private chat's id is the user's id
  const next = startTarget(data.startParam) || safeNext(body.next);
  const db = c.env.DB;

  const current = c.get("user");
  const owner = await userByChat(db, kind, chatId);
  if (current && (!owner || owner.id === current.id)) {
    // Already signed in here: make sure this chat is connected to the account.
    if (!owner) await linkChat(db, kind, chatId, current.id);
    return c.json({ next });
  }
  if (owner) {
    const { token, maxAge } = await createSession(db, owner.id);
    setCookie(c, SESSION_COOKIE, token, cookieOptions(maxAge, true));
    return c.json({ next });
  }
  // Unknown chat: remember it for this browser and link it after the one-time-code sign-in.
  const token = randomSlug(24);
  const name = [data.user.first_name, data.user.last_name].filter(Boolean).join(" ").slice(0, 80);
  await db.prepare("INSERT INTO miniapp_pending (token, kind, chat_id, name, created_at) VALUES (?, ?, ?, ?, ?)").bind(token, kind, chatId, name, Date.now()).run();
  setCookie(c, MINIAPP_COOKIE, token, cookieOptions(PENDING_TTL_MS / 1000, true));
  return c.json({ next: `/login?next=${encodeURIComponent(next)}` });
});
