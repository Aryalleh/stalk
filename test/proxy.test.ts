import { describe, expect, it } from "vitest";
import { fromTrustedProxy } from "../src/proxy";

const viaProxy = (secret: string, extra: Record<string, string> = {}) =>
  new Request("https://gift-shop.example.workers.dev/p/1?x=1", {
    headers: { "x-proxy-secret": secret, "x-forwarded-host": "kadochie.ir", cookie: "s=1", ...extra },
  });

describe("trusted reverse proxy", () => {
  it("takes the visitor's address from the proxy and drops the secret", () => {
    const r = fromTrustedProxy(viaProxy("s3cret"), "s3cret") as Request;
    expect(r.url).toBe("https://kadochie.ir/p/1?x=1");
    expect(r.headers.get("x-proxy-secret")).toBeNull();
    expect(r.headers.get("cookie")).toBe("s=1");
  });

  it("keeps the method and body of form posts", async () => {
    const req = new Request("https://w.workers.dev/login", { method: "POST", body: "phone=0912", headers: { "x-proxy-secret": "k", "x-forwarded-host": "kadochie.ir" } });
    const r = fromTrustedProxy(req, "k") as Request;
    expect(r.method).toBe("POST");
    expect(await r.text()).toBe("phone=0912");
  });

  it("ignores forwarded hosts from anyone else, and refuses a wrong secret", () => {
    const direct = new Request("https://w.workers.dev/", { headers: { "x-forwarded-host": "evil.example" } });
    expect(fromTrustedProxy(direct, "k")).toBe(direct);
    expect(fromTrustedProxy(viaProxy("k"), undefined)).toBeInstanceOf(Request);
    expect((fromTrustedProxy(viaProxy("k"), undefined) as Request).url).toContain("workers.dev");
    expect((fromTrustedProxy(viaProxy("wrong"), "k") as Response).status).toBe(403);
  });
});
