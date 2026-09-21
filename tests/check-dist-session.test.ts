import { describe, expect, it } from "vitest";
import { distHasSessionJson } from "../scripts/check-dist-session-core.mjs";

describe("distHasSessionJson (plan D6)", () => {
  it("is red when session.json is seeded into dist/", () => {
    expect(distHasSessionJson("dist", (p) => p.endsWith("dist/session.json"))).toBe(true);
  });

  it("is green otherwise", () => {
    expect(distHasSessionJson("dist", () => false)).toBe(false);
  });
});
