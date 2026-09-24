// P round V2 fix (Opus eyes-on review, 2026-09-24, "process" finding #5): scripts/eyes-shots.mjs
// produced 3 false results in its second-pass set -- a flower-petal selector that never hit a real
// petal, a table step that shot mid-"Loading species...", and a "map" state byte-identical to
// "layers" because Layers is the app's own default open tool. This is a SOURCE-SCAN gate (the
// CLAUDE.md/GATES.md "pure-logic / source-scan gate" pattern): eyes-shots.mjs drives a real browser
// against a real build, which is out of scope for vitest, so this asserts the SCRIPT'S OWN SOURCE
// carries the fixed selectors/waits rather than the pre-fix ones -- a real regression (someone
// reverting the fix) turns this red without needing a browser.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = "scripts/eyes-shots.mjs";
const src = readFileSync(SCRIPT_PATH, "utf8");

describe("scripts/eyes-shots.mjs: the third-pass fixes stay in place", () => {
  it("(a) the flower-petal selector targets a real petal (path.petal), not a bare 'svg path' nth(3)", () => {
    expect(src).toContain("svg path.petal");
    // the exact pre-fix selector this replaces -- must not reappear.
    expect(src).not.toContain("svg path[role=button], svg [data-component], svg path");
  });

  it("(a) the petal step waits for the tap label to actually appear before shooting", () => {
    expect(src).toMatch(/\.petal-label/);
    expect(src).toMatch(/waitFor\(\{ state: "visible", timeout: 2000 \}\)/);
  });

  it("(a) a zero-score DEGENERATE petal path (empty d) is skipped, so the click lands on real area", () => {
    expect(src).toContain('svg path.petal:not([d=""])');
  });

  it(
    "(a) a thin low-score petal that misses its bounding-box-centre click is not the only attempt -- " +
      "every non-degenerate petal is tried in turn until one's label shows",
    () => {
      expect(src).toMatch(/for \(let i = 0; i < petalCount && !labelShown; i\+\+\)/);
      expect(src).toMatch(/petals\s*\n?\s*\.nth\(i\)/);
    },
  );

  it("(b) the table step waits for 'Loading species…' to clear before shooting", () => {
    expect(src).toContain("waitForSpeciesLoaded");
    expect(src).toContain("Loading species…");
    // called before BOTH the half and full table shots, not just the first.
    const calls = src.match(/await waitForSpeciesLoaded\(p\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("(b) the wait is BOUNDED (never hangs the whole harness) and WARNs rather than throwing", () => {
    expect(src).toMatch(/timeoutMs\s*=\s*30_000/);
    expect(src).toMatch(/log\(\s*\n?\s*"WARN species table did not finish loading/);
  });

  it("(c) the 'map' state collapses the default-open sheet/panel before shooting, so it differs from 'layers'", () => {
    const mapState = src.slice(src.indexOf('id: "map"'), src.indexOf('id: "layers"'));
    expect(mapState).toContain("collapseSheet(p)");
  });

  it("(c) collapseSheet tries both the phone and desktop collapse controls", () => {
    expect(src).toContain("Collapse to a peek");
    expect(src).toContain("Collapse to a pill");
  });

  // (d) V5 fix (2026-09-25): the third pass's fixed pixel points -- phone [75,y]/[60,y]/[90,y] AND
  // the desktop (335,400)/(490,585)/(600,520) this same test block used to pin -- are GONE. Both
  // viewports now tap via `screenPointFor`'s `map.project()`, so there is no longer a per-viewport
  // pixel literal to assert on; the V5 describe block below covers the replacement directly.
  it("keeps the documented CLI contract (ATLAS_URL, OUT, ONLY) unchanged", () => {
    expect(src).toContain("process.env.ATLAS_URL");
    expect(src).toContain("process.env.OUT");
    expect(src).toContain("process.env.ONLY");
    expect(src).toMatch(
      /ATLAS_URL=http:\/\/localhost:\d+ OUT=\.tmp\/eyes \[ONLY=map,layers\] node scripts\/eyes-shots\.mjs/,
    );
  });
});

// P round V5 fix (Opus eyes-on review of 0.10.59, 2026-09-25): the third pass's FIXED desktop pixel
// points ((335,400)/(490,585)/(600,520)) all sampled land for the current globe camera, so states
// 06/07/09/10 silently shot the full study area on desktop and the "stop at first real popup" loop
// (kept from the third pass) exited with no warning at all. A hand-picked pixel is only ever right
// for ONE camera; this asserts the harness now taps by PROJECTING known real lon/lat points instead,
// warns explicitly when every candidate misses, and marks the shot filename `-MISSED` when it does --
// plus the new "programarea" state that makes Program Area name routing screenshot-able at all.
describe("scripts/eyes-shots.mjs: the V5 fixes stay in place (fourth pass)", () => {
  it("drops the old FIXED desktop pixel points entirely -- no more per-camera pixel guesses", () => {
    expect(src).not.toContain("[335, 400]");
    expect(src).not.toContain("[490, 585]");
    expect(src).not.toContain("[600, 520]");
  });

  it("taps by PROJECTING known real-world scored lon/lat points, not a pixel literal", () => {
    expect(src).toContain("KNOWN_SCORED_POINTS");
    // the three points the brief names -- northern Gulf of Mexico, Gulf of Alaska, mid-Atlantic
    // shelf -- as real lon/lat pairs, not screen pixels.
    expect(src).toContain("-90.55");
    expect(src).toContain("28.6");
    expect(src).toMatch(/Gulf of Alaska/);
    expect(src).toMatch(/mid-Atlantic shelf/);
  });

  it("projects with the live map's own map.project(), the same technique places.pick.spec.ts uses", () => {
    // scoped to the FUNCTION BODY, not the file's prose -- the header comment names
    // `window.__atlasMap`/`map.project()` too, so a fault that guts the function but leaves the
    // comment untouched must still be caught (a check against the whole file's text is not one).
    const start = src.indexOf("async function screenPointFor");
    expect(start, "screenPointFor is not defined").toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toContain("window.__atlasMap");
    expect(body).toContain("map.project(");
    // canvas-relative -> viewport-absolute, or every click lands offset from the intended cell.
    expect(body).toContain("getBoundingClientRect()");
  });

  it("WARNs explicitly when every candidate point misses, rather than exiting silently", () => {
    expect(src).toMatch(/log\(`WARN tapScoredCell: every candidate point missed/);
  });

  it("marks the shot filename with -MISSED when tapScoredCell found no scored cell", () => {
    expect(src).toMatch(/const missed = hit \? "" : "-MISSED";/);
    expect(src).toContain("06-flower-half${missed}");
    expect(src).toContain("07-flower-petal${missed}");
    expect(src).toContain("08-flower-full${missed}");
    expect(src).toContain("09-table-half${missed}");
    expect(src).toContain("10-table-full${missed}");
  });

  it("adds a 'programarea' state that selects a Program Area through the Scores-lens search field", () => {
    expect(src).toContain('id: "programarea"');
    expect(src).toContain("selectProgramArea");
    expect(src).toContain("Search Program Areas or coordinates");
    expect(src).toContain("Gulf of America");
    // shoots BOTH the flower and the table for the selected Program Area, on both viewports (no
    // `if (vp !== "phone") return` guard the way the phone-only "legend"/"more" states have).
    const paState = src.slice(src.indexOf('id: "programarea"'));
    expect(paState).toContain("Flower plot");
    expect(paState).toContain("Table");
    expect(paState).not.toMatch(/if \(vp !== "phone"\) return;/);
  });

  it("keeps the documented CLI contract (ATLAS_URL, OUT, ONLY) unchanged", () => {
    expect(src).toContain("process.env.ATLAS_URL");
    expect(src).toContain("process.env.OUT");
    expect(src).toContain("process.env.ONLY");
    expect(src).toMatch(
      /ATLAS_URL=http:\/\/localhost:\d+ OUT=\.tmp\/eyes \[ONLY=map,layers\] node scripts\/eyes-shots\.mjs/,
    );
  });
});
