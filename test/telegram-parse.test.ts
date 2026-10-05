import { describe, expect, it } from "vitest";
import { parsePost, parsePrice } from "../src/shop/telegram/parse";

describe("telegram post → product", () => {
  it("reads prices the way shops write them", () => {
    expect(parsePrice("قیمت: ۴۵۰ هزار تومان")).toBe(450_000);
    expect(parsePrice("قیمت ۴۵۰٬۰۰۰ تومان")).toBe(450_000);
    expect(parsePrice("💰 1.2 میلیون")).toBe(1_200_000);
    expect(parsePrice("قیمت: ۱/۵ میلیون")).toBe(1_500_000);
    expect(parsePrice("price: 4,500,000 ریال")).toBe(450_000);
    expect(parsePrice("قیمت ۴۵۰ت")).toBe(450_000);
    expect(parsePrice("قیمت: ۵۰۰ ۴۵۰ هزار")).toBe(450_000); // old price struck through, new price last
    expect(parsePrice("قیمت: تماس بگیرید")).toBe(0);
  });

  it("parses a tagged caption", () => {
    const p = parsePost("تی‌شرت نخی 👕\nپارچه پنبه، قابل شستشو\nرنگ: مشکی، سفید و سرمه‌ای\nقیمت: ۴۵۰ هزار تومان\n#محصول #تابستان", "#محصول");
    expect(p).toEqual({ title: "تی‌شرت نخی 👕", price: 450_000, description: "پارچه پنبه، قابل شستشو", colors: ["مشکی", "سفید", "سرمه‌ای"] });
  });

  it("ignores posts without the tag or a price", () => {
    expect(parsePost("تخفیف ویژه فردا!\nقیمت: ۱۰۰ هزار", "#محصول")).toBeNull();
    expect(parsePost("کیف چرمی #محصول\nبه زودی", "#محصول")).toBeNull();
  });

  it("finds a bare amount line and keeps the tag out of the title", () => {
    expect(parsePost("کیف چرمی #محصول\n۸۹۰ هزار تومان", "محصول")).toEqual({ title: "کیف چرمی", price: 890_000, description: "", colors: [] });
  });
});

import { startTarget } from "../src/bale/miniapp";
describe("mini app start parameters", () => {
  it("opens the product, its buy page, the wishlist sheet, a shop or a wishlist", () => {
    expect(startTarget("p_12")).toBe("/p/12");
    expect(startTarget("b_12")).toBe("/p/12/buy");
    expect(startTarget("h_12")).toBe("/p/12#wish");
    expect(startTarget("s_rose-shop")).toBe("/s/rose-shop");
    expect(startTarget("w_abc123")).toBe("/w/abc123");
    expect(startTarget("b_rose")).toBe("");
    expect(startTarget("x_1")).toBe("");
  });
});
