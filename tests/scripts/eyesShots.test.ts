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

  it("(d) the phone tap points sit higher in the map (away from the legend chip's band) than the old ones", () => {
    // the phone branch's own three points -- x=75/60/90 are stable identifiers (unchanged by this
    // fix), so matching on them pins the search to the RIGHT array without fragile line-slicing.
    const m = src.match(/\[75,\s*(\d+)\][\s\S]{0,40}\[60,\s*(\d+)\][\s\S]{0,40}\[90,\s*(\d+)\]/);
    expect(
      m,
      "could not find the phone tapScoredCell points [75,y]/[60,y]/[90,y] in the source",
    ).not.toBeNull();
    const ys = (m as RegExpMatchArray).slice(1).map(Number);
    // the OLD points were 320/200/230 -- every new point must sit at or above the old MINIMUM (200),
    // and the new set must not be identical to the old one.
    for (const y of ys) expect(y).toBeLessThanOrEqual(200);
    expect(ys).not.toEqual([320, 200, 230]);
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
