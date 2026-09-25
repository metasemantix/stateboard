import { describe, expect, it } from "vitest";
import initialMigration from "../migrations/0001_initial.sql?raw";

describe("remote D1 migration compatibility", () => {
  it("parenthesizes CASE expressions inside trigger statements", () => {
    expect(initialMigration).not.toMatch(/SELECT\s+CASE\b/i);
    expect(initialMigration).toMatch(/SELECT\s+\(CASE\s+WHEN\s+NOT\s+EXISTS/i);
  });
});
