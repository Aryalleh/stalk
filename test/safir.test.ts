import { afterEach, describe, expect, it, vi } from "vitest";
import { SafirError, sendSafirOtp, sendSafirText, toSafirPhone } from "../src/bale/safir";
import { newCode } from "../src/bale/otp";
import { DEFAULTS } from "../src/settings";

const s = { ...DEFAULTS, safir_api_key: "KEY", safir_bot_id: "123456789" };
afterEach(() => vi.unstubAllGlobals());

describe("safir", () => {
  it("formats phones as 98xxxxxxxxxx", () => {
    expect(toSafirPhone("09121234567")).toBe("989121234567");
    expect(() => toSafirPhone("9121234567")).toThrow(SafirError);
  });

  it("sends an OTP with the key header, bot id and a request id", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ message_id: "m1" })));
    vi.stubGlobal("fetch", fetch);
    expect(await sendSafirOtp(s, "09121234567", "123456")).toBe("m1");
    const [url, init] = (fetch.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe("https://safir.bale.ai/api/v3/send_message");
    expect((init.headers as Record<string, string>)["api-access-key"]).toBe("KEY");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ bot_id: 123456789, phone_number: "989121234567", message_data: { otp_message: { otp: "123456" } } });
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("maps Safir error codes to Persian messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error_data: [{ phone_number: "98912", code: 17, description: "NotBaleUser" }] }))));
    await expect(sendSafirText(s, "09121234567", "hi")).rejects.toThrow("این شماره حساب بله ندارد");
  });

  it("refuses when not configured", async () => {
    await expect(sendSafirText(DEFAULTS, "09121234567", "hi")).rejects.toThrow("سفیر");
  });

  it("makes 6-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
});

describe("safir transport errors", () => {
  it("reports HTTP failures as a connection problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    await expect(sendSafirText(s, "09121234567", "hi")).rejects.toThrow("HTTP 403");
  });
});
