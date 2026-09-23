// atlas-8 fiddly bit: `?theme=navy|paper` (the gallery/mockups' own resolved-theme names,
// docs/design/mockups/*.html) is accepted by the real app as an alias of `?theme=dark|light` --
// previously it fell through silently to the "auto" default. `THEME_ALIASES` in
// src/lib/state/codec.ts is the one table both this file and index.html's inline pre-paint script
// (tests/shell/theme-preboot.test.ts) are driven through.
import { describe, expect, it } from "vitest";
import { parseSel, THEME_ALIASES } from "../../src/lib/state/codec";

describe("parseSel accepts navy/paper as aliases of dark/light", () => {
  it("?theme=navy parses the same as ?theme=dark", () => {
    expect(parseSel({ search: "?theme=navy", hash: "" }).theme).toBe("dark");
  });

  it("?theme=paper parses the same as ?theme=light", () => {
    expect(parseSel({ search: "?theme=paper", hash: "" }).theme).toBe("light");
  });

  it("the alias table is exactly navy->dark, paper->light", () => {
    expect(THEME_ALIASES).toEqual({ navy: "dark", paper: "light" });
  });

  it("does not alias an unrelated value (garbage still falls back to the default)", () => {
    // U2a (round 2): the default is "dark", not "auto" -- see tests/state/codec.test.ts's own
    // theme block.
    expect(parseSel({ search: "?theme=navyish", hash: "" }).theme).toBe("dark");
  });
});

describe("the gate can fail (seeded fault)", () => {
  // U2a (round 2): the default became "dark", the SAME value "navy" aliases to -- so a "?theme=navy"
  // probe can no longer distinguish "the alias table ran" from "aliasing broke and it fell through
  // to the default" (both now land on "dark"). "paper" (-> "light") still can: the default is
  // "dark", so only a working alias produces "light" here.
  it("without the alias, ?theme=paper would fall through to the default ('dark', not 'light')", () => {
    // the pre-fix behaviour, stated as an assertion so the regression cannot silently return:
    // parseEnum alone (no aliasing) treats "paper" as not in THEMES and clamps to the default.
    const noAlias = (v: string) => (["light", "dark", "auto"].includes(v) ? v : "dark");
    expect(noAlias("paper")).toBe("dark");
    expect(parseSel({ search: "?theme=paper", hash: "" }).theme).toBe("light");
  });
});
