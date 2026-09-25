// `e2e/pdfText.ts` is pure string logic, so it is unit-tested here rather than only exercised
// inside a chromium `page.pdf()` run — the same arrangement `tests/e2e/routeSafety.test.ts` uses.
import { describe, expect, it } from "vitest";
import { normalizePdfText } from "../../e2e/pdfText";

const SENTENCE =
  "Species rows are every distribution model whose range overlaps the area, weighted by modeled " +
  "habitat suitability, the governing extinction-risk score and the overlapping area.";

describe("normalizePdfText", () => {
  it("joins a sentence broken across rendered lines (the linux-vs-macos wrap, run 35819393922)", () => {
    const wrapped =
      "Species rows are every distribution model whose range overlaps the area, weighted\n" +
      "by modeled habitat suitability, the governing extinction-risk score and the\n" +
      "overlapping area.";
    expect(normalizePdfText(wrapped)).toContain(SENTENCE);
  });

  it("joins a soft wrap that landed ON a hyphen", () => {
    const wrapped = "the governing extinction-\nrisk score and the overlapping area.";
    expect(normalizePdfText(wrapped)).toContain(
      "the governing extinction-risk score and the overlapping area.",
    );
  });

  it("collapses the other whitespace pdf-parse emits (double spaces, tabs, CRLF)", () => {
    expect(normalizePdfText("  page 1\tof \r\n 5  ")).toBe("page 1 of 5");
  });

  // THE SEEDED FAULT: normalization must not be able to rescue text that is actually missing or
  // reordered. If someone ever "fixes" a red by stripping punctuation or sorting words, this goes
  // red instead.
  it("does NOT match when a word was DROPPED (the overprint this gate exists for)", () => {
    const dropped =
      "Species rows are every distribution model whose range overlaps the area, weighted by\n" +
      "modeled habitat suitability, the governing extinction-risk score and the area.";
    expect(normalizePdfText(dropped)).not.toContain(SENTENCE);
  });

  it("does NOT match when two lines were OVERPRINTED into each other", () => {
    const overprinted =
      "Species rows are every distribution model whose range overlaps the area, weighted by\n" +
      "modeled habitat suitability, the governing extinction-risk score andpage 3 of 5 the " +
      "overlapping area.";
    expect(normalizePdfText(overprinted)).not.toContain(SENTENCE);
  });
});
