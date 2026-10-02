import { describe, expect, it } from "vitest";
import { cleanContact, CONTACT_KEY } from "../src/crm/fields";
import { buildSnapshot, diffContact, type LogRow } from "../src/crm/history";
import { formatJalali, parseJalali, toGregorian, toJalali } from "../lib/jalali";
import { cardNumberError, nationalCodeError, normalizeHandle, normalizePhone } from "../lib/normalize";

describe("normalize", () => {
  it("phones", () => {
    for (const raw of ["+98 912 123 4567", "00989121234567", "۰۹۱۲۱۲۳۴۵۶۷", "9121234567", "0912-123-4567", "989121234567"]) {
      expect(normalizePhone(raw), raw).toBe("09121234567");
    }
    expect(normalizePhone("")).toBe("");
  });
  it("handles", () => {
    expect(normalizeHandle("@ali_r")).toBe("ali_r");
    expect(normalizeHandle("https://instagram.com/ali_r/")).toBe("ali_r");
    expect(normalizeHandle("t.me/ali_r")).toBe("ali_r");
    expect(normalizeHandle("https://x.com/ali_r?s=1")).toBe("ali_r");
  });
  it("national code", () => {
    expect(nationalCodeError("0499370899")).toBeNull();
    expect(nationalCodeError("0499370898")).not.toBeNull();
    expect(nationalCodeError("1111111111")).not.toBeNull();
    expect(nationalCodeError("123")).not.toBeNull();
  });
  it("bank card numbers", () => {
    expect(cardNumberError("6037997599999993")).toBeNull();
    expect(cardNumberError("6037997599999994")).not.toBeNull();
    expect(cardNumberError("6037")).not.toBeNull();
  });
  it("cleanContact normalizes before validating", () => {
    const { data, errors } = cleanContact({ national_code: "۰۴۹۹۳۷۰۸۹۹", phone: "۰۹۱۲ ۱۲۳ ۴۵۶۷", postal_code: "12345" });
    expect(data.national_code).toBe("0499370899");
    expect(data.phone).toBe("09121234567");
    expect(Object.keys(errors)).toEqual(["postal_code"]);
  });
});

describe("jalali", () => {
  it("converts known dates", () => {
    expect(toJalali(2026, 10, 1)).toEqual({ jy: 1405, jm: 7, jd: 9 });
    expect(toJalali(2024, 3, 20)).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(toGregorian(1403, 12, 30)).toEqual({ gy: 2025, gm: 3, gd: 20 }); // 1403 is leap
  });
  it("formats in Tehran time and round-trips", () => {
    expect(formatJalali("2026-10-01T10:00:00.000Z")).toBe("1405/07/09 13:30:00");
    expect(formatJalali("2026-10-01T21:00:00.000Z")).toBe("1405/07/10 00:30:00");
    expect(parseJalali("۱۴۰۵/۰۷/۰۹ ۱۳:۳۰")).toBe("2026-10-01T10:00:00.999Z");
    expect(parseJalali("1405/07/09")).toBe("2026-10-01T20:29:59.999Z");
    expect(parseJalali("1405/13/01")).toBeNull();
    expect(parseJalali("hello")).toBeNull();
  });
});

describe("history", () => {
  const labels = new Map([[1, "ایمیل"]]);
  it("diffs create, update and extras", () => {
    const created = diffContact(null, { core: { first_name: "علی" }, extras: new Map([[1, "a@x"]]) }, labels);
    expect(created.map((e) => [e.field_name, e.action, e.new_value])).toEqual([
      [CONTACT_KEY, "create", ""],
      ["first_name", "create", "علی"],
      ["extra:1", "create", "a@x"],
    ]);
    const updated = diffContact(
      { core: { first_name: "علی", phone: "0912" }, extras: new Map([[1, "a@x"]]) },
      { core: { first_name: "علی", phone: "0935" }, extras: new Map() },
      labels,
    );
    expect(updated.map((e) => [e.field_name, e.action, e.old_value, e.new_value])).toEqual([
      ["phone", "update", "0912", "0935"],
      ["extra:1", "delete", "a@x", ""],
    ]);
    expect(diffContact({ core: { a: "" }, extras: new Map() }, { core: {}, extras: new Map() }, labels)).toEqual([]);
  });

  it("rebuilds state at a past time", () => {
    let id = 0;
    const log = (at: string, field_name: string, action: LogRow["action"], new_value = "", field_label = field_name): LogRow => ({
      id: ++id, contact_id: 1, contact_repr: "x", username: "u", changed_at: at, field_name, field_label, action, old_value: "", new_value,
    });
    const logs = [
      log("2026-01-01T00:00:00.000Z", CONTACT_KEY, "create"),
      log("2026-01-01T00:00:00.000Z", "phone", "create", "0912"),
      log("2026-01-01T00:00:00.000Z", "extra:1", "create", "a@x", "ایمیل"),
      log("2026-02-01T00:00:00.000Z", "phone", "update", "0935"),
      log("2026-03-01T00:00:00.000Z", "extra:1", "delete"),
      log("2026-04-01T00:00:00.000Z", CONTACT_KEY, "delete"),
    ];
    const at = (iso: string) => buildSnapshot(logs, iso);
    const phone = (s: ReturnType<typeof at>) => s.fields.find(([l]) => l === "شماره تماس")![1];
    expect(at("2025-12-31T00:00:00.000Z").exists).toBe(false);
    expect(phone(at("2026-01-15T00:00:00.000Z"))).toBe("0912");
    expect(at("2026-01-15T00:00:00.000Z").extras).toEqual([["ایمیل", "a@x"]]);
    expect(phone(at("2026-02-15T00:00:00.000Z"))).toBe("0935");
    expect(at("2026-03-15T00:00:00.000Z").extras).toEqual([]);
    const gone = at("2026-05-01T00:00:00.000Z");
    expect([gone.exists, gone.deleted, phone(gone)]).toEqual([false, true, "0935"]);
  });
});
