import { describe, expect, it } from "vitest";
import { sessionTokens } from "../src/session";

describe("sessionTokens", () => {
  it("reads every session cookie (the site's and a mini app's), decoded, without duplicates", () => {
    const a = "abc+/=";
    const header = `ref=x; session=${encodeURIComponent(a)}; theme=dark; session=second; session=${encodeURIComponent(a)}`;
    expect(sessionTokens(header)).toEqual([a, "second"]);
  });
  it("ignores look-alike names and empty values", () => {
    expect(sessionTokens("my_session=1; sessions=2; session=")).toEqual([]);
    expect(sessionTokens(undefined)).toEqual([]);
  });
});
