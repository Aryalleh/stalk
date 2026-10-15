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

import { parseProductHtml } from "../src/shop/web-shop";

describe("parseProductHtml (what shops publish on product pages)", () => {
  it("JSON-LD inside @graph, priced in rial", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"کفش ورزشی","image":{"url":"https://x/a.jpg"},"offers":{"@type":"Offer","price":"12500000","priceCurrency":"IRR","availability":"https://schema.org/InStock"}}]}</script>`;
    expect(parseProductHtml(html, "https://basalam.com/a/product/1")).toMatchObject({ title: "کفش ورزشی", price: 1250000, image: "https://x/a.jpg", available: true, site: "باسلام", method: "JSON-LD" });
  });
  it("an aggregate offer (lowest price, toman) and an array of types", () => {
    const html = `<script type="application/ld+json">[{"@type":["Product"],"name":"گوشی","offers":[{"@type":"AggregateOffer","lowPrice":21000000,"priceCurrency":"IRT"}]}]</script>`;
    expect(parseProductHtml(html, "https://torob.com/p/x/")).toMatchObject({ price: 21000000, site: "ترب" });
  });
  it("out of stock", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"x y z","offers":{"price":5000000,"priceCurrency":"IRR","availability":"http://schema.org/OutOfStock"}}</script>`;
    expect(parseProductHtml(html, "https://a.ir/p")?.available).toBe(false);
  });
  it("product meta tags (Magento / WooCommerce)", () => {
    const html = `<meta property="og:title" content="مانتو کتان"><meta property="og:image" content="https://m/i.jpg"><meta property="product:price:amount" content="3,450,000"><meta property="product:price:currency" content="IRR">`;
    expect(parseProductHtml(html, "https://www.modiseh.com/x")).toMatchObject({ title: "مانتو کتان", price: 345000, image: "https://m/i.jpg", method: "meta product:price" });
  });
  it("microdata", () => {
    const html = `<title>ساعت مچی</title><span itemprop="price" content="8900000"></span><meta itemprop="priceCurrency" content="IRR">`;
    expect(parseProductHtml(html, "https://shop.ir/w")).toMatchObject({ title: "ساعت مچی", price: 890000, method: "microdata" });
  });
  it("Next.js page data", () => {
    const data = { props: { pageProps: { product: { id: 7, title_fa: "کتاب صوتی", images: { main: { url: ["https://k/1.jpg"] } }, price: { selling_price: 1990000 }, status: "marketable" } } } };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    expect(parseProductHtml(html, "https://www.digikala.com/product/dkp-7/")).toMatchObject({ title: "کتاب صوتی", price: 199000, method: "__NEXT_DATA__" });
  });
  it("no price anywhere: name and photo only", () => {
    const r = parseProductHtml(`<meta property="og:title" content="شمع"><meta property="og:image" content="https://s/1.jpg">`, "https://s.ir/1");
    expect(r).toMatchObject({ title: "شمع", price: null });
  });
});

describe("app-shell pages", () => {
  // What www.digikala.com/product/dkp-…/ returns now: the app loads the product itself (from its API).
  const shell = `<html><head><title data-next-head="">فروشگاه اینترنتی دیجی‌کالا</title><link rel="canonical" href="https://www.digikala.com/routing/" data-next-head=""/></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}},"page":"/routing","query":{},"buildId":"x","nextExport":true}</script></body></html>`;
  it("are not taken for a product (no item named after the shop)", () => {
    expect(parseProductHtml(shell, "https://www.digikala.com/product/dkp-1/")).toBeNull();
  });
});

describe("Digikala's page for search engines", () => {
  it("an offer priced 0 is out of stock", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"هدفون","offers":{"@type":"Offer","priceCurrency":"IRR","price":0}}</script>`;
    expect(parseProductHtml(html, "https://www.digikala.com/product/dkp-1/")).toMatchObject({ title: "هدفون", price: null, available: false });
  });
});

describe("the price shown on Digikala's page", () => {
  it("is read from price-container (toman, Persian digits) when JSON-LD says 0", () => {
    const html =
      `<script type="application/ld+json">{"@type":"Product","name":"ماوس بی‌سیم","offers":{"@type":"Offer","priceCurrency":"IRR","price":0}}</script>` +
      `<div class="x"><span>۱,۲۰۰,۰۰۰</span><div data-theme-animation="price-container">۸۰۹,۹۰۰</div><div data-theme-animation="price-container">۹۹۹,۰۰۰</div></div>`;
    expect(parseProductHtml(html, "https://www.digikala.com/product/dkp-2/")).toMatchObject({ title: "ماوس بی‌سیم", price: 809900, available: true, method: "تگ قیمت صفحه (price-container)" });
  });
  it("Latin digits and nested tags too", () => {
    const html = `<title>کیف</title><div data-theme-animation="price-container"><span>1,250,000</span></div>`;
    expect(parseProductHtml(html, "https://www.digikala.com/product/dkp-3/")?.price).toBe(1250000);
  });
});

describe("Digikala's real JSON-LD (as Googlebot gets it)", () => {
  // dkp-4580513, out of stock at the time.
  const ld = (offers: object) =>
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      "@context": "https://www.schema.org",
      name: "تاپ زنانه مدل ha178",
      alternateName: "",
      image: [
        "https://dkstatics-public.digikala.com/digikala-products/e715387a7a8033faa2cadd709d6d7856d5e2eca1_1614534422.jpg?x-oss-process=image/resize,h_1600/quality,q_80",
        "https://dkstatics-public.digikala.com/digikala-products/3752b50540a826b75cf442a581efdcf84f752d8a_1614534432.jpg?x-oss-process=image/resize,h_1600/quality,q_80",
      ],
      mpn: 4580513,
      sku: 4580513,
      brand: { "@type": "Brand", name: "متفرقه" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: 3, reviewCount: 2 },
      offers,
    })}</script>`;
  it("out of stock: name and photo, not available", () => {
    const r = parseProductHtml(ld({ "@type": "Offer", priceCurrency: "IRR", price: 0, itemCondition: "https://schema.org/NewCondition", availability: "https://schema.org/OutOfStock" }), "https://www.digikala.com/product/dkp-4580513/");
    expect(r).toMatchObject({ title: "تاپ زنانه مدل ha178", price: null, available: false, site: "دیجی‌کالا" });
    expect(r?.image).toContain("e715387a7a8033faa2cadd709d6d7856d5e2eca1");
  });
  it("in stock: the price in rial becomes toman", () => {
    const r = parseProductHtml(ld({ "@type": "Offer", priceCurrency: "IRR", price: 8099000, availability: "https://schema.org/InStock" }), "https://www.digikala.com/product/dkp-4580513/");
    expect(r).toMatchObject({ price: 809900, available: true, method: "JSON-LD" });
  });
});
