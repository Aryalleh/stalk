import { describe, expect, it } from "vitest";
import { birthDate, birthdayLabel, usernameError } from "../lib/people";

const now = new Date("2026-10-02T12:00:00Z"); // 1405/07/10

describe("profile fields", () => {
  it("accepts real Jalali birth dates and normalizes them", () => {
    expect(birthDate("1370", "5", "12", now)).toBe("1370-05-12");
    expect(birthDate("۱۳۷۰", "۰۵", "۱۲", now)).toBe("1370-05-12");
    expect(birthDate("1399", "12", "30", now)).toBe("1399-12-30"); // leap year
  });

  it("rejects impossible or implausible dates", () => {
    expect(birthDate("1400", "12", "30", now)).toBeNull(); // 1400 is not a leap year
    expect(birthDate("1370", "7", "31", now)).toBeNull();
    expect(birthDate("1404", "1", "1", now)).toBeNull(); // younger than 5
    expect(birthDate("1200", "1", "1", now)).toBeNull();
    expect(birthDate("", "1", "1", now)).toBeNull();
  });

  it("shows only day and month", () => {
    expect(birthdayLabel("1370-05-12")).toBe("۱۲ مرداد");
  });

  it("validates usernames", () => {
    expect(usernameError("sara.m")).toBe("");
    expect(usernameError("Sara")).not.toBe("");
    expect(usernameError("ab")).not.toBe("");
    expect(usernameError("admin")).toContain("رزرو");
  });
});
