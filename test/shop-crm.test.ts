import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { upcomingMonthDays } from "../lib/people";
import { matchesKeyword } from "../src/shop/crm/automation";
import { parseWebhook, validSignature } from "../src/shop/crm/instagram";

describe("instagram webhook", () => {
  const payload = {
    object: "instagram",
    entry: [
      {
        id: "1784",
        messaging: [
          { sender: { id: "555" }, recipient: { id: "1784" }, timestamp: 1700000000000, message: { mid: "m1", text: "سلام قیمت؟" } },
          { sender: { id: "1784" }, recipient: { id: "555" }, timestamp: 1700000001000, message: { mid: "m2", text: "۲۰۰ تومان", is_echo: true } },
          { sender: { id: "555" }, recipient: { id: "1784" }, timestamp: 1700000002000, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] } },
          { sender: { id: "555" }, recipient: { id: "1784" }, timestamp: 1700000003000, message: { mid: "m4", text: "این", reply_to: { story: { url: "s" } } } },
          { sender: { id: "555" }, recipient: { id: "1784" }, message: { mid: "m5", is_deleted: true } },
          { sender: { id: "555" }, recipient: { id: "1784" }, read: { mid: "m1" } },
        ],
      },
    ],
  };

  it("parses DMs, echoes, attachments and story replies", () => {
    const ev = parseWebhook(payload);
    expect(ev.map((e) => [e.mid, e.direction, e.customerId, e.type])).toEqual([
      ["m1", "in", "555", "text"],
      ["m2", "out", "555", "text"],
      ["m3", "in", "555", "image"],
      ["m4", "in", "555", "story_reply"],
    ]);
    expect(ev[0].accountId).toBe("1784");
    expect(ev[2].body).toBe("[image] https://x/y.jpg");
    expect(ev[0].at).toBe(new Date(1700000000000).toISOString());
  });

  it("ignores other objects", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });

  it("checks the signature", async () => {
    const body = JSON.stringify(payload);
    const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
    expect(await validSignature(body, sig, "secret")).toBe(true);
    expect(await validSignature(body + " ", sig, "secret")).toBe(false);
    expect(await validSignature(body, sig, "other")).toBe(false);
    expect(await validSignature(body, undefined, "secret")).toBe(false);
    expect(await validSignature(body, sig, "")).toBe(false);
  });
});

describe("automation", () => {
  it("matches any of the keywords", () => {
    expect(matchesKeyword({ keyword: "قیمت، موجودی" }, "سلام، موجودی دارید؟")).toBe(true);
    expect(matchesKeyword({ keyword: "Price, cost" }, "what's the PRICE")).toBe(true);
    expect(matchesKeyword({ keyword: "قیمت" }, "سلام")).toBe(false);
    expect(matchesKeyword({ keyword: " , " }, "anything")).toBe(false);
  });
});

describe("birthdays", () => {
  it("lists the coming Jalali month-days", () => {
    // 2024-03-19 is 29 Esfand 1402 (Tehran), followed by Farvardin.
    const days = upcomingMonthDays(2, new Date("2024-03-19T08:00:00Z"));
    expect(days).toEqual(["12-29", "01-01", "01-02"]);
  });
});
