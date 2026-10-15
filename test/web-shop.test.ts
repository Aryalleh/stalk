import { describe, expect, it } from "vitest";
import { parseWebUrl, retailPrice, siteName } from "../src/shop/web-shop";
import { DEFAULTS } from "../src/settings";

describe("parseWebUrl", () => {
  it("cleans Digikala links to the product's canonical address", () => {
    expect(parseWebUrl("ببین https://www.digikala.com/product/dkp-4580513/گوشی-موبایل/?utm_source=x#reviews")).toBe("https://www.digikala.com/product/dkp-4580513/");
    expect(parseWebUrl("https://digikala.com/product/dkp-12/")).toBe("https://www.digikala.com/product/dkp-12/");
  });
  it("keeps other shops' links, without tracking or anchors", () => {
    expect(parseWebUrl("https://basalam.com/x/product/55?utm_campaign=a&color=red#top")).toBe("https://basalam.com/x/product/55?color=red");
  });
  it("leaves Instagram (its own flow) and non-links out", () => {
    expect(parseWebUrl("https://www.instagram.com/p/abc/")).toBeNull();
    expect(parseWebUrl("hello")).toBeNull();
  });
  it("names known sites", () => {
    expect(siteName("https://www.digikala.com/product/dkp-1/")).toBe("دیجی‌کالا");
    expect(siteName("https://shop.example.ir/p/1")).toBe("shop.example.ir");
  });
});

describe("retailPrice", () => {
  it("adds the percent and the fixed fee, rounded up to a thousand toman", () => {
    const s = { ...DEFAULTS, web_fee_percent: "10", web_fee_fixed: "50000" };
    expect(retailPrice(1_000_000, s)).toBe(1_150_000);
    expect(retailPrice(123_456, s)).toBe(186_000); // 135801.6 + 50000 → 185801.6 → 186000
    expect(retailPrice(500_000, { ...DEFAULTS })).toBe(500_000);
    expect(retailPrice(350_000, s)).toBe(435_000); // not 436000 (floating point)
  });
});
