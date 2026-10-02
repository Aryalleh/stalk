import { describe, expect, it } from "vitest";
import { parseSizeGuide, sizeNames } from "../src/shop/sizes";

describe("size guide", () => {
  it("tidies empty rows and columns", () => {
    const r = parseSizeGuide(JSON.stringify({ columns: ["سایز", "دور سینه", ""], rows: [["M", "100", ""], ["", "", ""], [" L ", "106", ""]] }));
    expect(r).toEqual({ guide: { columns: ["سایز", "دور سینه"], rows: [["M", "100"], ["L", "106"]] } });
  });
  it("treats an empty table as no guide", () => {
    expect(parseSizeGuide("")).toEqual({ guide: null });
    expect(parseSizeGuide(JSON.stringify({ columns: ["سایز"], rows: [["", ""]] }))).toEqual({ guide: null });
  });
  it("requires unique size names", () => {
    expect(parseSizeGuide(JSON.stringify({ columns: ["سایز", "x"], rows: [["M", "1"], ["M", "2"]] }))).toHaveProperty("error");
    expect(parseSizeGuide(JSON.stringify({ columns: ["سایز", "x"], rows: [["", "1"]] }))).toHaveProperty("error");
    expect(parseSizeGuide("{bad")).toHaveProperty("error");
  });
  it("lists size names", () => {
    expect(sizeNames(JSON.stringify({ columns: ["سایز"], rows: [["S"], ["M"]] }))).toEqual(["S", "M"]);
    expect(sizeNames("")).toEqual([]);
  });
});
