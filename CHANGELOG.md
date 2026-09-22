# atlas 0.8.3

`atlas-5` step 1, fix round 1: `camera.ts` copes with how extents are ACTUALLY published. Measured
over every published shard — v9 publishes 48,378 bboxes of which only **16** have `xmax > 180` while
**6,273 are written WRAPPED** (naive span > 180 deg; 5,053 over 300 deg) and 38,448 are `null`; **v7
publishes no bbox at all** (all 16,153 null). The contract's "already reduced to the minimal-span
frame" does not hold, so the plan's camera gate would have failed for thousands of taxa. The
upstream defect is atlas-1's; the lens compensates now.

- **`minimalFrame()`** applies plan D8's rule client-side: a bbox whose naive span exceeds 180 deg is
  read as wrapped and re-expressed as the complementary interval `[xmax, xmin + 360]` when that is
  narrower — `[-173.7, -16.05, 163.7, 20.2]` becomes `[163.7, -16.05, 186.3, 20.2]`, 22.6 deg
  centred on 175 E. An already-unwrapped box (`[160, 48, 210, 66]`) is untouched and a genuinely
  circumglobal one stays wide rather than framing a degenerate sliver. Longitudes are still never
  NORMALIZED.
- **The fallback chain ends somewhere real**: input extent -> merged extent -> the supplied
  ecoregion extent -> the release's study-area view (`boot.study_areas[FULL]`, read by
  `studyAreaView()`), so a v7 species frames US waters instead of the globe. `Camera` is therefore a
  union of a bounds camera and a centre/zoom camera.
- **The gate the plan asked for, over real data**: `tests/fixtures/species/v9/wide-bboxes.json` is 50
  real v9 extents with naive spans over 180 deg (every 125th of the 6,273, with provenance). Framed
  naively 48 of the 50 span >= 200 deg; after `minimalFrame()` the widest is 179.5 deg and all 50
  centres lie inside the model's own longitudes.
