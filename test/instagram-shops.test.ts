import { describe, expect, it } from "vitest";
import { fill, parseHandle, parsePostUrl } from "../src/shop/instagram-shops";
import { normalizeCommand } from "../src/shop/commands";

describe("instagram links", () => {
  it("cleans post and reel links", () => {
    expect(parsePostUrl("https://instagram.com/p/DAbc12_xyZ/?igsh=abc")).toBe("https://www.instagram.com/p/DAbc12_xyZ/");
    expect(parsePostUrl("www.instagram.com/reels/C0de-123/")).toBe("https://www.instagram.com/reel/C0de-123/");
    expect(parsePostUrl("https://www.instagram.com/nice.shop/p/ABCDE1/")).toBe("https://www.instagram.com/p/ABCDE1/");
    expect(parsePostUrl("https://example.com/p/ABCDE1/")).toBe("");
  });
  it("reads page handles", () => {
    expect(parseHandle("@Nice.Shop_ir")).toBe("nice.shop_ir");
    expect(parseHandle("https://instagram.com/nice.shop_ir/")).toBe("nice.shop_ir");
    expect(parseHandle("https://instagram.com/p/ABCDE1")).toBe("");
    expect(parseHandle("bad name")).toBe("");
    expect(parseHandle(".dot")).toBe("");
  });
  it("fills message placeholders, leaving unknown ones", () => {
    expect(fill("{shop} — {product} {x}", { shop: "@a", product: "کیف" })).toBe("@a — کیف {x}");
  });
});

describe("chat commands", () => {
  it("folds Persian digits and letters but keeps spaces", () => {
    expect(normalizeCommand("  /تأييد   ۱۲ ")).toBe("تأیید 12");
    expect(normalizeCommand("سفارش‌ها")).toBe("سفارشها");
    expect(normalizeCommand("كارت ۶۰۳۷-۹۹۷۵")).toBe("کارت 6037-9975");
  });
});
