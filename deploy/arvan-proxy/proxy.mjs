// Reverse proxy for ArvanCloud Edge Computing: visitors open https://<your domain> on Arvan, and every
// request is forwarded to the Cloudflare Worker (<name>.workers.dev) with the shared X-Proxy-Secret, the
// same way deploy/proxy/install.sh does it with nginx on a server. The Worker (src/proxy.ts) then sees
// the visitor's own address, so links, cookies and redirects use your domain.
//
// Built into one file with the settings baked in: npm run arvan-proxy:build (see docs/proxy.md).
//
// Extra paths answered by the proxy itself:
//   /__proxy/health  → "ok" (the proxy runs)
//   /__proxy/check   → how fast this edge reaches the Worker: a page fetch and a 200 KB upload, timed

const HOP = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host"];

/** @param {{ workerHost: string, secret: string, fetch?: typeof fetch, timeoutMs?: number }} cfg */
export function makeProxy(cfg) {
  const upstreamFetch = cfg.fetch ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 120_000;
  const worker = cfg.workerHost.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // https://<worker> normally; a plain http:// address is kept as is (local tests only).
  const origin = /^http:\/\//.test(cfg.workerHost) ? `http://${worker}` : `https://${worker}`;

  async function timed(url, init) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await upstreamFetch(url, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function check(secret) {
    const headers = { "x-proxy-secret": secret, "x-forwarded-host": "proxy-check.invalid", "x-forwarded-proto": "https" };
    const out = { worker };
    let t = Date.now();
    try {
      const r = await timed(`${origin}/robots.txt`, { headers });
      await r.arrayBuffer();
      out.get = { status: r.status, ms: Date.now() - t };
    } catch (e) {
      out.get = { error: String(e && e.message || e), ms: Date.now() - t };
    }
    t = Date.now();
    try {
      const body = new Uint8Array(200 * 1024);
      const r = await timed(`${origin}/__proxy-upload-check`, { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body });
      await r.arrayBuffer();
      out.upload_200kb = { status: r.status, ms: Date.now() - t };
    } catch (e) {
      out.upload_200kb = { error: String(e && e.message || e), ms: Date.now() - t };
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }

  /** @param {Request} req */
  return async function handle(req) {
    const url = new URL(req.url);
    if (url.pathname === "/__proxy/health") return new Response("ok", { headers: { "cache-control": "no-store" } });
    if (url.pathname === "/__proxy/check") return check(cfg.secret);

    const headers = new Headers();
    for (const [k, v] of req.headers) if (!HOP.includes(k.toLowerCase()) && !k.toLowerCase().startsWith("x-proxy-")) headers.set(k, v);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", url.protocol === "http:" ? "http" : "https");
    const ip = req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || req.headers.get("ar-real-ip") || "";
    if (ip) headers.set("x-forwarded-for", req.headers.get("x-forwarded-for") || ip);
    headers.set("x-proxy-secret", cfg.secret);
    headers.delete("accept-encoding"); // the body is passed through as received; keep it uncompressed and simple

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let res;
    try {
      res = await timed(`${origin}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        // Buffered: some edge runtimes can't stream a request body upstream (photos are shrunk in the browser first).
        body: hasBody ? await req.arrayBuffer() : undefined,
        redirect: "manual",
      });
    } catch (e) {
      const reason = String(e && e.message || e);
      console.log(JSON.stringify({ event: "proxy_error", path: url.pathname, method: req.method, reason }));
      return new Response(
        `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>اتصال برقرار نشد</title>` +
          `<body style="font-family:Tahoma,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;line-height:2;text-align:center">` +
          `<h1>⚠️ اتصال برقرار نشد</h1><p>سرور سایت در دسترس نبود. چند لحظه بعد دوباره امتحان کنید.</p><p><a href="">تلاش دوباره</a></p></body></html>`,
        { status: 502, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-proxy-error": reason.slice(0, 200) } },
      );
    }
    const out = new Headers(res.headers);
    for (const h of ["content-encoding", "content-length", "transfer-encoding", "connection"]) out.delete(h);
    // Buffered for the same reason as the request body; pages and photos are small.
    const body = req.method === "HEAD" || res.status === 204 || res.status === 304 ? null : await res.arrayBuffer();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: out });
  };
}
