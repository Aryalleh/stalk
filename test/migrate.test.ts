/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statements } from "../src/sql-statements";

const src = readFileSync("src/migrate.ts", "utf8");
const listed = [...src.matchAll(/\["(\d{4}_[\w]+\.sql)", m\d{4}\]/g)].map((m) => m[1]);

describe("migrations", () => {
  it("every file in /migrations is bundled, in order", () => {
    const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(listed).toEqual(files);
  });

  it("splits files into statements", () => {
    for (const f of listed) {
      const sql = readFileSync(`migrations/${f}`, "utf8");
      const stmts = statements(sql);
      expect(stmts.length).toBeGreaterThan(0);
      for (const s of stmts) expect(s).toMatch(/^(CREATE|INSERT)\b/);
    }
  });
});
