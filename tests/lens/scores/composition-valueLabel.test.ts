// m7 (atlas-8 review round 2, pinning G-23's wording): `Composition.svelte`'s real render is what
// G-23 (0.10.19, CHANGELOG.md) actually fixed -- before it, `Treemap.svelte`'s accessible summary
// hardcoded "species" for a value that is really `suit_er_area` ("suitability x extinction-risk x
// area", `sql/composition.sql`/`glossary.ts`), producing nonsense like
// "210,671,300.041 species across 7 categories" (the regression fixture
// `tests/ui/treemapLayout.test.ts` still reproduces byte-for-byte). The fix was a `valueLabel`
// PROP `Composition.svelte` passes down; `tests/ui/treemapLayout.test.ts` already pins
// `describeTreemapSummary()`'s own formatting rule, but nothing pinned the CALLER's string itself
// -- a `Composition.svelte` edit that quietly reverted its `valueLabel` back to `"species"` (or
// dropped the prop, `Treemap.svelte`'s Props require it, so that would also be a type error, but
// `svelte-check` is not part of every gate run) would reintroduce G-23's exact symptom with every
// other test in this file staying green, since none of them render the real component under
// vitest's `node` environment (same reasoning as `composition-note.test.ts`'s own header).
//
// A plain source scan (the technique `composition-note.test.ts`/`documentTitle.test.ts` already
// use for a property a DOM-less test run cannot observe): the REAL caller in `Composition.svelte`
// must carry the exact current phrase, verbatim, and never the gallery demo's own literal
// `"species"` (a legitimate, different call site -- `docs/spikes` / gallery.html's Treemap demo --
// this scan is scoped to `Composition.svelte` alone so it cannot be satisfied by leaving that
// demo's label untouched).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const COMPOSITION_SVELTE = join(ROOT, "src/lens/scores/Composition.svelte");

describe("Composition.svelte's valueLabel is pinned to G-23's real wording", () => {
  it("REGRESSION: passes the exact current phrase, never a bare 'species' count label", () => {
    const src = readFileSync(COMPOSITION_SVELTE, "utf8");
    expect(src).toContain('valueLabel="combined suitability x extinction-risk x area"');
    // the exact shape G-23 fixed: a literal count label on a value that is not a count.
    expect(src).not.toMatch(/valueLabel\s*=\s*"species"/);
  });
});
