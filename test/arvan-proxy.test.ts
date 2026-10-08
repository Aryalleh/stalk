import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module (deploy/arvan-proxy is built separately for ArvanCloud)
import { makeProxy } from "../deploy/arvan-proxy/proxy.mjs";

describe("ArvanCloud edge proxy", () => {
  it("forwards to the Worker with the secret and the visitor's host", async () => {
    let seen: { url: string; init: RequestInit & { headers: Headers } } | null = null;
    const fake = async (url: string, init: RequestInit & { headers: Headers }) => {
      seen = { url, init };
      return new Response("<p>hi</p>", { status: 200, headers: { "content-type": "text/html", "set-cookie": "s=1; Path=/", "content-encoding": "gzip" } });
    };
    const handle = makeProxy({ workerHost: "https://gift.example.workers.dev/", secret: "s".repeat(32), fetch: fake });
    const res: Response = await handle(new Request("https://kadochie.ir/p/1?x=2", { headers: { "x-proxy-secret": "forged", cookie: "a=b" } }));
    expect(seen!.url).toBe("https://gift.example.workers.dev/p/1?x=2");
    const h = seen!.init.headers;
    expect(h.get("x-proxy-secret")).toBe("s".repeat(32)); // a visitor's own header never gets through
    expect(h.get("x-forwarded-host")).toBe("kadochie.ir");
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("cookie")).toBe("a=b");
    expect(seen!.init.redirect).toBe("manual");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>hi</p>");
    expect(res.headers.get("set-cookie")).toContain("s=1");
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("passes POST bodies and redirects through", async () => {
    let body = "";
    const fake = async (_url: string, init: RequestInit) => {
      body = new TextDecoder().decode(init.body as ArrayBuffer);
      return new Response(null, { status: 302, headers: { location: "https://kadochie.ir/me" } });
    };
    const handle = makeProxy({ workerHost: "w.example.workers.dev", secret: "x".repeat(20), fetch: fake });
    const res: Response = await handle(new Request("https://kadochie.ir/login", { method: "POST", body: "phone=0912" }));
    expect(body).toBe("phone=0912");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://kadochie.ir/me");
  });

  it("answers with a friendly 502 when the Worker can't be reached", async () => {
    const handle = makeProxy({ workerHost: "w.example.workers.dev", secret: "x".repeat(20), fetch: async () => { throw new Error("timeout"); } });
    const res: Response = await handle(new Request("https://kadochie.ir/"));
    expect(res.status).toBe(502);
    expect(res.headers.get("x-proxy-error")).toBe("timeout");
  });

  it("has its own health and check pages", async () => {
    const handle = makeProxy({ workerHost: "w.example.workers.dev", secret: "x".repeat(20), fetch: async () => new Response("ok") });
    expect(await (await handle(new Request("https://kadochie.ir/__proxy/health"))).text()).toBe("ok");
    const check = await (await handle(new Request("https://kadochie.ir/__proxy/check"))).json();
    expect(check.get.status).toBe(200);
    expect(check.upload_200kb.status).toBe(200);
  });
});
