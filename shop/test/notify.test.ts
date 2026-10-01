import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";
import { notifyShop, orderMessage } from "../src/notify";

const order = {
  id: 7, product_title: "دسته گل رز", amount: 850000, gift_message: "تولدت مبارک", giver_name: "علی", is_anonymous: 0,
  ship_name: "سارا", ship_phone: "09123333333", ship_address: "تهران، آزادی ۱۲", ship_postal_code: "1234567890",
};
const env = { BALE_BOT_TOKEN: "bale-token" } as Bindings;

afterEach(() => vi.unstubAllGlobals());

describe("orderMessage", () => {
  it("has delivery details, giver and a panel link", () => {
    const text = orderMessage(order, "https://gift.example");
    for (const s of ["#7", "دسته گل رز", "۸۵۰٬۰۰۰", "سارا", "09123333333", "تهران، آزادی ۱۲", "1234567890", "علی", "تولدت مبارک", "https://gift.example/panel/orders/7"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toMatch(/\n\n\n/);
  });
  it("hides the giver when anonymous", () => {
    const text = orderMessage({ ...order, is_anonymous: 1, gift_message: "" }, "https://x");
    expect(text).toContain("ناشناس");
    expect(text).not.toContain("علی");
  });
});

describe("notifyShop", () => {
  it("posts to the Bale bot API", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await notifyShop(env, { bale_chat_id: "123", telegram_chat_id: "" }, "hi")).toBe("");
    expect(fetch).toHaveBeenCalledWith("https://tapi.bale.ai/botbale-token/sendMessage", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ chat_id: "123", text: "hi" });
  });
  it("reports failures per channel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad chat", { status: 400 })));
    const err = await notifyShop(env, { bale_chat_id: "1", telegram_chat_id: "2" }, "hi");
    expect(err).toContain("bale: bale sendMessage 400");
    expect(err).toContain("telegram: telegram bot token is not configured");
  });
  it("needs at least one channel", async () => {
    expect(await notifyShop(env, { bale_chat_id: "", telegram_chat_id: "" }, "hi")).toBe("no channel configured");
  });
});
