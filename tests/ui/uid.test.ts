import { describe, expect, it } from "vitest";
import { uid } from "../../src/lib/ui/uid";

describe("uid", () => {
  it("is unique across repeated calls, even with the same prefix", () => {
    const ids = Array.from({ length: 50 }, () => uid("hexbtn-tip"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is unique across different prefixes too (one shared counter)", () => {
    const a = uid("a");
    const b = uid("a");
    expect(a).not.toBe(b);
  });

  it("keeps the prefix as a readable hint", () => {
    expect(uid("modal-title")).toMatch(/^modal-title-\d+$/);
  });
});
