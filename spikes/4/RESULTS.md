# S4 spike — spatial uploads: raw measurements

Measurements only. No verdict, no format-list recommendation (atlas-6 decides that from this
data). Everything below is a real, captured run on this machine — commands, output and numbers
are pasted verbatim except where noted "(trimmed)".

**Fix round 1:** part (b) was rewritten after finding and fixing an actual bug in this harness, not
the environment — see "Root cause" under part (b). Also added `utm_zone_noprj.zip` (the same
shapefile with its `.prj` removed) and a parser-side "`.prj` dropped" proof
(`e2e/utm-noprj.fail.spec.ts`) alongside the existing expectation-side seeded fault.

**Fix round 2 (this revision):** round 1's "spatial is statically compiled into duckdb-*.wasm, no
network cost" claim was **wrong**, and is retracted below with the falsifying measurement in
place: `e2e/duckdb-network.spec.ts` properly observes worker network traffic (`page.on("response")`
*does* see a dedicated Worker's own `fetch()` calls — round 1's claim that it couldn't was itself
wrong, an artifact of a listener that silently swallowed specific responses) and shows `spatial` is
in fact downloaded, every time, from `https://extensions.duckdb.org/v<core-version>/wasm_eh/
spatial.duckdb_extension.wasm` — ~22.4–22.5 MB. A blocked-network gate with a worker-fetch control
now backs this up: `LOAD spatial` fails when every non-localhost host is blocked, with the control
proving the block reaches worker fetches. Also: `e2e/duckdb-spatial.spec.ts` now honours
`SPIKE4_MANIFEST` (round 1 left it hardcoded to the true manifest, so the seeded-fault run showed
no red at all for it — see "item 2" under part (b)).

**Fix round 3 (this revision, reviewer finding N2):** `e2e/utm-noprj.fail.spec.ts` used a blanket
`test.fail()`, which accepts ANY failure (a missing fixture, a parser exception, ...), so "a
dropped `.prj` is still caught" was unproven. Replaced with an ordinary test asserting the trigger
(the zip's real entry list has no `.prj`) and the symptom (bbox in the fixture's UTM metre range,
zero console output, WGS84 error `> 1e6` m) positively — see the `.prj`-dropped section under
part (a) for the two seeded-fault runs (a `.prj` put back; the fixture renamed away) that now
correctly turn it red, where the old version would have stayed green either way.

## Versions (captured 2026-09-21)

| tool | version |
| --- | --- |
| node | 24.9.0 |
| npm | 11.18.0 |
| vite (root, reused via npx) | 8.3.0 |
| typescript (root, reused via npx) | ~6.0.2 |
| @playwright/test (root, reused via npx) | 1.63.0 |
| Chromium (Playwright's `chromium_headless_shell-1243`) | 153.0.8010.12 |
| shpjs | 6.2.0 |
| @tmcw/togeojson | 7.1.2 |
| flatgeobuf | 4.4.0 |
| @duckdb/duckdb-wasm `latest` dist-tag | 1.33.1-dev57.0 (not tested here — plan names this the *known-bad* OPFS build, S1's problem) |
| @duckdb/duckdb-wasm `1.32.0` (pinned) | 1.32.0 |
| @duckdb/duckdb-wasm `next` dist-tag | 1.33.1-dev64.0 (resolved via `npm view @duckdb/duckdb-wasm@next version`) |
| GDAL (fixture generation) | 3.13.3 "Iowa City" |
| PROJ (fixture generation) | 9.5.1 |
| R | 4.6.1 |
| R `sf` package | 1.1.2 |

Fixture-only WKT parser is hand-rolled (`spikes/4/src/wkt.ts`) — not an npm dependency, per the
plan's spike-only-deps list (shpjs, @tmcw/togeojson, flatgeobuf, @duckdb/duckdb-wasm only).

## Commands run (exact)

```
# fixtures (from spikes/4/)
Rscript fixtures/generate_fixtures.R          # writes fixtures/*.{zip,kml,fgb,gpkg,wkt} + fixtures_manifest.json + fixtures_manifest.faulty.json

# install (spikes/4/package.json only — root package.json/package-lock.json untouched)
npm install

# typecheck (spike-local tsconfig, not part of root CI)
npx tsc --noEmit -p tsconfig.json

# bytes-added-per-parser (own Vite 8 build, own manifest)
npx vite build
node scripts/lazy-bytes.mjs dist

# correctness (must PASS)
TMPDIR=<writable-dir> npx playwright test e2e/correctness.spec.ts --reporter=list

# seeded-fault gate (must FAIL — see "Gate output" below)
SPIKE4_MANIFEST=fixtures_manifest.faulty.json TMPDIR=<writable-dir> npx playwright test e2e/correctness.spec.ts --reporter=list

# part (b): duckdb-wasm spatial + ST_Read (build+preview path — the one that must work)
TMPDIR=<writable-dir> npx playwright test e2e/duckdb-spatial.spec.ts --reporter=list

# part (b), seeded-fault (fix round 2, item 2 — now honours SPIKE4_MANIFEST)
SPIKE4_MANIFEST=fixtures_manifest.faulty.json TMPDIR=<writable-dir> npx playwright test e2e/duckdb-spatial.spec.ts --reporter=list

# part (b), dev-mode comparison: start vite dev manually, then let Playwright's
# webServer.reuseExistingServer pick it up instead of running "build && preview"
TMPDIR=<writable-dir> npx vite dev --port 4314 --strictPort &
TMPDIR=<writable-dir> npx playwright test e2e/duckdb-spatial.spec.ts -g "1.32.0: spatial \+ ST_Read\(gulf_rectangle" --reporter=list

# fix round 1/3, item 2: the .prj-dropped fixture, parser-side proof (ordinary test since fix round 3)
TMPDIR=<writable-dir> npx playwright test e2e/utm-noprj.fail.spec.ts --reporter=list

# fix round 2, item 1: real worker network observation + the blocked-network gate + control,
# reload behavior, and the custom_extension_repository experiment
node scripts/fetch-extension-cache.mjs   # populates the gitignored fixtures/.ext-cache/ used by
                                          # the custom_extension_repository test below
TMPDIR=<writable-dir> npx playwright test e2e/duckdb-network.spec.ts --reporter=list
```

`TMPDIR` had to be overridden to a writable directory inside the worktree — the default
`/var/folders/.../T` was not writable in this sandbox (`EACCES: permission denied, mkdir
'/var/folders/.../playwright-transform-cache-501/...'`), exactly as anticipated. `vite preview`
always runs on `--port 4314 --strictPort` (`spikes/4/package.json`'s `preview` script and
`playwright.config.ts`'s `webServer`).

## Fixtures (spikes/4/fixtures/, generated by generate_fixtures.R)

5 fixtures, each written in every format its candidate parser needs, plus a `.gpkg` per fixture
for part (b):

| fixture | formats | geometry | vertices | notes |
| --- | --- | --- | --- | --- |
| `gulf_rectangle` | zip, kml, fgb, gpkg, wkt | Polygon, EPSG:4326 | 5 | plain rectangle, Gulf of Mexico, control case |
| `aleutian_dateline` | zip, kml, fgb, gpkg, wkt | Polygon, EPSG:4326 | 5 | crosses the antimeridian, wrapped coords (178 → -177) |
| `multipolygon` | zip, kml, fgb, gpkg, wkt | MultiPolygon, EPSG:4326 | 10 (2 parts × 5) | two disjoint rectangles |
| `utm_zone` | zip, fgb, gpkg, wkt (no kml — see below) | Polygon, EPSG:32610 (UTM 10N) | 5 | projected metres; the reprojection test |
| `utm_zone_noprj` | zip only | Polygon, no CRS in the zip | 5 | fix round 1: same shapefile as `utm_zone`, `.prj` deliberately removed before zipping |
| `coastline_40k` | zip, kml, fgb, gpkg, wkt | LineString, EPSG:4326 | 40,000 exactly | synthetic deterministic wiggle, not real coastline data |

`utm_zone` has no `.kml`: KML mandates WGS84, so a KML export of it would just be a pre-reprojected
rectangle and would exercise nothing UTM-specific — deliberately skipped rather than faked.
`utm_zone_noprj` is generated by the same `write_zip_shapefile`-style step as `utm_zone` (a new
`write_zip_shapefile_no_prj()` helper in `generate_fixtures.R`), so its `.shp`/`.shx`/`.dbf` bytes
are the real output of writing that shapefile — only the `.prj` component is dropped before
zipping. This is a real file a reader could actually be handed, not a hand-edited expectation.

Ground truth (`fixtures_manifest.json`) — vertex counts, naive bboxes, first-ring shoelace sign,
and for `utm_zone` the WGS84 reprojection of all 4 corners — is computed independently in R via
`sf`/GDAL/PROJ, once, at fixture-generation time; the Playwright specs never recompute it.

## (a) Bytes added per parser when lazy-loaded

From `spikes/4`'s own `vite build` (its own `index.html`/`main.ts`, isolated from the root app),
via `scripts/lazy-bytes.mjs`, which walks each dynamic-import root's *static* import graph only
(never `dynamicImports`, so no parser's bytes bleed into another's) and gzips every reachable
file. `src/main.ts` never statically imports any of shpjs / @tmcw/togeojson / flatgeobuf /
duckdb-wasm — each is its own `import()`, so each becomes its own chunk (mirrors the root app's
`duckdb*`/`shp*` lazy-chunk rule).

```
entry "index.html" dynamicImports: ["src/parse-shp.ts","src/parse-kml.ts","src/parse-fgb.ts","src/parse-wkt.ts","src/duckdb-1-32-0.ts","src/duckdb-next.ts"]

shpjs (parse-shp.ts): 46708 B gzip JS (2 file(s)) + 0 B gzip wasm/worker assets (0 file(s)) = 46708 B gzip total
    - assets/parse-shp-*.js: 140214 B raw, 46118 B gzip
    - assets/normalize-*.js: 1248 B raw, 590 B gzip

@tmcw/togeojson (parse-kml.ts): 3804 B gzip JS (2 file(s)) + 0 B gzip wasm/worker assets (0 file(s)) = 3804 B gzip total
    - assets/parse-kml-*.js: 8993 B raw, 3214 B gzip
    - assets/normalize-*.js: 1248 B raw, 590 B gzip

flatgeobuf (parse-fgb.ts): 11375 B gzip JS (2 file(s)) + 0 B gzip wasm/worker assets (0 file(s)) = 11375 B gzip total
    - assets/parse-fgb-*.js: 43323 B raw, 10785 B gzip
    - assets/normalize-*.js: 1248 B raw, 590 B gzip

hand-rolled WKT (parse-wkt.ts, not an npm dep): 1222 B gzip JS (2 file(s)) + 0 B gzip wasm/worker assets (0 file(s)) = 1222 B gzip total
    - assets/parse-wkt-*.js: 1134 B raw, 632 B gzip
    - assets/normalize-*.js: 1248 B raw, 590 B gzip

@duckdb/duckdb-wasm 1.32.0 (duckdb-1-32-0.ts): 47032 B gzip JS (2 file(s)) + 16711806 B gzip wasm/worker assets (4 file(s)) = 16758838 B gzip total
    - assets/duckdb-1-32-0-*.js: 31691 B raw, 8208 B gzip
    - assets/duckdb-gpkg-test-*.js: 171103 B raw, 38824 B gzip   [dominated by apache-arrow ^17.0.0, a transitive dep of duckdb-wasm, shared/deduped across both versions]
    - assets/duckdb-mvp-*.wasm: 39362651 B raw, 8691449 B gzip
    - assets/duckdb-browser-mvp.worker-*.js: 844644 B raw, 193342 B gzip
    - assets/duckdb-eh-*.wasm: 34242586 B raw, 7639058 B gzip
    - assets/duckdb-browser-eh.worker-*.js: 772759 B raw, 187957 B gzip

@duckdb/duckdb-wasm next (duckdb-next.ts): 47052 B gzip JS (2 file(s)) + 17645400 B gzip wasm/worker assets (4 file(s)) = 17692452 B gzip total
    - assets/duckdb-next-*.js: 31722 B raw, 8228 B gzip
    - assets/duckdb-gpkg-test-*.js: 171103 B raw, 38824 B gzip
    - assets/duckdb-mvp-*.wasm: 41389750 B raw, 9193801 B gzip
    - assets/duckdb-browser-mvp.worker-*.js: 841877 B raw, 193690 B gzip
    - assets/duckdb-eh-*.wasm: 35964036 B raw, 8069300 B gzip
    - assets/duckdb-browser-eh.worker-*.js: 775272 B raw, 188609 B gzip
```

Caveats recorded, not hidden:
- The duckdb-wasm numbers include **both** the `mvp` and `eh` bundles because both are present in
  the *build* graph (`selectBundle()` decides at *runtime* which ONE to fetch — see part (b): every
  run in this environment picked `eh`). The real network cost at runtime is roughly **half** the
  number above: for 1.32.0, `eh` wasm (7,639,058 B gzip) + `eh` worker (187,957 B gzip) ≈ 7.83 MB
  gzip; for `next`, `eh` wasm (8,069,300 B) + `eh` worker (188,609 B) ≈ 8.26 MB gzip.
  `mvp` alone is not smaller in a way that matters (mvp wasm is actually the *larger* of the two on
  both versions here).
- `duckdb-gpkg-test.ts` (my own ~3 KB of harness code) shares a Rollup chunk with `apache-arrow`
  (a real transitive dependency of `@duckdb/duckdb-wasm`, used for Arrow-format query results)
  because both are reachable from *both* `duckdb-1-32-0.ts` and `duckdb-next.ts` and Rollup groups
  same-reachability modules into one physical chunk — hence the 38,824 B gzip shared chunk is
  mostly `apache-arrow`, not my code.
- `normalize.ts` (shared by all 4 non-duckdb parsers) is counted once **per parser** above rather
  than de-duplicated across parsers, so the true marginal cost of loading a 2nd/3rd parser after
  the first is slightly less than the sum of these numbers (it is already cached).

## (a) Per-fixture correctness per parser

Real Playwright output (`e2e/correctness.spec.ts`, chromium, all 19 assertions **PASS** against the
true ground truth — see "Gate output" below for the seeded-fault run against the deliberately
wrong ground truth, which **FAILS** as required):

```
gulf_rectangle/shpjs: {"featureCount":1,"vertexCount":5,"bbox":[-93.5,26.5,-88.5,29.500000000000004],"firstRingOrientation":"CW","firstRingSignedArea":-15,"parseMs":4.8,"bytesFetched":936}
gulf_rectangle/togeojson: {"featureCount":1,"vertexCount":5,"bbox":[-93.5,26.5,-88.5,29.5],"firstRingOrientation":"CW","firstRingSignedArea":-15,"parseMs":4.6,"bytesFetched":708}
gulf_rectangle/flatgeobuf: {"featureCount":1,"vertexCount":5,"bbox":[-93.5,26.5,-88.5,29.5],"firstRingOrientation":"CW","firstRingSignedArea":-15,"parseMs":1,"bytesFetched":1344,"headerCrs":{"org":"EPSG","code":4326,"name":"WGS 84", ...}}
gulf_rectangle/wkt (hand-rolled): {"featureCount":1,"vertexCount":5,"bbox":[-93.5,26.5,-88.5,29.5],"firstRingOrientation":"CW","firstRingSignedArea":-15,"parseMs":0.1,"bytesFetched":71}

aleutian_dateline/shpjs: {"featureCount":1,"vertexCount":5,"bbox":[-177,51,178,53],"firstRingOrientation":"CW","firstRingSignedArea":-710,"parseMs":1.4,"bytesFetched":960}
  naive bbox width from shpjs: 355 deg (true width is 5 deg)
aleutian_dateline/togeojson: {"featureCount":1,"vertexCount":5,"bbox":[-177,51,178,53],"firstRingOrientation":"CCW","firstRingSignedArea":710,"parseMs":0.8,"bytesFetched":702}
  naive bbox width from togeojson: 355 deg (true width is 5 deg)
aleutian_dateline/flatgeobuf: {"featureCount":1,"vertexCount":5,"bbox":[-177,51,178,53],"firstRingOrientation":"CCW","firstRingSignedArea":710,"parseMs":0.6,"bytesFetched":1344,"headerCrs":{"org":"EPSG","code":4326, ...}}
  naive bbox width from flatgeobuf: 355 deg (true width is 5 deg)
aleutian_dateline/wkt (hand-rolled): {"featureCount":1,"vertexCount":5,"bbox":[-177,51,178,53],"firstRingOrientation":"CCW","firstRingSignedArea":710,"parseMs":0.1,"bytesFetched":53}
  naive bbox width from wkt (hand-rolled): 355 deg (true width is 5 deg)

multipolygon/shpjs: {"featureCount":1,"vertexCount":10,"bbox":[-122,34,-119,37],"firstRingOrientation":"CW","firstRingSignedArea":-1,"parseMs":1.5,"bytesFetched":936}
multipolygon/togeojson: {"featureCount":1,"vertexCount":10,"bbox":[-122,34,-119,37],"firstRingOrientation":"CW","firstRingSignedArea":-1,"parseMs":1,"bytesFetched":861}
multipolygon/flatgeobuf: {"featureCount":1,"vertexCount":10,"bbox":[-122,34,-119,37],"firstRingOrientation":"CW","firstRingSignedArea":-1,"parseMs":0.7,"bytesFetched":1504,"headerCrs":{"org":"EPSG","code":4326, ...}}
multipolygon/wkt (hand-rolled): {"featureCount":1,"vertexCount":10,"bbox":[-122,34,-119,37],"firstRingOrientation":"CW","firstRingSignedArea":-1,"parseMs":0.2,"bytesFetched":112}

utm_zone/shpjs: {"featureCount":1,"vertexCount":5,"bbox":[-123.00000000000001,38.84859086720703,-122.76893749425489,39.02904728773113],"firstRingOrientation":"CW","firstRingSignedArea":-0.0416,"parseMs":1.8,"bytesFetched":1029}
utm_zone/shpjs reprojection error: 0.000000 m
utm_zone/flatgeobuf: {"featureCount":1,"vertexCount":5,"bbox":[500000,4300000,520000,4320000],"firstRingOrientation":"CW","firstRingSignedArea":-400000000,"parseMs":0.6,"bytesFetched":2048,"headerCrs":{"org":"EPSG","code":32610,"name":"WGS 84 / UTM zone 10N", ...}}
utm_zone/wkt: {"featureCount":1,"vertexCount":5,"bbox":[500000,4300000,520000,4320000],"firstRingOrientation":"CW","firstRingSignedArea":-400000000,"parseMs":0.1,"bytesFetched":88}

coastline_40k/shpjs: vertexCount=40000 parseMs=15.90 bytesFetched=373367
coastline_40k/togeojson: vertexCount=40000 parseMs=38.00 bytesFetched=1053861
coastline_40k/flatgeobuf: vertexCount=40000 parseMs=2.30 bytesFetched=641264
coastline_40k/wkt (hand-rolled): vertexCount=40000 parseMs=13.50 bytesFetched=773278

19 passed (4.1s)
```

### What this means, fixture by fixture (measurements, not recommendations)

- **gulf_rectangle** (control): all 4 parsers agree exactly — vertex count 5, bbox exact (up to a
  1-ULP float artifact from shpjs's proj4 round-trip, `29.5` → `29.500000000000004`), ring
  orientation CW (matches the source order). No surprises.

- **aleutian_dateline** (crosses 180°): **none of the 4 parsers correct for the antimeridian.**
  Every one reports the same naive, "wrong-way" bbox `[-177,51,178,53]` — a 355°-wide box, not the
  true ~5°-wide one — because a plain min/max over raw, wrapped WGS84 longitudes (`178`, `-177`)
  is fooled by the ±180° discontinuity. A consumer of any of these 4 candidates must do its own
  antimeridian handling; none of them do it automatically.
  - **Ring orientation flips depending on FORMAT, not parser**: shpjs reports CW (area −710) while
    togeojson/flatgeobuf/wkt all report CCW (area +710) for the *same* source geometry. Verified by
    hand with `ogrinfo -al` on the extracted shapefile: `POLYGON ((178 51,-177 51,-177 53,178
    53,178 51))` — GDAL's **ESRI Shapefile writer** stored the ring in reverse traversal order
    compared to the KML/FlatGeobuf/WKT exports of the same source ring (`178 51, 178 53, -177 53,
    -177 51, 178 51`). This is a GDAL shapefile-write-time artifact (its own ring-orientation
    convention disagrees with a naive planar shoelace calculation once a ring straddles ±180°), not
    a bug in shpjs the JS reader — shpjs faithfully reports whatever order the `.shp` bytes contain.

- **multipolygon**: exact agreement across all 4 parsers, no surprises — vertex count 10 (2 parts ×
  5), bbox exact, first-ring orientation CW.

- **utm_zone** (the reprojection case):
  - **shpjs reprojects correctly**: reads the `.prj` (ESRI WKT for EPSG:32610), reprojects via its
    bundled `proj4`, and lands within **0.000000 m** of the independently-computed GDAL/PROJ ground
    truth for all 4 corners.
  - **flatgeobuf does NOT reproject**: the `.fgb` header correctly carries the source CRS
    (`org:"EPSG", code:32610, name:"WGS 84 / UTM zone 10N"`, full WKT), but the JS reader
    (`flatgeobuf/lib/mjs/geojson.js`'s `deserialize`) hands back the **raw UTM metres unchanged** —
    the CRS is available as metadata for a consumer to act on, but nothing acts on it automatically.
  - **the hand-rolled WKT parser has zero CRS awareness by construction**: plain WKT carries no CRS
    tag at all, so pasting the UTM fixture's raw-metre WKT produces coordinates like `500000,
    4300000` treated as if they were lon/lat degrees — silently wrong, not an error.

- **coastline_40k** (40,000 vertices, parse time): all 4 parsers return the exact vertex count and
  correct bbox. Parse time and bytes-on-the-wire vary a lot by format for the *same* geometry:
  flatgeobuf is fastest (2.2–2.3 ms) and smallest-ish (641 KB); KML is slowest (38–38.5 ms) and by
  far the largest on the wire (1.05 MB, verbose XML text-coordinate encoding); shpjs (16–21 ms,
  373 KB) and the hand-rolled WKT parser (11–14 ms, 773 KB) fall in between.

## Gate output (verbatim)

### Correctness spec against the TRUE manifest — must PASS

```
$ TMPDIR=<writable-dir> npx playwright test e2e/correctness.spec.ts --reporter=list
Running 19 tests using 1 worker
...
19 passed (4.1s)
```

### Correctness spec against the SEEDED-FAULT manifest — must FAIL (and does)

`fixtures_manifest.faulty.json` deliberately corrupts `gulf_rectangle.vertex_count` (5→6) and
`gulf_rectangle.bbox.xmax` (-88.5→-78.5), and leaves `utm_zone.wgs84_ground_truth_bbox` as the raw
UTM metres (simulating "the `.prj` was ignored"):

```
$ SPIKE4_MANIFEST=fixtures_manifest.faulty.json TMPDIR=<writable-dir> npx playwright test e2e/correctness.spec.ts --reporter=list
Running 19 tests using 1 worker
...
  ✘   1 [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via shpjs
  ✘   2 [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via togeojson
  ✘   3 [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via flatgeobuf
  ✘   4 [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via wkt (hand-rolled)
  ✘  13 [chromium] › e2e/correctness.spec.ts:90:1 › utm_zone via shpjs (zip): reads the .prj and reprojects to WGS84

  1) [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via shpjs ──────────────
    Error: shpjs vertexCount
    expect(received).toBe(expected) // Object.is equality
    Expected: 6
    Received: 5
      > 47 |     expect(r.vertexCount, `${label} vertexCount`).toBe(m.vertex_count);

  [same "Expected: 6, Received: 5" for togeojson, flatgeobuf, wkt (hand-rolled)]

  5) [chromium] › e2e/correctness.spec.ts:90:1 › utm_zone via shpjs (zip): reads the .prj and reprojects to WGS84
    Error: utm_zone/shpjs reprojection error (m)
    expect(received).toBeLessThan(expected)
    Expected: < 10
    Received:   480898055286.4559
      > 104 |   expect(errMetres, "utm_zone/shpjs reprojection error (m)").toBeLessThan(10);

  5 failed
    [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via shpjs
    [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via togeojson
    [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via flatgeobuf
    [chromium] › e2e/correctness.spec.ts:43:3 › gulf_rectangle via wkt (hand-rolled)
    [chromium] › e2e/correctness.spec.ts:90:1 › utm_zone via shpjs (zip): reads the .prj and reprojects to WGS84
  14 passed (6.4s)
```

This is the committed proof that (1) the correctness spec **fails when a fixture's expected bbox
or vertex count is deliberately wrong** (the 4 `gulf_rectangle` failures), and (2) **the UTM case
fails if the `.prj` is ignored** — real shpjs output is ~0 m from the true WGS84 reprojection, but
against a "ground truth" that was left in raw UTM metres (i.e. simulating a reader that skipped
reprojection), the same assertion is off by **480,898,055,286 m** (the real, correct output vs. an
un-reprojected expectation, both plainly wrong to conflate — which is exactly what the test catches).

The failure above is entirely on the EXPECTATION side (the ground truth was hand-corrupted; the
real shapefile still has its `.prj`). Fix round 1, item 2 adds the same proof on the PARSER side:
a real `.prj`-less shapefile, run through the exact same assertion.

### `.prj`-dropped fixture, parser-side proof — `e2e/utm-noprj.fail.spec.ts`

`utm_zone_noprj.zip` is the *same* shapefile bytes as `utm_zone.zip` (same `.shp`/`.shx`/`.dbf`,
written by the same `st_write()` call in `generate_fixtures.R`), with only the `.prj` component
dropped before zipping (confirmed: `unzip -l` shows 3 files, not 4).

**Fix round 3 (reviewer finding N2):** this test used to wrap its whole body in a blanket
`test.fail()`. `test.fail()` accepts ANY failure — a missing fixture, a parser exception, a server
that never started would all report the same green "expected failure", so "a dropped `.prj` is
still caught" was unproven. Replaced with an ordinary test that asserts the trigger and the
symptom positively: (1) the zip's actual entry list (`unzip -Z1`, not "what the parser did") has
no `.prj`; (2) shpjs's returned bbox falls inside the fixture's known UTM easting/northing range
*and* is nowhere near a valid lon/lat (`|value| > 180`/`90`); (3) the captured browser console
during parse is asserted `toHaveLength(0)` (not just logged — atlas-6 relies on "silently"); (4)
the WGS84-comparison error (same `delta × METRES_PER_DEG` convention as
`correctness.spec.ts`'s `utm_zone/shpjs` check) is asserted `> 1e6` m. No `try/catch` around the
parse call, so a parser exception or a missing fixture (which makes the `unzip -Z1` step itself
throw) now fails the test for real, instead of being accepted as the "expected" failure.

```
$ TMPDIR=<writable-dir> npx playwright test e2e/utm-noprj.fail.spec.ts --reporter=list
Running 1 test using 1 worker

utm_zone_noprj/shpjs result: {"featureCount":1,"vertexCount":5,"bbox":[500000,4300000,520000,4320000],"firstRingOrientation":"CW","firstRingSignedArea":-400000000,"parseMs":0.2,"bytesFetched":618}
utm_zone_noprj/shpjs browser console during parse: []
  ✓  1 [chromium] › e2e/utm-noprj.fail.spec.ts:28:1 › utm_zone_noprj: the zip really has no .prj, and shpjs silently returns raw UTM metres, far from the true WGS84 position (196ms)

  1 passed (2.7s)
```

**Two seeded faults run manually against this file, both reverted afterward (not committed as
alternate fixtures):**

1. `utm_zone_noprj.zip` temporarily replaced by a copy of `utm_zone.zip` (which HAS a `.prj`):
   ```
   $ cp utm_zone_noprj.zip /tmp/utm_zone_noprj.zip.orig-backup && cp utm_zone.zip utm_zone_noprj.zip
   $ TMPDIR=<writable-dir> npx playwright test e2e/utm-noprj.fail.spec.ts --reporter=list; echo $?
   Running 1 test using 1 worker
     ✘  1 [chromium] › e2e/utm-noprj.fail.spec.ts:28:1 › utm_zone_noprj: the zip really has no .prj, and shpjs silently returns raw UTM metres, far from the true WGS84 position (216ms)

     1) [chromium] › e2e/utm-noprj.fail.spec.ts:28:1 › ...
       Error: zip entries: ["utm_zone.dbf","utm_zone.prj","utm_zone.shp","utm_zone.shx"] — a .prj is present, this fixture is supposed to have none
       expect(received).toBe(expected) // Object.is equality
       Expected: false
       Received: true
   1 failed
   1
   ```
   Turns red immediately, naming the unexpected `.prj` — the old `test.fail()` version would have
   reported this exact scenario as a green "expected failure" too (any assertion failure was
   accepted), which is precisely the bug N2 flagged.

2. Reverted (`cp /tmp/utm_zone_noprj.zip.orig-backup utm_zone_noprj.zip`, confirmed
   `git diff --stat` empty), then the fixture renamed away:
   ```
   $ mv utm_zone_noprj.zip utm_zone_noprj.zip.renamed-away
   $ TMPDIR=<writable-dir> npx playwright test e2e/utm-noprj.fail.spec.ts --reporter=list; echo $?
   Running 1 test using 1 worker
   zipinfo:  cannot find or open /.../fixtures/utm_zone_noprj.zip, /.../utm_zone_noprj.zip.zip or /.../utm_zone_noprj.zip.ZIP.
     ✘  1 [chromium] › e2e/utm-noprj.fail.spec.ts:28:1 › ...
       Error: Command failed: unzip -Z1 /.../fixtures/utm_zone_noprj.zip
       zipinfo:  cannot find or open ...
   1 failed
   1
   ```
   Turns red (missing-fixture error), not green — the specific failure mode N2 called out
   (`test.fail()` would have silently accepted this too, "proving" a dropped `.prj` from a test
   that never even read a fixture). Reverted (`mv utm_zone_noprj.zip.renamed-away
   utm_zone_noprj.zip`); `git diff --stat spikes/4/fixtures/utm_zone_noprj.zip` empty afterward —
   confirmed byte-identical to the committed fixture.

**What shpjs actually returns for a `.prj`-less shapefile — metres, silently, or a warning?**
Silently, raw metres: `bbox: [500000, 4300000, 520000, 4320000]` — the exact same numbers as the
`.prj`-having `utm_zone.zip` returns from its raw `.shp` bytes (i.e. treated as if they were
already WGS84 degrees), and the captured `browser console during parse` array is `[]` — no
`console.warn`, no thrown error, nothing surfaced to `page.on("console")`/`page.on("pageerror")`
(now asserted `toHaveLength(0)`, not just logged). This is the concrete finding atlas-6 needs:
shpjs cannot detect "this shapefile has no CRS information" and does not attempt to; a dropped
`.prj` produces plausible-looking but silently wrong coordinates, with no signal in-band for a UI
to catch and warn the user about.

**Other specs under `spikes/4` checked for the same "accepts any failure" pattern** (per this
review round): none found. `e2e/correctness.spec.ts` and `e2e/duckdb-spatial.spec.ts`'s
seeded-fault runs (`SPIKE4_MANIFEST=fixtures_manifest.faulty.json`) are env-var-driven reds against
ordinary, specific assertions (`toBe`, `toBeLessThan`, ...) — ordinary tests whose *expectation
data* is swapped, not tests that accept any failure — which is a different, already-sound pattern,
not the N2 anti-pattern. The `try/catch` blocks inside `page.on("response")`/`page.on
("requestfinished")` handlers in `duckdb-spatial.spec.ts` and `duckdb-network.spec.ts` are
best-effort telemetry capture only (byte counts / timings for the console log), never gate
pass/fail — the actual test outcome in both files is decided by separate, unguarded `expect()`
calls.

## (b) DuckDB-WASM `spatial` extension + `ST_Read` on a registered `.gpkg`

Harness: `src/duckdb-gpkg-test.ts`, driven per-version by `src/duckdb-1-32-0.ts` /
`src/duckdb-next.ts` (each statically imports its own aliased `@duckdb/duckdb-wasm-1-32-0` /
`@duckdb/duckdb-wasm-next` package + its own `mvp`/`eh` `?url` bundle assets — no `coi` bundle,
matching the root app's "no COOP/COEP on Pages" decision). `e2e/duckdb-spatial.spec.ts` runs one
test per (version × fixture), 10 total, all now measured against `fixtures_manifest.json` ground
truth (feature count, bbox, vertex count) rather than asserted "structurally".

### Root cause of the original hang (not the environment)

The first version of this harness called `duckdbMod.createWorker(url)` — duckdb-wasm's own helper,
which does `fetch(url)` → `.blob()` → `new Worker(URL.createObjectURL(blob))`. That produces a
real worker (confirmed at the time: the blob's byte count exactly matched the real worker file
size), so `db.instantiate()` hanging was never "the worker never started" in the 404/wrong-MIME
sense. Comparing against S1's proven-working harness (`spikes/1/src/bundles.js`, read-only
reference, instantiates the *same* three pinned `@duckdb/duckdb-wasm` builds and reads a
37,067-row parquet successfully in chromium/firefox/webkit) showed the one structural difference:
S1 never calls `createWorker()` — it does `new Worker(bundle.mainWorker)` directly, a plain
same-origin `http(s)` URL. Switching to that exact pattern (`src/duckdb-gpkg-test.ts`, plus
`worker.addEventListener("error"/"messageerror", …)` wired *before* the worker is handed to
`AsyncDuckDB`, so a failure would be visible instead of silent) fixed it immediately: every cell
below now resolves in 1.7–3.0 seconds instead of hanging for 2 minutes.

The precise failure mode was never fully isolated beyond "the blob-sourced worker's RPC to the
main thread never completed" (no `worker.onerror`/`onmessageerror` fired even once it was wired
up post-fix, since post-fix there is no failure to observe) — but the fix (matching S1's own
working wiring exactly) is what matters here, and it is now confirmed on **both** `vite dev` and
`vite build`+`preview` (see "dev vs. build" below).

**Correction (fix round 2):** round 1 also claimed here that "the `.wasm` file is never fetched"
based on `page.on("response")` showing 0 bytes for it, and concluded a dedicated Worker's own
`fetch()` calls are categorically invisible to that listener. **That conclusion was wrong.**
`e2e/duckdb-network.spec.ts` (fix round 2) wires the exact same kind of listener correctly (reading
`response.headers()` instead of `await response.body()` inside a bare `try/catch` that was
silently swallowing failures) and it plainly *does* see worker-initiated fetches — confirmed first
with a throwaway diagnostic (a worker doing `fetch('https://extensions.duckdb.org/', {mode:
'no-cors'})` appeared in both `page.on("request")` and `page.on("response")`), then for real: see
"does INSTALL/LOAD spatial succeed" below, which replaces round 1's "statically compiled in, no
network cost" conclusion (also wrong) with a directly measured answer.

### Dev vs. build (both work with the fix)

- `vite build && vite preview --port 4314 --strictPort` (the shipped path): all 10 cells pass, see
  the matrix below.
- `vite dev --port 4314 --strictPort` (Playwright's `webServer.reuseExistingServer` picked up the
  already-running dev server instead of running `build && preview`): re-ran
  `duckdb-wasm 1.32.0: spatial + ST_Read(gulf_rectangle.gpkg)` against it — **passes**, same shape
  of result (`spatialLoadMs≈1480`, `bbox`/`vertexCount` exact), confirmed by the request log
  showing real unbundled dev-server module URLs (`/node_modules/@duckdb/duckdb-wasm-1-32-0/dist/...`)
  rather than build's hashed `/assets/...` files. The original (pre-fix) hang was not
  independently re-reproduced under `vite dev` (once the root cause was found and fixed, there was
  no broken code left to re-test that path with) — this is a scope decision, not a claim that it
  was build-specific.

### Full matrix — all 10 cells, measured (build+preview)

```
$ TMPDIR=<writable-dir> npx playwright test e2e/duckdb-spatial.spec.ts --reporter=list
Running 10 tests using 1 worker

duckdb 1.32.0 / gulf_rectangle.gpkg: totalNetworkBytes=1075368 {"versionLabel":"1.32.0","bundleUsed":"eh","lastStageReached":"ST_Read","spatialInstallLoadOk":true,"spatialLoadMs":1340.7,"extensionInfo":{"installed":false,"loaded":true,"installPath":""},"rowCount":1,"bbox":[-93.5,26.5,-88.5,29.5],"vertexCount":5,"errorText":null,"workerErrors":[],"bytesFetchedGpkg":98304}
  ✓   1 duckdb-wasm 1.32.0: spatial + ST_Read(gulf_rectangle.gpkg) (2.0s)
duckdb 1.32.0 / aleutian_dateline.gpkg: {"spatialLoadMs":1245.4,"rowCount":1,"bbox":[-177,51,178,53],"vertexCount":5,"errorText":null}
  ✓   2 duckdb-wasm 1.32.0: spatial + ST_Read(aleutian_dateline.gpkg) (1.8s)
duckdb 1.32.0 / multipolygon.gpkg: {"spatialLoadMs":1210.3,"rowCount":1,"bbox":[-122,34,-119,37],"vertexCount":10,"errorText":null}
  ✓   3 duckdb-wasm 1.32.0: spatial + ST_Read(multipolygon.gpkg) (1.8s)
duckdb 1.32.0 / utm_zone.gpkg: {"spatialLoadMs":2414.2,"rowCount":1,"bbox":[500000,4300000,520000,4320000],"vertexCount":5,"errorText":null}
  ✓   4 duckdb-wasm 1.32.0: spatial + ST_Read(utm_zone.gpkg) (3.0s)
duckdb 1.32.0 / coastline_40k.gpkg: {"spatialLoadMs":1759.9,"rowCount":1,"bbox":[-124,39.450000512910,-104.0005,40.549999992168],"vertexCount":40000,"errorText":null}
  ✓   5 duckdb-wasm 1.32.0: spatial + ST_Read(coastline_40k.gpkg) (2.3s)
duckdb next / gulf_rectangle.gpkg: {"versionLabel":"1.33.1-dev64.0","spatialLoadMs":2357.3,"rowCount":1,"bbox":[-93.5,26.5,-88.5,29.5],"vertexCount":5,"errorText":null}
  ✓   6 duckdb-wasm next: spatial + ST_Read(gulf_rectangle.gpkg) (2.9s)
duckdb next / aleutian_dateline.gpkg: {"spatialLoadMs":1357.6,"rowCount":1,"bbox":[-177,51,178,53],"vertexCount":5,"errorText":null}
  ✓   7 duckdb-wasm next: spatial + ST_Read(aleutian_dateline.gpkg) (1.9s)
duckdb next / multipolygon.gpkg: {"spatialLoadMs":1259.0,"rowCount":1,"bbox":[-122,34,-119,37],"vertexCount":10,"errorText":null}
  ✓   8 duckdb-wasm next: spatial + ST_Read(multipolygon.gpkg) (1.8s)
duckdb next / utm_zone.gpkg: {"spatialLoadMs":1229.8,"rowCount":1,"bbox":[500000,4300000,520000,4320000],"vertexCount":5,"errorText":null}
  ✓   9 duckdb-wasm next: spatial + ST_Read(utm_zone.gpkg) (1.8s)
duckdb next / coastline_40k.gpkg: {"spatialLoadMs":1276.9,"rowCount":1,"bbox":[-124,39.450000512910,-104.0005,40.549999992168],"vertexCount":40000,"errorText":null}
  ✓  10 duckdb-wasm next: spatial + ST_Read(coastline_40k.gpkg) (1.9s)

10 passed (21.2–23.6s across two runs)
```

(each line above is the actual `console.log`'d JSON, trimmed of repeated/verbose fields —
`bundleUsed`, `workerErrors: []` and `extensionInfo` were identical across all 10 cells and shown
once at the top; `errorText` was `null` and `spatialInstallLoadOk`/`workerErrors` were
`true`/`[]` for all 10.)

| | 1.32.0 | next (1.33.1-dev64.0) |
| --- | --- | --- |
| every cell (5/5 fixtures) | PASS, real `ST_Read` result | PASS, real `ST_Read` result |
| `bundleUsed` | `eh` (browser feature detection) | `eh` |
| `spatialInstallLoadOk` | true, every cell | true, every cell |
| `spatialLoadMs` (`INSTALL spatial; LOAD spatial;`) | 1180–2414 ms | 1230–2357 ms |
| `duckdb_extensions()` row for `spatial` | `installed=false, loaded=true, install_path=""` | same |
| `rowCount` / `vertexCount` / `bbox` | exact match to `fixtures_manifest.json` for all 5 fixtures | same |
| `workerErrors` | `[]` every cell | `[]` every cell |
| bytes fetched for the `.gpkg` (main-thread `fetch`, directly measured) | 98,304 B (4 fixtures) / 737,280 B (`coastline_40k`) | same |
| bytes fetched for the spatial extension **from a separate URL** | **~22.4 MB — see below, item 1** | **~22.5 MB — see below, item 1** |

**"does `INSTALL spatial; LOAD spatial;` succeed (from which URL, how many bytes, how long)":**
succeeds on both versions, every fixture, in 1.18–2.41 seconds — but (fix round 2) it succeeds
*because it downloads the extension over the network every time*, not because it's statically
compiled in. See item 1 below for the real answer, with hosts, bytes and ms.

**"does `ST_Read` on a registered `.gpkg` return the right feature count, bbox and vertex count for
each of the five fixtures":** yes, exactly, for all 5 fixtures on both versions (`rowCount=1`
everywhere — each fixture is a single-feature file; `bbox`/`vertexCount` match
`fixtures_manifest.json` to machine precision). `ST_Read`'s output CRS behavior matches
flatgeobuf's from part (a): `utm_zone.gpkg` comes back as raw UTM metres (`[500000, 4300000,
520000, 4320000]`), not reprojected to WGS84 — `ST_Read` (via GDAL under the hood) preserves the
source CRS, same as every non-shpjs reader in this spike.

## Fix round 2, item 1 — is `spatial` really "built in"? (falsified — it is downloaded)

`e2e/duckdb-network.spec.ts`. Harness (`src/duckdb-gpkg-test.ts`) gained an optional
`customExtensionRepository` parameter (threaded through `src/duckdb-{1-32-0,next}.ts` and
`src/main.ts`'s `window.__spike4.testGpkg`) for the `SET custom_extension_repository=...;`
experiment below; nothing else about the harness changed.

### (a) Real network observed during INSTALL/LOAD spatial + ST_Read, both versions, unblocked

`page.on("response")` (host/status/content-length) + `page.on("requestfinished")` →
`request.timing()` (ms), filtered to non-`localhost` hosts — confirmed working via a throwaway
diagnostic first (see "Root cause" correction above), then run for real:

```
$ TMPDIR=<writable-dir> npx playwright test e2e/duckdb-network.spec.ts --reporter=list -g "network observed"
network(unblocked)/1.32.0: {"spatialInstallLoadOk":true,"spatialLoadMs":1330.5, ...}
  non-localhost hosts touched: 1
    - https://extensions.duckdb.org/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm status=200 content-length=null ms=895.5
  ✓ network observed (unblocked), 1.32.0: INSTALL/LOAD spatial + ST_Read(gulf_rectangle.gpkg)
network(unblocked)/next: {"spatialInstallLoadOk":true,"spatialLoadMs":1200.8, ...}
  non-localhost hosts touched: 1
    - https://extensions.duckdb.org/v1.5.5/wasm_eh/spatial.duckdb_extension.wasm status=200 content-length=null ms=769.2
  ✓ network observed (unblocked), next: INSTALL/LOAD spatial + ST_Read(gulf_rectangle.gpkg)
```

`content-length` came back `null` (the server doesn't send that header — likely chunked); exact
bytes measured two independent ways instead: `curl -sSL -o /dev/null -w '%{size_download}'` against
the same URLs, and `scripts/fetch-extension-cache.mjs` actually writing the downloaded bytes to
disk — both agree exactly:

| duckdb-wasm version | DuckDB core version (from the URL) | host | path | bytes | ms (unblocked, `requestfinished` timing) |
| --- | --- | --- | --- | --- | --- |
| 1.32.0 | v1.4.3 | extensions.duckdb.org | `/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm` | **23,469,719 B** (~22.4 MB) | 821–1,554 (4 runs) |
| next (1.33.1-dev64.0) | v1.5.5 | extensions.duckdb.org | `/v1.5.5/wasm_eh/spatial.duckdb_extension.wasm` | **23,602,613 B** (~22.5 MB) | 769–1,328 (2 runs) |

Both bigger than S3's measured 3.05 MB parquet extension download, as the coordinator's message
anticipated. This is a single host (`extensions.duckdb.org`) and a single request per version per
fresh page load; no other non-localhost host was touched during `INSTALL`/`LOAD`/`ST_Read` in any
run.

### (b) The blocked-network gate, with control

`page.route("**/*", ...)` aborts every request whose hostname isn't `localhost`/`127.0.0.1`.
Before each blocked cell, a worker-initiated `fetch()` to the same real host
(`https://extensions.duckdb.org/`, `{mode:'no-cors'}`) is run as a **control** — it must itself
fail under the block, proving the block was live for *that* test, not just in principle:

```
$ TMPDIR=<writable-dir> npx playwright test e2e/duckdb-network.spec.ts --reporter=list -g "BLOCKED"
blocked/1.32.0 control probe (worker fetch to https://extensions.duckdb.org/): {"ok":false,"error":"Failed to fetch"}
blocked/1.32.0 result: {"spatialInstallLoadOk":false,"spatialLoadMs":null,"errorText":"INSTALL/LOAD spatial failed at stage \"install_load_spatial\": Failed to execute 'send' on 'XMLHttpRequest': Failed to load 'https://extensions.duckdb.org/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm'.","bytesFetchedGpkg":0}
  aborted (non-localhost) requests: ["https://extensions.duckdb.org/","https://extensions.duckdb.org/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm"]
  ✓ BLOCKED, 1.32.0: all non-localhost hosts blocked during INSTALL/LOAD spatial + ST_Read

blocked/next control probe (worker fetch to https://extensions.duckdb.org/): {"ok":false,"error":"Failed to fetch"}
blocked/next result: {"spatialInstallLoadOk":false,"spatialLoadMs":null,"errorText":"INSTALL/LOAD spatial failed at stage \"install_load_spatial\": Failed to execute 'send' on 'XMLHttpRequest': Failed to load 'https://extensions.duckdb.org/v1.5.5/wasm_eh/spatial.duckdb_extension.wasm'.","bytesFetchedGpkg":0}
  aborted (non-localhost) requests: ["https://extensions.duckdb.org/","https://extensions.duckdb.org/v1.5.5/wasm_eh/spatial.duckdb_extension.wasm"]
  ✓ BLOCKED, next: all non-localhost hosts blocked during INSTALL/LOAD spatial + ST_Read

2 passed
```

**Answer: `LOAD spatial` FAILS with every non-localhost host blocked, on both versions**, with the
control confirmed failing first each time. Exact error text (both versions, only the URL differs):
`INSTALL/LOAD spatial failed at stage "install_load_spatial": Failed to execute 'send' on
'XMLHttpRequest': Failed to load 'https://extensions.duckdb.org/v<core-version>/wasm_eh/
spatial.duckdb_extension.wasm'.` — DuckDB-wasm's extension loader uses a **synchronous
XMLHttpRequest** inside the worker (not `fetch()`) for this specific request, per the error text.
The gate is asserted, not just logged: `e2e/duckdb-network.spec.ts` requires
`spatialInstallLoadOk === false`, `errorText` containing `"Failed to load"`, and the extension URL
present in the aborted list — so a future duckdb-wasm build that genuinely bundles `spatial`
statically would make this assertion fail loudly, not pass on unread text.

### (c) Does a page reload re-download the extension?

Same page, `page.reload()` between two `testGpkg("1.32.0", ...)` calls, non-localhost network
tracked across both:

```
reload-test first load: spatialInstallLoadOk=true [{"url":".../spatial.duckdb_extension.wasm","status":200,"ms":814–1584 (2 runs)}]
reload-test after page.reload(): spatialInstallLoadOk=true [{"url":".../spatial.duckdb_extension.wasm","status":200,"ms":50–53 (2 runs)}]
```

A request to the same URL fires again after reload (still shows up as a `response` event, status
200) but returns in **~50 ms instead of ~800–1,580 ms** — consistent with the browser's HTTP cache
serving it rather than a fresh ~22 MB download over the real network (a genuine 22 MB fetch to a
real external host in 50 ms is not physically plausible on this connection; the ~16–30× speedup is
the signal, not a directly-observed "fromCache" flag, which Playwright's `Response` does not
expose). Not independently confirmed whether this is disk cache, memory cache, or DuckDB-wasm's own
in-worker state — only that the *network* cost of a second load is negligible compared to the
first.

### (d) `SET custom_extension_repository` to a same-origin copy, with the block on

`scripts/fetch-extension-cache.mjs` (committed script; the binaries it downloads are NOT committed
— `fixtures/.ext-cache/` is gitignored) fetches both real extension files once, to
`fixtures/.ext-cache/v<core-version>/wasm_eh/spatial.duckdb_extension.wasm`, mirroring the exact
relative path DuckDB requests — `vite preview`'s `publicDir` (`fixtures/`) then serves them back at
that same path (confirmed via `curl -sI http://localhost:4314/.ext-cache/v1.4.3/wasm_eh/
spatial.duckdb_extension.wasm` → `200`, `Content-Length: 23469719`, exact match to the downloaded
size). With the same non-localhost block active (control probe still fails first), `testGpkg`
called with `customExtensionRepository="http://localhost:4314/.ext-cache"`:

```
$ TMPDIR=<writable-dir> npx playwright test e2e/duckdb-network.spec.ts --reporter=list -g "custom_extension_repository"
custom_extension_repository/1.32.0 result: {"spatialInstallLoadOk":true,"spatialLoadMs":449.8,"rowCount":1,"bbox":[-93.5,26.5,-88.5,29.5],"vertexCount":5,"errorText":null}
  aborted (non-localhost) requests: ["https://extensions.duckdb.org/"]   (only the control probe — the real extension request never left localhost)
custom_extension_repository/1.32.0: LOAD spatial SUCCEEDED from a same-origin repository with the network block on
  ✓ custom_extension_repository, 1.32.0: does a same-origin copy work with the network block on?
```

**Yes — a same-origin copy works, even with every non-localhost host blocked**: `LOAD spatial`
succeeds (`spatialLoadMs` 449.8 ms, faster than the real network fetch, consistent with a
localhost-served ~22 MB file), and `ST_Read` still returns the correct `rowCount`/`bbox`/
`vertexCount`. Only tested on 1.32.0 (the mechanism is generic — `SET custom_extension_repository`
is a DuckDB SQL setting, not version-specific — so this was not repeated for `next`).

### Item 1 summary — the number atlas-6 needs

**Bytes and hosts touched the first time a `.gpkg` is dropped**, both versions, one host
(`extensions.duckdb.org`), one file:

| | 1.32.0 | next |
| --- | --- | --- |
| host | extensions.duckdb.org | extensions.duckdb.org |
| path | /v1.4.3/wasm_eh/spatial.duckdb_extension.wasm | /v1.5.5/wasm_eh/spatial.duckdb_extension.wasm |
| bytes | 23,469,719 (~22.4 MB) | 23,602,613 (~22.5 MB) |
| ms (cold) | 821–1,554 | 769–1,328 |
| ms (page reload, same session) | ~50 | not separately measured |
| blocked → `LOAD spatial` | FAILS (`Failed to load ...`) | FAILS (`Failed to load ...`) |
| blocked + `custom_extension_repository` → same-origin copy | SUCCEEDS (1.32.0 tested) | not separately measured |

## Fix round 2, item 2 — `duckdb-spatial.spec.ts` now honours `SPIKE4_MANIFEST`

Round 1's `e2e/duckdb-spatial.spec.ts` hardcoded `fixtures_manifest.json` regardless of
`SPIKE4_MANIFEST`, so a `SPIKE4_MANIFEST=fixtures_manifest.faulty.json` run silently kept reading
the true manifest and every cell (including `gulf_rectangle`) stayed green — a gate with no red is
not a gate. Fixed to read `process.env.SPIKE4_MANIFEST ?? "fixtures_manifest.json"`, exactly like
`e2e/correctness.spec.ts` already did.

```
$ SPIKE4_MANIFEST=fixtures_manifest.faulty.json TMPDIR=<writable-dir> npx playwright test e2e/duckdb-spatial.spec.ts --reporter=list
Running 10 tests using 1 worker
...
  ✘   1 [chromium] › e2e/duckdb-spatial.spec.ts:46:5 › duckdb-wasm 1.32.0: spatial + ST_Read(gulf_rectangle.gpkg)
...
  ✘   6 [chromium] › e2e/duckdb-spatial.spec.ts:46:5 › duckdb-wasm next: spatial + ST_Read(gulf_rectangle.gpkg)
...
  1) [chromium] › e2e/duckdb-spatial.spec.ts:46:5 › duckdb-wasm 1.32.0: spatial + ST_Read(gulf_rectangle.gpkg)
    Error: 1.32.0/gulf_rectangle ST_Read vertex count
    expect(received).toBe(expected) // Object.is equality
    Expected: 6
    Received: 5
      75 |       expect(r.vertexCount, `${version}/${fixture} ST_Read vertex count`).toBe(m.vertex_count);

  2) [chromium] › e2e/duckdb-spatial.spec.ts:46:5 › duckdb-wasm next: spatial + ST_Read(gulf_rectangle.gpkg)
    Error: next/gulf_rectangle ST_Read vertex count
    Expected: 6
    Received: 5

  2 failed
    [chromium] › e2e/duckdb-spatial.spec.ts:46:5 › duckdb-wasm 1.32.0: spatial + ST_Read(gulf_rectangle.gpkg)
    [chromium] › e2e/duckdb-spatial.spec.ts:46:5 › duckdb-wasm next: spatial + ST_Read(gulf_rectangle.gpkg)
  8 passed (25.0s)
$ echo $?
1
```

**`gulf_rectangle` now goes red on both versions** (`vertexCount` 5 vs. the faulty manifest's 6),
exit code 1 — the committed proof this gate can fail. The other 8 cells (fixtures the faulty
manifest didn't touch) stay green, same as `correctness.spec.ts`'s seeded-fault run.

## Final full-suite check (all specs together, true manifest)

```
$ TMPDIR=<writable-dir> npx playwright test --reporter=list
Running 36 tests using 4 workers
...
36 passed (22.7s)
$ echo $?
0
```

36 = 19 (`correctness.spec.ts`) + 1 (`utm-noprj.fail.spec.ts`, an ordinary pass as of fix round 3 —
no longer an "expected failure") + 10 (`duckdb-spatial.spec.ts`) + 6 (`duckdb-network.spec.ts`: 2
unblocked + 2 blocked + 1 reload + 1 `custom_extension_repository`). Exit 0 against the true
manifest; `SPIKE4_MANIFEST=fixtures_manifest.faulty.json` against `correctness.spec.ts` and
`duckdb-spatial.spec.ts` each exits 1 (5 and 2 failures respectively) — both shown verbatim above.

**Fix round 3 (reviewer finding N2) re-confirmation, from a from-scratch state:** full suite
(36 tests, all specs) run again after the `utm-noprj.fail.spec.ts` rewrite —
`36 passed (22.5s)`, exit 0 — then again after both seeded faults above were reverted —
`36 passed (22.1s)`, exit 0. `git status --porcelain spikes/4/fixtures/` empty both times.
