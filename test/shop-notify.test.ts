import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../src/settings";
import { connectBot, notifyShop, shipMessage, transferMessage } from "../src/shop/notify";

const order = {
  id: 7, product_title: "دسته گل رز", amount: 850000, gift_message: "تولدت مبارک", giver_name: "علی", giver_phone: "09124444444",
  is_anonymous: 0, transfer_ref: "123456789", transfer_card_last4: "4321", transfer_at: "۱۴:۳۰", receipt_key: "r/1/x.png",
  ship_name: "سارا", ship_phone: "09123333333", ship_address: "تهران، آزادی ۱۲", ship_postal_code: "1234567890",
};
const env = { ...DEFAULTS, bale_bot_token: "bale-token" };

afterEach(() => vi.unstubAllGlobals());

describe("transferMessage", () => {
  it("has the transfer details and a panel link, but not the address", () => {
    const text = transferMessage(order, "https://gift.example");
    for (const x of ["#7", "دسته گل رز", "۸۵۰٬۰۰۰", "123456789", "4321", "۱۴:۳۰", "رسید", "09124444444", "https://gift.example/panel/orders/7"]) {
      expect(text).toContain(x);
    }
    expect(text).not.toContain("آزادی");
    expect(text).not.toMatch(/\n\n\n/);
  });
});

describe("shipMessage", () => {
  it("has delivery details, giver and gift message", () => {
    const text = shipMessage(order, "https://gift.example");
    for (const x of ["#7", "سارا", "09123333333", "تهران، آزادی ۱۲", "1234567890", "علی", "تولدت مبارک", "/panel/orders/7"]) {
      expect(text).toContain(x);
    }
  });
  it("hides the giver when anonymous", () => {
    const text = shipMessage({ ...order, is_anonymous: 1, gift_message: "" }, "https://x");
    expect(text).toContain("ناشناس");
    expect(text).not.toContain("علی");
    expect(text).not.toMatch(/\n\n\n/);
  });
});

describe("notifyShop", () => {
  it("posts to the Bale bot API", async () => {
    const fetch = vi.fn(async () => new Response('{"ok":true,"result":{}}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await notifyShop(env, { bale_chat_id: "123", telegram_chat_id: "" }, "hi")).toBe("");
    expect(fetch).toHaveBeenCalledWith("https://tapi.bale.ai/botbale-token/sendMessage", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ chat_id: "123", text: "hi" });
  });
  it("reports failures per channel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":false,"description":"chat not found"}', { status: 400 })));
    const err = await notifyShop(env, { bale_chat_id: "1", telegram_chat_id: "2" }, "hi");
    expect(err).toContain("bale: bale sendMessage 400");
    expect(err).toContain("telegram: telegram bot token is not configured");
  });
  it("needs at least one channel", async () => {
    expect(await notifyShop(env, { bale_chat_id: "", telegram_chat_id: "" }, "hi")).toBe("no channel configured");
  });
});

describe("connectBot", () => {
  it("checks the token and sets the webhook", async () => {
    const fetch = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ ok: true, result: url.endsWith("/getMe") ? { username: "kadoochi_bot" } : true })),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await connectBot("bale", "tok", "https://site.example/bot/bale/sec")).toBe("kadoochi_bot");
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual(["https://tapi.bale.ai/bottok/getMe", "https://tapi.bale.ai/bottok/setWebhook"]);
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ url: "https://site.example/bot/bale/sec" });
  });
  it("surfaces a bad token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 })));
    await expect(connectBot("bale", "bad", "https://x")).rejects.toThrow("Unauthorized");
  });
});
