import type { Bindings } from "./env";

// Zarinpal v4 REST API; amounts in Toman (currency IRT).

export interface PaymentRequest {
  amount: number;
  description: string;
  callbackUrl: string;
  mobile?: string;
}

export type StartResult = { ok: true; authority: string; redirectUrl: string } | { ok: false; error: string };
export type VerifyResult = { ok: true; refId: string } | { ok: false; error: string };

export interface Gateway {
  start(req: PaymentRequest): Promise<StartResult>;
  verify(authority: string, amount: number): Promise<VerifyResult>;
}

class Zarinpal implements Gateway {
  private base: string;
  constructor(private merchantId: string, sandbox: boolean) {
    this.base = sandbox ? "https://sandbox.zarinpal.com/pg" : "https://payment.zarinpal.com/pg";
  }

  private async post(path: string, body: object) {
    const res = await fetch(`${this.base}/v4/payment/${path}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ merchant_id: this.merchantId, ...body }),
    });
    return (await res.json()) as { data?: { code?: number; authority?: string; ref_id?: number }; errors?: unknown };
  }

  async start(req: PaymentRequest): Promise<StartResult> {
    const r = await this.post("request", {
      amount: req.amount,
      currency: "IRT",
      description: req.description,
      callback_url: req.callbackUrl,
      metadata: req.mobile ? { mobile: req.mobile } : undefined,
    });
    if (r.data?.code === 100 && r.data.authority) {
      return { ok: true, authority: r.data.authority, redirectUrl: `${this.base}/StartPay/${r.data.authority}` };
    }
    return { ok: false, error: `zarinpal request failed: ${JSON.stringify(r.errors ?? r.data)}` };
  }

  async verify(authority: string, amount: number): Promise<VerifyResult> {
    const r = await this.post("verify", { amount, currency: "IRT", authority });
    // 100 = verified now, 101 = already verified earlier (e.g. callback reloaded)
    if ((r.data?.code === 100 || r.data?.code === 101) && r.data.ref_id) return { ok: true, refId: String(r.data.ref_id) };
    return { ok: false, error: `zarinpal verify failed: ${JSON.stringify(r.errors ?? r.data)}` };
  }
}

/** Local-only gateway: redirects to /pay/dev where the tester picks success or failure. */
class DevGateway implements Gateway {
  async start(req: PaymentRequest): Promise<StartResult> {
    const authority = `DEV-${crypto.randomUUID()}`;
    const back = new URL(req.callbackUrl);
    return { ok: true, authority, redirectUrl: `/pay/dev?authority=${authority}&amount=${req.amount}&cb=${encodeURIComponent(back.pathname + back.search)}` };
  }
  async verify(authority: string): Promise<VerifyResult> {
    return { ok: true, refId: `DEVREF-${authority.slice(4, 12)}` };
  }
}

export function gateway(env: Bindings): Gateway | null {
  if (env.ZARINPAL_MERCHANT_ID) return new Zarinpal(env.ZARINPAL_MERCHANT_ID, env.ZARINPAL_SANDBOX === "1");
  if (env.DEV_PAYMENTS === "1") return new DevGateway();
  return null;
}
