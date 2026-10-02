import { afterEach, describe, expect, it, vi } from "vitest";
import { connectBot, sendPhotoToChats, sendToChats } from "../src/bale/botapi";
import { DEFAULTS } from "../src/settings";
import { deliveryOptions, normCity } from "../src/shop/db";
import { receiptButtons, receiptCaption, shipMessage } from "../src/shop/notify";

const order = {
  id: 7, product_title: "دسته گل رز", size: "M", amount: 1_000_000, item_price: 850_000, package_name: "جعبه کادو", package_price: 50_000,
  delivery_method: "courier", delivery_fee: 100_000, gift_message: "تولدت مبارک", giver_name: "علی", giver_phone: "09124444444",
  is_anonymous: 0, ship_name: "سارا", ship_phone: "09123333333", ship_city: "تهران", ship_address: "تهران، آزادی ۱۲", ship_postal_code: "1234567890",
};
const s = { ...DEFAULTS, bale_bot_token: "bale-token" };
afterEach(() => vi.unstubAllGlobals());

describe("order messages", () => {
  it("receipt caption has the breakdown and buyer, not the address", () => {
    const text = receiptCaption(order);
    for (const x of ["#7", "دسته گل رز", "جعبه کادو", "پیک", "۱٬۰۰۰٬۰۰۰", "09124444444"]) expect(text).toContain(x);
    expect(text).not.toContain("آزادی");
  });
  it("receipt buttons carry the order id; panel link only on https", () => {
    expect(receiptButtons(7, "http://localhost").inline_keyboard).toEqual([
      [{ text: "✅ تأیید واریز", callback_data: "pay:ok:7" }, { text: "❌ رد واریز", callback_data: "pay:no:7" }],
    ]);
    expect(receiptButtons(7, "https://x.ir").inline_keyboard[1][0].url).toBe("https://x.ir/panel/orders/7");
  });
  it("ship message has delivery details and hides an anonymous giver", () => {
    const text = shipMessage(order, "https://gift.example");
    for (const x of ["سایز M", "سارا", "09123333333", "شهر: تهران", "تهران، آزادی ۱۲", "1234567890", "علی", "تولدت مبارک", "/panel/orders/7"]) expect(text).toContain(x);
    const anon = shipMessage({ ...order, is_anonymous: 1, gift_message: "" }, "https://x");
    expect(anon).toContain("ناشناس");
    expect(anon).not.toContain("علی");
    expect(anon).not.toMatch(/\n\n\n/);
  });
});

describe("delivery options", () => {
  const shop = { city: "شیراز", courier_enabled: 1, courier_fee: 80_000, post_enabled: 1, post_fee: 120_000 };
  it("courier only in the shop's city, post everywhere", () => {
    expect(deliveryOptions(shop, "شيراز ")).toEqual([{ method: "courier", fee: 80_000 }, { method: "post", fee: 120_000 }]);
    expect(deliveryOptions(shop, "تهران")).toEqual([{ method: "post", fee: 120_000 }]);
    expect(deliveryOptions({ ...shop, post_enabled: 0 }, "تهران")).toEqual([]);
    expect(deliveryOptions(shop, "")).toEqual([{ method: "post", fee: 120_000 }]);
  });
  it("normalizes Arabic letters and spaces", () => {
    expect(normCity("  كرمانشاه ")).toBe("کرمانشاه");
  });
});

describe("bot api", () => {
  it("sends text to every connected chat and reports failures", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("tapi.bale.ai") ? new Response('{"ok":true,"result":{}}') : new Response('{"ok":false,"description":"chat not found"}', { status: 400 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await sendToChats(s, { bale_chat_id: "1", telegram_chat_id: "" }, "hi")).toBe("");
    expect(fetch).toHaveBeenCalledWith("https://tapi.bale.ai/botbale-token/sendMessage", expect.objectContaining({ method: "POST" }));
    // telegram has no token configured -> skipped
    expect(await sendToChats(s, { bale_chat_id: "", telegram_chat_id: "2" }, "hi")).toBe("no connected chat");
  });

  it("uploads a photo with caption and inline buttons", async () => {
    const fetch = vi.fn(async () => new Response('{"ok":true,"result":{}}'));
    vi.stubGlobal("fetch", fetch);
    const photo = { data: new Uint8Array([1, 2, 3]).buffer, type: "image/png", name: "r.png" };
    expect(await sendPhotoToChats(s, { bale_chat_id: "9", telegram_chat_id: "" }, photo, "cap", () => receiptButtons(3, "http://x"))).toBe("");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tapi.bale.ai/botbale-token/sendPhoto");
    const body = init.body as FormData;
    expect(body.get("chat_id")).toBe("9");
    expect(body.get("caption")).toBe("cap");
    expect(JSON.parse(body.get("reply_markup") as string).inline_keyboard[0][0].callback_data).toBe("pay:ok:3");
    expect((body.get("photo") as File).size).toBe(3);
  });

  it("connectBot checks the token, sets the webhook and the mini-app menu button", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/setChatMenuButton")
        ? new Response(JSON.stringify({ ok: false, description: "not supported" }), { status: 400 }) // must not fail the connect
        : new Response(JSON.stringify({ ok: true, result: url.endsWith("/getMe") ? { username: "kadoochi_bot" } : true })),
    );
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await connectBot("bale", "tok", "https://site.example/bot/bale/sec", "https://site.example/app", "کادوچی")).toBe("kadoochi_bot");
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual([
      "https://tapi.bale.ai/bottok/getMe",
      "https://tapi.bale.ai/bottok/setWebhook",
      "https://tapi.bale.ai/bottok/setChatMenuButton",
    ]);
    expect(JSON.parse(calls[2][1].body as string).menu_button.web_app.url).toBe("https://site.example/app");
  });
});

describe("bot connect errors", () => {
  it("names the domain when Telegram can't resolve it", async () => {
    const { connectErrorMessage } = await import("../src/shop/routes/panel");
    const msg = connectErrorMessage("telegram setWebhook 400: Bad Request: bad webhook: Failed to resolve host", "shop.example.ir", true);
    expect(msg).toContain("shop.example.ir");
    expect(msg).toContain("«آدرس سایت»");
    expect(connectErrorMessage("bale getMe 401: Unauthorized", "x", false)).toContain("توکن بات نامعتبر");
  });
});
