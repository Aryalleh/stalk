// A reverse proxy in front of the Worker (e.g. a server in Iran, where Cloudflare is blocked, that
// forwards kadochie.ir to *.workers.dev). The Worker then sees its workers.dev address; with the
// shared secret, it takes the visitor's address from X-Forwarded-Host instead, so links, redirects
// and the canonical-domain rule work as if visitors reached it directly. See deploy/proxy.

/** The request as the visitor made it when it comes from our proxy; unchanged otherwise; 403 for a wrong secret. */
export function fromTrustedProxy(req: Request, secret: string | undefined): Request | Response {
  if (!secret) return req;
  const given = req.headers.get("x-proxy-secret");
  if (given === null) return req;
  if (!safeEqual(given, secret)) return new Response("forbidden", { status: 403 });
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return req;
  const url = new URL(req.url);
  url.host = host;
  url.protocol = (req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? "https") === "http" ? "http:" : "https:";
  const headers = new Headers(req.headers);
  headers.delete("x-proxy-secret");
  return new Request(url.toString(), new Request(req, { headers }));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
