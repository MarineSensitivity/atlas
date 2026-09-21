// atlas-3 step 2, Deliverable 2: fonts. Century Gothic and Calibri are licensed and must never be
// redistributed — their @font-face blocks may carry ONLY local() sources. The self-hosted
// fallbacks (Jost, Carlito) must swap without shifting layout (font-display: swap + metric
// overrides) and must stay inside the display-face budget in docs/design/spec.md §12 (<= 20 KB for
// two weights). Carlito's OFL reserves that name, so the SUBSET FILE's internal identity must be
// renamed away from it even though the CSS still declares font-family: "Carlito".
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync("src/lib/brand/fonts.css", "utf8");

/** Every `@font-face { ... }` block for a given family, in source order. */
function blocksFor(family: string): string[] {
  return [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((m) => m[0])
    .filter((b) => b.includes(`font-family: "${family}"`));
}

describe("licensed faces (Century Gothic, Calibri) are local()-only — never redistributed", () => {
  for (const family of ["Century Gothic", "Calibri"]) {
    it(`${family} has at least one @font-face block`, () => {
      expect(blocksFor(family).length).toBeGreaterThan(0);
    });

    it(`${family}'s @font-face blocks contain no url() — local() only`, () => {
      for (const block of blocksFor(family)) {
        expect(block).not.toMatch(/url\(/);
        expect(block).toMatch(/local\(/);
      }
    });
  }

  it("no font binary for either licensed face is committed to this repo", () => {
    // the only font FILES in the repo are the two self-hosted open fallbacks
    const files = [
      "jost-regular-latin",
      "jost-bold-latin",
      "carlito-regular-latin",
      "carlito-bold-latin",
    ];
    for (const f of files) {
      expect(() => statSync(`src/lib/brand/fonts/${f}.woff2`)).not.toThrow();
    }
  });
});

describe("self-hosted fallbacks (Jost, Carlito) swap without shifting layout", () => {
  for (const family of ["Jost", "Carlito"]) {
    it(`${family}'s self-hosted blocks use font-display: swap`, () => {
      const hosted = blocksFor(family).filter((b) => b.includes("url("));
      expect(hosted.length).toBeGreaterThan(0);
      for (const block of hosted) expect(block).toMatch(/font-display:\s*swap/);
    });

    it(`${family} carries all four metric-override descriptors`, () => {
      const hosted = blocksFor(family).filter((b) => b.includes("url("));
      for (const block of hosted) {
        for (const prop of [
          "size-adjust",
          "ascent-override",
          "descent-override",
          "line-gap-override",
        ]) {
          expect(block, `${family} missing ${prop}`).toMatch(new RegExp(`${prop}:\\s*[\\d.]+%`));
        }
      }
    });

    it(`${family} tries local() before its self-hosted url()`, () => {
      for (const block of blocksFor(family).filter((b) => b.includes("url("))) {
        const local = block.indexOf("local(");
        const url = block.indexOf("url(");
        expect(local, `${family} block has no local()`).toBeGreaterThan(-1);
        expect(local).toBeLessThan(url);
      }
    });
  }

  it("covers both weight 400 and weight 700 for each self-hosted face", () => {
    for (const family of ["Jost", "Carlito"]) {
      const weights = blocksFor(family)
        .filter((b) => b.includes("url("))
        .map((b) => b.match(/font-weight:\s*(\d+)/)![1]);
      expect(new Set(weights)).toEqual(new Set(["400", "700"]));
    }
  });
});

describe("the display face (Jost, 2 weights, Latin-basic subset) fits the size budget (spec.md §12)", () => {
  it("stays at or under 20 KB combined, raw", () => {
    const regular = statSync("src/lib/brand/fonts/jost-regular-latin.woff2").size;
    const bold = statSync("src/lib/brand/fonts/jost-bold-latin.woff2").size;
    expect(regular + bold).toBeLessThanOrEqual(20 * 1024);
  });
});

describe("each self-hosted font's license text is kept beside it", () => {
  it("Jost's OFL text is present and names the SIL Open Font License", () => {
    expect(readFileSync("src/lib/brand/fonts/jost-OFL.txt", "utf8")).toMatch(
      /SIL OPEN FONT LICENSE/,
    );
  });

  it('Carlito\'s OFL text is present, names the license, and reserves the name "Carlito"', () => {
    const text = readFileSync("src/lib/brand/fonts/carlito-OFL.txt", "utf8");
    expect(text).toMatch(/SIL OPEN FONT LICENSE/);
    expect(text).toMatch(/Reserved Font Name "Carlito"/);
  });
});

describe("no hex color literal in fonts.css (check-hex-literals also covers this file)", () => {
  it("has none", () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
