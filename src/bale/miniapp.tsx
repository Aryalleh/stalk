import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createSession } from "../../lib/auth";
import { checkInitData, type InitData } from "../../lib/initdata";
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

const pageScript = (next: string, fallback: string) => `
(function () {
  var next = ${JSON.stringify(next).replace(/</g, "\\u003c")};
  // The page a startapp link points to (shop, product, wishlist): opened even when sign-in can't happen.
  var fallback = ${JSON.stringify(fallback).replace(/</g, "\\u003c")};
  function sdk() { return (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null) || (window.Bale && Bale.WebApp && Bale.WebApp.initData ? Bale.WebApp : null); }
  function fromHash() { var m = (location.hash || '').match(/tgWebAppData=([^&]*)/); return m ? decodeURIComponent(m[1]) : ''; }
  var tries = 0;
  function go() {
    var app = sdk(), data = app ? app.initData : fromHash();
    if (!data && tries++ < 15) return setTimeout(go, 100); // give the SDK script a moment to load
    if (app) { try { app.ready(); app.expand(); } catch (e) {} }
    if (!data) {
      report('no initData (opened outside the app, or the messenger SDK did not load)' + (fallback ? '; opening ' + fallback : ''));
      if (fallback) return location.replace(fallback);
      document.getElementById('outside').classList.remove('hidden'); document.getElementById('wait').classList.add('hidden'); return;
    }
    fetch('/app/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ initData: data, next: next }) })
      .then(function (r) { return r.json().catch(function () { return { error: 'http_' + r.status }; }); })
      .then(function (r) { if (r.next) location.replace(r.next); else if (r.open) location.replace(r.open); else fail(r.error || 'auth'); })
      .catch(function (e) { report('network: ' + (e && e.message || e)); if (fallback) location.replace(fallback); else fail('network: ' + (e && e.message || e)); });
  }
  function fail(code) {
    document.getElementById('failed').classList.remove('hidden'); document.getElementById('wait').classList.add('hidden');
    var c = document.getElementById('fail-code'); if (c) c.textContent = code;
  }
  function report(detail) {
    try { navigator.sendBeacon('/app/log', JSON.stringify({ detail: String(detail).slice(0, 300), sdk: !!sdk(), hash: !!fromHash() })); } catch (e) {}
  }
  go();
})();`;

miniapp.get("/app", (c) => {
  const next = safeNext(c.req.query("next"));
  // Telegram adds the startapp value to the address of the main mini app as well as to initData.
  const fallback = startTarget(c.req.query("tgWebAppStartParam") ?? c.req.query("startapp") ?? "");
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
          <p class="text-[11px] text-muted/70">کد خطا: <span id="fail-code" class="ltr font-mono"></span></p>
          <a href={`/login?next=${encodeURIComponent(next)}`} class="inline-block px-6 py-3 rounded-2xl bg-brand text-white font-bold">ورود با کد</a>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: pageScript(next, fallback) }} />
    </Layout>,
  );
});

/** Keep a record of mini-app sign-ins (shown in /admin/settings) and print it to the Worker log. */
async function logAttempt(c: Parameters<typeof render>[0], row: { kind?: string; result: string; detail?: string; chatId?: string }) {
  const entry = { kind: row.kind ?? "", result: row.result, detail: (row.detail ?? "").slice(0, 400), chat_id: row.chatId ?? "" };
  console.log(JSON.stringify({ event: "miniapp_auth", ...entry }));
  const ua = (c.req.header("user-agent") ?? "").slice(0, 200);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO miniapp_log (at, kind, result, detail, chat_id, user_agent) VALUES (?, ?, ?, ?, ?, ?)").bind(new Date().toISOString(), entry.kind, entry.result, entry.detail, entry.chat_id, ua),
    c.env.DB.prepare("DELETE FROM miniapp_log WHERE id <= (SELECT MAX(id) - 200 FROM miniapp_log)"),
  ]).catch((e) => console.error("miniapp_log", e));
}

// Errors the page itself hits (no initData, network): logged too.
miniapp.post("/app/log", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { detail?: string; sdk?: boolean; hash?: boolean };
  await logAttempt(c, { result: "client_error", detail: `${String(body.detail ?? "").slice(0, 300)} (sdk=${!!body.sdk}, hash=${!!body.hash})` });
  return c.body(null, 204);
});

miniapp.post("/app/auth", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { initData?: string; next?: string };
  const s = c.get("settings");
  const raw = String(body.initData ?? "");
  // The data is signed by one of the site's bots; whichever token verifies it tells us which messenger.
  let found: { kind: BotKind; data: InitData } | null = null;
  const problems: string[] = [];
  for (const kind of BOT_KINDS) {
    const r = await checkInitData(raw, botToken(s, kind));
    if (r.data) {
      found = { kind, data: r.data };
      break;
    }
    problems.push(`${kind}:${r.problem}`);
  }
  if (!found) {
    const fields = [...new URLSearchParams(raw).keys()].join(",");
    await logAttempt(c, { result: "failed", detail: `${problems.join(" ")} | fields=${fields} | length=${raw.length}` });
    // Name the likely cause: a valid-looking payload that no token verifies usually means the mini app
    // belongs to a different bot than the one whose token is in the admin settings.
    const code = problems.every((p) => p.endsWith(":no_token")) ? "no_bot_token" : problems.some((p) => p.endsWith(":expired")) ? "expired" : problems.some((p) => p.endsWith(":bad_hash")) ? "bad_signature" : problems[0] ?? "invalid";
    // Can't sign in, but a shop / product / wishlist link still opens (pages that need an account ask for it).
    const open = startTarget(new URLSearchParams(raw).get("start_param") ?? "");
    return c.json({ error: code, ...(open ? { open } : {}) }, 401);
  }
  const { kind, data } = found;
  const chatId = String(data.user.id); // a private chat's id is the user's id
  const next = startTarget(data.startParam) || safeNext(body.next);
  const db = c.env.DB;

  const current = c.get("user");
  const owner = await userByChat(db, kind, chatId);
  if (current && (!owner || owner.id === current.id)) {
    // Already signed in here: make sure this chat is connected to the account.
    if (!owner) await linkChat(db, kind, chatId, current.id);
    await logAttempt(c, { kind, result: "linked", detail: `user ${current.id}`, chatId });
    return c.json({ next });
  }
  if (owner) {
    const { token, maxAge } = await createSession(db, owner.id);
    setCookie(c, SESSION_COOKIE, token, cookieOptions(maxAge, true));
    await logAttempt(c, { kind, result: "signed_in", detail: `user ${owner.id}`, chatId });
    return c.json({ next });
  }
  // Unknown chat: remember it for this browser and link it after the one-time-code sign-in.
  const token = randomSlug(24);
  const name = [data.user.first_name, data.user.last_name].filter(Boolean).join(" ").slice(0, 80);
  await db.prepare("INSERT INTO miniapp_pending (token, kind, chat_id, name, created_at) VALUES (?, ?, ?, ?, ?)").bind(token, kind, chatId, name, Date.now()).run();
  setCookie(c, MINIAPP_COOKIE, token, cookieOptions(PENDING_TTL_MS / 1000, true));
  // A startapp link to a page anyone may see opens it straight away; signing in later still links this chat.
  const target = startTarget(data.startParam);
  const browse = !!target && !/\/buy$|#wish$/.test(target);
  await logAttempt(c, { kind, result: "needs_login", detail: `chat not linked to an account yet${browse ? `; opening ${target}` : ""}`, chatId });
  return c.json({ next: browse ? target : `/login?next=${encodeURIComponent(next)}` });
});
