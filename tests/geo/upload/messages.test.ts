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

  // atlas-8: the aggregate ">8" check above is exactly the gate the handover named as too weak
  // -- a "mysteryRule" (see the seeded-fault describe block below) can be vague on every SINGLE
  // rule and still clear a count taken over the whole catalogue. These two tables are PER-RULE:
  // NUMBER_DECIDED lists every rule whose `what` is required to cite the number/name that decided
  // it (every one of these 13 really does, verified against the live catalogue below); the
  // remaining 9 rules (format detection, an empty geometry, GPX not closed, GeoPackage) have no
  // single number that decided the outcome, so they are not held to this one.
  const NUMBER_DECIDED = [
    "fileTooLarge",
    "zipUncompressedTooLarge",
    "zipTooManyEntries",
    "noGeometry",
    "coordinatesNotFinite",
    "coordinatesOutOfRange",
    "projectedCoordinates",
    "projectedCrs",
    "tooManyVertices",
    "ringTooShort",
    "selfIntersection",
    "spanTooWide",
    "tooManyFeatures",
  ];

  it("PER RULE: `what` names a number, for every rule a number decides", () => {
    for (const rule of NUMBER_DECIDED) {
      const r = samples.find((s) => s.rule === rule);
      expect(r, `no sample for rule "${rule}"`).toBeDefined();
      expect(/\d/.test(r!.what), `${rule}'s "what" names no number: "${r!.what}"`).toBe(true);
    }
  });

  it("every rule NOT in NUMBER_DECIDED really has no number in `what` (the list is not stale)", () => {
    for (const r of samples) {
      if (NUMBER_DECIDED.includes(r.rule)) continue;
      expect(
        /\d/.test(r.what),
        `${r.rule} now names a number in "what" -- move it into NUMBER_DECIDED`,
      ).toBe(false);
    }
  });

  // the concrete format/tool names this catalogue actually uses. "GIS" stands for the generic
  // "your GIS" phrasing every rule that has no ONE specific tool falls back to.
  const FIX_TOKENS = [
    "GeoJSON",
    "shapefile",
    ".prj",
    ".shp",
    ".shx",
    ".dbf",
    "EPSG:4326",
    "WGS84",
    "KML",
    "GPX",
    "WKT",
    "GeoPackage",
    "FlatGeobuf",
    "QGIS",
    "PostGIS",
    "GIS",
    "ST_MakeValid",
    "Fix Geometries",
  ];
  // spanTooWide and tooManyFeatures are legitimately exempt: splitting a place across the
  // antimeridian, or scoring one place instead of many, is not a file-format conversion.
  const NO_FORMAT_FIX = ["spanTooWide", "tooManyFeatures"];

  function hasFixToken(fix: string): boolean {
    return FIX_TOKENS.some((t) => fix.includes(t));
  }

  it("PER RULE: `fix` names a concrete format or tool, for every rule that has one", () => {
    for (const r of samples) {
      if (NO_FORMAT_FIX.includes(r.rule)) continue;
      expect(hasFixToken(r.fix), `${r.rule}'s "fix" names no format/tool: "${r.fix}"`).toBe(true);
    }
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

// atlas-8: the seeded fault the handover named -- "the refusal-copy test can pass a useless
// message". `mysteryRule` is NOT in messages.ts or allRefusalSamples(): it exists only here, as a
// permanent proof that the OLD generic checks (length>20, ends in punctuation, no banned words, a
// recognized verb, doesn't shout the rule id) are not enough on their own. It poses as a
// count-decided rule ("too many of something") without ever citing the count, and offers a fix
// with a real verb but no concrete format or tool -- exactly the class of message a person can
// read all the way through and still not act on.
describe("seeded fault: a vague-but-grammatical message passes every OLD generic check", () => {
  const mysteryRule: Refusal = {
    rule: "mysteryRule",
    what: "This file has too many of something, more than the app allows.",
    why: "Above a certain amount, the panel and the link both stop being usable.",
    fix: "Filter the file down to fewer than the limit and export it again.",
  };

  it("passes length, trim, punctuation, banned-words, verb, and rule-id checks", () => {
    for (const part of [mysteryRule.what, mysteryRule.why, mysteryRule.fix]) {
      expect(part.length).toBeGreaterThan(20);
      expect(part.trim()).toBe(part);
      expect(part).toMatch(/[.!?]$/);
    }
    const lower = `${mysteryRule.what} ${mysteryRule.why} ${mysteryRule.fix}`.toLowerCase();
    for (const word of BANNED) expect(lower).not.toContain(word);
    expect(mysteryRule.fix).toMatch(
      /Export|Re-export|Re-project|Re-zip|Zip|Convert|Simplify|Split|Choose|Remove|Delete|Draw|Close|Run|Check|Open|Download|Wait|Filter/,
    );
    expect(`${mysteryRule.what} ${mysteryRule.why} ${mysteryRule.fix}`).not.toContain(
      mysteryRule.rule,
    );
  });

  it("FAILS the new per-rule checks this gate exists to add: no number, no format/tool named", () => {
    expect(/\d/.test(mysteryRule.what)).toBe(false);
    const fixTokens = [
      "GeoJSON",
      "shapefile",
      ".prj",
      ".shp",
      ".shx",
      ".dbf",
      "EPSG:4326",
      "WGS84",
      "KML",
      "GPX",
      "WKT",
      "GeoPackage",
      "FlatGeobuf",
      "QGIS",
      "PostGIS",
      "GIS",
      "ST_MakeValid",
      "Fix Geometries",
    ];
    expect(fixTokens.some((t) => mysteryRule.fix.includes(t))).toBe(false);
  });
});
