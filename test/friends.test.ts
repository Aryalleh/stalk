import { describe, expect, it } from "vitest";
import { daysToBirthday } from "../src/shop/friends";

describe("daysToBirthday", () => {
  // 2026-10-14 noon Tehran = 1405/07/22
  const today = new Date("2026-10-14T09:00:00Z");
  it("counts days to the next birthday, by day and month only", () => {
    expect(daysToBirthday("1370-07-22", today)).toBe(0);
    expect(daysToBirthday("1370-07-23", today)).toBe(1);
    expect(daysToBirthday("1370-08-01", today)).toBe(9);
  });
  it("wraps to next year once this year's has passed", () => {
    const d = daysToBirthday("1370-07-21", today)!;
    expect(d).toBeGreaterThanOrEqual(364);
    expect(d).toBeLessThanOrEqual(365);
  });
  it("uses Tehran's date late in the UTC day", () => {
    // 21:00 UTC on 10-14 is already 10-15 (1405/07/23) in Tehran
    expect(daysToBirthday("1370-07-23", new Date("2026-10-14T21:00:00Z"))).toBe(0);
  });
  it("is null for a missing date", () => {
    expect(daysToBirthday("")).toBeNull();
  });
});
