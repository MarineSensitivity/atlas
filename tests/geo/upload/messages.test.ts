// The refusal catalogue, against the `design:ux-copy` rules the subplan names:
//
//   "Rules ... refusal messages written with the design:ux-copy rules (what happened, why, what to
//    do)" (step 3), and the review checklist: "Every refusal names the rule and the fix; none says
//    'invalid file'."
//
// Every builder in messages.ts appears in `allRefusalSamples()`, which is why this file can assert
// over ALL of them rather than over a list someone has to remember to extend.
import { describe, expect, it } from "vitest";
import { allRefusalSamples, mb } from "../../../src/lib/geo/upload/messages";
import type { Refusal } from "../../../src/lib/geo/upload/types";

const samples: Refusal[] = allRefusalSamples();
const text = (r: Refusal) => `${r.what} ${r.why} ${r.fix}`;

/** the words that tell a person nothing they can act on. */
const BANNED = [
  "invalid",
  "malformed",
  "bad file",
  "unsupported file",
  "failure",
  "unexpected error",
  "something went wrong",
];

describe("the refusal catalogue", () => {
  it("is not empty, and every rule id is unique", () => {
    expect(samples.length).toBeGreaterThan(15);
    expect(new Set(samples.map((r) => r.rule)).size).toBe(samples.length);
  });

  for (const r of samples) {
    describe(r.rule, () => {
      it("says what happened, why, and what to do — all three, as sentences", () => {
        for (const part of [r.what, r.why, r.fix]) {
          expect(part.length).toBeGreaterThan(20);
          expect(part.trim()).toBe(part);
          expect(part).toMatch(/[.!?]$/);
        }
      });

      it("never says “invalid”, or any other word that names no fix", () => {
        const lower = text(r).toLowerCase();
        for (const word of BANNED)
          expect(lower, `${r.rule} contains "${word}"`).not.toContain(word);
      });

      it("offers an action the person can actually carry out", () => {
        // an imperative, or an offer of the alternative format — never "try again"
        expect(r.fix).toMatch(
          /Export|Re-export|Re-project|Re-zip|Zip|Convert|Simplify|Split|Choose|Remove|Delete|Draw|Close|Run|Check|Open|Download|Wait|Filter/,
        );
        expect(r.fix.toLowerCase()).not.toContain("try again later");
      });

      it("does not shout the rule id at the person", () => {
        expect(text(r)).not.toContain(r.rule);
      });
    });
  }

  it("names a concrete number or file wherever one decided the outcome", () => {
    const withNumbers = samples.filter((r) => /\d/.test(r.what));
    expect(withNumbers.length).toBeGreaterThan(8);
  });

  it("formats sizes the way a file manager does", () => {
    expect(mb(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(mb(60 * 1024 * 1024)).toBe("60.0 MB");
  });

  it("the GeoPackage refusals both offer the conversion S4's verdict promises", () => {
    for (const rule of ["geopackageDeclined", "geopackageUnavailable"]) {
      const r = samples.find((s) => s.rule === rule)!;
      expect(r.fix).toContain("GeoJSON");
    }
  });

  it("the projected-coordinate refusals both name the alternative that would have worked", () => {
    const noCrs = samples.find((s) => s.rule === "projectedCoordinates")!;
    expect(noCrs.fix).toContain(".prj");
    expect(noCrs.fix).toContain("EPSG:4326");
    const declared = samples.find((s) => s.rule === "projectedCrs")!;
    expect(declared.fix).toContain("EPSG:4326");
  });

  it("the polygons-only refusal explains why buffering is not offered", () => {
    const r = samples.find((s) => s.rule === "notPolygon")!;
    expect(r.why).toContain("buffer");
  });
});
