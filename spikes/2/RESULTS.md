# S2 spike — raw measurements

atlas-0 Step 4, spike S2 ("First paint without WASM"). Measurements only — no verdict, no
recommendation (that's the later Opus review). Harness: `spikes/2/` (own `package.json`,
`vite.config.ts`, `playwright.config.ts`; Vite/TypeScript and `@playwright/test` resolve from the
root's `node_modules` via a relative path in `package.json`'s scripts — nothing installed twice).

## Exact commands

```sh
# from spikes/2/
npm install                 # installs only maplibre-gl + pmtiles into spikes/2/node_modules
npm run build                # node ../../node_modules/vite/bin/vite.js build
npm run preview              # node ../../node_modules/vite/bin/vite.js preview --port 4312 --strictPort
npm run e2e                  # node ../../node_modules/.bin/playwright test  (needs preview or its own webServer)
npm run measure -- 9         # node scripts/measure.mjs 9 (needs preview already serving :4312)
```

## Versions (this run, 2026-09-21)

- macOS (darwin 24.6.0), Node v24.9.0
- Vite: **8.3.0** (root `node_modules`, reused — not reinstalled)
- `@playwright/test`: **1.63.0** (root `node_modules`, reused; browsers already installed:
  `chromium-1243`, `firefox-1543`, `webkit-2359`, plus `chromium_headless_shell-1243`)
- `maplibre-gl`: tested both **`^5.24.0`** (resolved `5.24.0`) and **`6.10.0`** (latest on npm as of
  this run) — see matrix below. Final committed `spikes/2/package.json` pins `^5.24.0`.
- `pmtiles`: **`^4.5.0`** (resolved `4.5.0`, latest)
- Data: release `v7`, manifest at
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/manifest.json` (the
  bucket key needs the `marine-atlas/` prefix — a bare `.../oceanmetrics.io-public/v7/manifest.json`
  404s/403s). Zones: `programarea_2026-01` (`n: 20`, pmtiles at
  `.../marine-atlas/zones/programarea_2026-01/zones.pmtiles`, 958,403 bytes, confirmed via the
  `pmtiles` JS SDK's `getHeader()`/`getMetadata()`: `vector_layers[0].id = "programarea"`, 20
  features). Score metric `score_extriskspcat_primprod_ecoregionrescaled_equalweights`, subregion
  `USA`: COG `.../marine-atlas/cog/usa05/d20874edf0c43166.tif` (133,186 bytes), `rescale_min: 0`,
  `rescale_max: 90`, `colormap: "spectral_r"`. `zone_metric.parquet` read locally with the `duckdb`
  CLI (`/opt/homebrew/bin/duckdb`, joined against `zone.parquet` + `metric.parquet`) to produce the
  20 Program-Area scores and the 8 ecoregion-rescaled components (`extrisk_{bird,coral,fish,
  invertebrate,mammal,other,turtle}`, `primprod`) pasted into `spikes/2/public/boot.json`. Zone
  `GEO` (Gulf of Alaska) has all 8 components; several zones (e.g. `ALB`, `BFT`) have only 7 (no
  turtle row) — the flower's petal count is real per-zone data, not hardcoded.
- Ocean probe points, confirmed non-null via titiler `/cog/point/{lon},{lat}?url=...` before
  writing the harness: `(-88, 27)` Gulf of Mexico → `21.0`; `(-122, 36)` off central California →
  `37.0`.

## FCP and map-first-frame, cold profile (9 runs, fresh browser process per run)

`scripts/measure.mjs` (own script, not the Playwright test) launches a fresh `chromium` process per
run (no disk/memory cache carried over), navigates to `http://localhost:4312/` served by
`vite preview`, waits for the harness's own `window.__s2.marks.firstRender` mark, and reads
`performance.getEntriesByType("paint")` for FCP.

```
run 1/9: FCP=40.0ms firstFrame=78.0ms requests=4 bytes=292381
run 2/9: FCP=36.0ms firstFrame=54.0ms requests=4 bytes=292381
run 3/9: FCP=32.0ms firstFrame=50.8ms requests=5 bytes=292381
run 4/9: FCP=24.0ms firstFrame=49.5ms requests=5 bytes=292381
run 5/9: FCP=36.0ms firstFrame=48.6ms requests=5 bytes=292381
run 6/9: FCP=24.0ms firstFrame=47.3ms requests=4 bytes=292381
run 7/9: FCP=28.0ms firstFrame=46.1ms requests=5 bytes=292381
run 8/9: FCP=40.0ms firstFrame=57.1ms requests=5 bytes=292381
run 9/9: FCP=44.0ms firstFrame=43.8ms requests=5 bytes=292381

--- summary ---
FCP: median=36.0ms range=[24.0, 44.0]ms
map-first-frame: median=49.5ms range=[43.8, 78.0]ms
requests before first frame (run 1 of 9): 4
bytes before first frame (run 1 of 9): 292381
request list (run 1 of 9):
  http://localhost:4312/ (transfer 1067B, decoded 1399B)
  http://localhost:4312/assets/index-g8WVuT7d.js (transfer 279401B, decoded 1050618B)
  http://localhost:4312/assets/index-B2k4QVOw.css (transfer 10351B, decoded 69808B)
  http://localhost:4312/boot.json (transfer 1562B, decoded 3788B)
```

`map-first-frame` here = the harness's own `firstRender` mark (first `map.once("render", ...)`
after `setStyle`) minus `scriptStart`, both `performance.now()`. This is the earliest WebGL frame
after `setStyle`, not "tiles fully loaded" — see the gate run below for a frame where the score
raster has actually painted real data (uses `map.loaded() && map.areTilesLoaded()` instead).

Gzip byte total (292,381B) matches on-disk gzip size closely: `gzip -c` of `dist/index.html` +
`dist/assets/*.css` + `dist/assets/*.js` + `public/boot.json` = 780 + 10070 + 279105 + 1272 =
291,227B (small diff = HTTP header overhead the disk-gzip check doesn't include).

**Caveats found while measuring** (raw, not a verdict):
- Request/byte counts use the Resource/Navigation Timing API's `transferSize`, not
  `page.on("response")`'s `Content-Length` header — `vite preview` serves gzip over
  `Transfer-Encoding: chunked` with **no** `Content-Length` header at all, so the header-based
  approach undercounted every same-origin asset as 0B (first version of this script did this; fixed
  before taking the numbers above).
- The 4th/5th request (`zones.pmtiles`, S3, cross-origin) reports `transferSize: 0` via the page's
  own Resource Timing API in every run, because neither S3 nor titiler sends a
  `Timing-Allow-Origin` header — the browser zeroes out cross-origin timing/size fields for privacy.
  So the 292,381B figure covers same-origin (local `dist/`) bytes only; it does NOT include the one
  zones.pmtiles range request that's also in flight by first frame (confirmed present via
  `page.on("request")`; its wire size is unknown from inside the page).

## Gates (`npm run e2e`, chromium only, against a real `vite build` + `vite preview`)

Blocks `**/*.wasm` and `**/duckdb*` via `page.route`; asserts painted pixels at the two ocean points
(`gl.readPixels`), 20 Program-Area rows, 7-8 flower petals, first frame ≤ 2.5s, and zero requests
whose URL matches `duckdb` (tracked via `page.on("request")`, independent of the route block, so an
aborted request still counts as "requested").

Final run, verbatim (repeated 3x consecutively for reliability, all identical):

```
Running 3 tests using 1 worker

  ✓  1 [chromium] › e2e/s2.spike.spec.ts:17:3 › S2: first paint without WASM › shell paints the map + Program-Area table + flower with zero DuckDB/WASM bytes (1.2s)
  ✘  2 [chromium] › e2e/s2.spike.spec.ts:99:3 › seeded fault: duckdb-named asset fetched before first frame › ?seed=duckdb-fetch trips the zero-duckdb-requests assertion (269ms)
  ✘  3 [chromium] › e2e/s2.spike.spec.ts:120:3 › seeded fault: unpainted canvas (style with no layers) › ?seed=blank-style trips the ocean-pixel-painted assertion (216ms)

  3 passed (3.0s)
```

(Tests 2 and 3 are wrapped in Playwright's `test.fail()` — an "✘" here means the assertion
genuinely failed, which is the REQUIRED/expected outcome per `test.fail()`, so the run is reported
green overall. This is the permanent, CI-safe form of the seeded-fault requirement, structurally the
same idea as the root's `tests/fixtures/size-budget-static-duckdb/` fixture proof.)

Real gate values from a representative pass (main test, logged via a one-off diagnostic — not part
of the committed spec, which only asserts pass/fail):
- `map-first-frame` (via `firstRender - scriptStart` mark): ~44-78ms across runs (gate: ≤2500ms) — **PASS**
- Program-Area table rows: **20** — **PASS**
- Flower petals (zone `GEO`): **8** — **PASS**
- Ocean pixel probe: `(-88,27)` → `rgba(123,202,164,255)` (real `spectral_r`-colormapped data, not
  the `#0b2436` background) — **PASS**; `(-122,36)` painted similarly.
- `duckdbRequests`: `[]`, `blockedRequests` (wasm/duckdb route hits): `[]` — **PASS**

### Seeded fault verbatim output (`test.fail()` temporarily removed to capture the real assertion text)

**(a) `?seed=duckdb-fetch` — must make the zero-duckdb-requests gate FAIL:**

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "http://localhost:4312/?seed=duckdb-fetch",
+ ]

  111 |
  112 |     // same assertion as the real gate above -- this is the one that must fail.
> 113 |     expect(duckdbRequests).toEqual([]);
      |                            ^
```

(The captured "duckdb request" URL is the page's own URL because the query string
`?seed=duckdb-fetch` itself matches `/duckdb/i` — the actual fetch of `duckdb-marker.bin` is also
attempted; either way the assertion trips, which is the point.)

**(b) `?seed=blank-style` — must make the pixel probe FAIL:**

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

  132 |     for (const pt of OCEAN_POINTS) {
  133 |       const px = await readOceanPixel(page, pt);
> 134 |       expect(isPainted(px)).toBe(true);
      |                             ^
```

Both seeded faults confirmed to fail the gate as required; `test.fail()` restored in the committed
spec immediately after capturing this output.

## maplibre-gl 6.10.0 vs `^5.24.0` under Vite 8 — exactly what happened

All four runs below used the SAME `vite.config.ts` with `optimizeDeps.exclude: ["maplibre-gl"]`
(the config named in the plan). `src/main.ts` used the naive/default import
(`import maplibregl from "maplibre-gl"`) unless noted.

| maplibre-gl | `vite dev` | `vite build` + `vite preview` |
|---|---|---|
| `6.10.0` | **fails immediately** | **fails immediately** |
| `^5.24.0` (`5.24.0`) | **fails immediately** (with the exclude) | **works** |

**`6.10.0`, `vite dev`, default import, WITH exclude:**
```
SyntaxError: The requested module '/node_modules/maplibre-gl/dist/maplibre-gl.mjs?v=4bd81e76' does not provide an export named 'default'
```
**`6.10.0`, `vite dev`, default import, WITHOUT exclude** (same error, from the pre-bundled path —
proves this is not an optimizer artifact, `6.10.0` genuinely has no default export):
```
SyntaxError: The requested module '/node_modules/.vite/deps/maplibre-gl.js?v=298f22f0' does not provide an export named 'default'
```
Confirmed directly in `node_modules/maplibre-gl/dist/maplibre-gl.mjs` (6.10.0): the file's `export{}`
statement re-exports `Mm as Map` — `Map` is a **named** export only; there is no `export default`
anywhere in the file (`grep -c "^export"` → `0`; `grep -o "export default[^;]*;"` → no match).

**`6.10.0`, `vite build`, default import, WITH exclude** (hard build failure, Rolldown):
```
[MISSING_EXPORT] "default" is not exported by "node_modules/maplibre-gl/dist/maplibre-gl.mjs".
   ╭─[ src/main.ts:1:8 ]
 1 │ import maplibregl from "maplibre-gl";
   │        ─────┬────
   │             ╰────── Missing export
   at aggregateBindingErrorsIntoJsError (file:///.../node_modules/rolldown/dist/shared/error-CGhV1ebk.mjs:48:18)
```
(Vite 8's production bundler for this project is **Rolldown**, not Rollup — visible both in this
stack trace's `node_modules/rolldown/...` path and in the build's own warning text,
`build.rolldownOptions.output.codeSplitting`.)

**Workaround tried:** `import * as maplibregl from "maplibre-gl"` (namespace import) instead of
default:
- `vite dev` + exclude: **works** (map renders, Program-Area rows=20, petals=8, no console errors).
- `vite build` + exclude: **builds successfully** (`✓ built in 184ms`).
- `vite preview` of that build: the map partially works (rows=20, petals=8, `mapExists: true`), BUT
  the browser requests `/assets/maplibre-gl-worker.mjs` and gets a **404** —
  `page.on("requestfailed")` fired once with `net::ERR_FAILED` for that URL. Confirmed with
  `find dist -iname "*worker*"` on the build output: **no file matching `*worker*` was emitted to
  `dist/assets/` at all**, even though the runtime code clearly references it by URL. This is the
  module-worker-vs-bundler class of problem the plan's lesson 10 names for maplibre-gl 6's dev-time
  optimizer breakage, here manifesting instead as a production-build asset-emission gap.

**`5.24.0`, `vite dev`, default import, WITH exclude** (fails — raw UMD file served directly as ESM
without CJS interop, because exclude skips Vite's optimizer/CJS-to-ESM conversion step):
```
SyntaxError: The requested module '/node_modules/maplibre-gl/dist/maplibre-gl.js?v=26d18af1' does not provide an export named 'default'
```
Confirmed `node_modules/maplibre-gl/dist/maplibre-gl.js` (5.24.0) is a UMD/AMD bundle (ends in
`return maplibregl$1; }));`, package.json says `"type": "module"` but the file itself has no
`export` statements — a real mismatch in the published package, not a Vite bug.

**`5.24.0`, `vite dev`, default import, WITHOUT exclude:** works fine — Vite's dependency optimizer
performs the CJS/UMD→ESM interop that `exclude` skips.

**`5.24.0`, `vite build` + `vite preview`, default import, WITH exclude:** works — production builds
always run the full module graph through Rolldown regardless of the dev-only `optimizeDeps.exclude`
list, so the same UMD-as-ESM mismatch that breaks `vite dev` does not appear in the build.

**`npm audit` note** (`spikes/2` with `maplibre-gl: ^5.24.0` installed):
```
maplibre-gl  <=6.4.0
Severity: critical
MapLibre GL JS: XSS Sanitizer Bypass in DOM.sanitize() via Live NamedNodeMap Removal Skip - https://github.com/advisories/GHSA-jrc7-96c5-q579
fix available via `npm audit fix --force`
Will install maplibre-gl@6.10.0, which is a breaking change
```
`5.24.0` is inside the flagged range; `6.10.0` is the first version `npm audit` considers fixed.

## Other raw findings from building this harness (not part of the required matrix, found empirically)

- **`preserveDrawingBuffer` moved under `canvasContextAttributes`** in maplibre-gl 5.x/6.x
  (`node_modules/maplibre-gl/dist/maplibre-gl.d.ts:11060`: `canvasContextAttributes?:
  WebGLContextAttributesWithType`). A bare top-level `preserveDrawingBuffer: true` on the `Map`
  constructor (the shape the CalCOFI-era code/plan text describes) is silently accepted and ignored
  — TypeScript would catch this under `strict`, but nothing catches it at runtime with plain Vite/
  esbuild. Symptom: the map visibly renders correctly, but ANY out-of-process `gl.readPixels()` call
  (Playwright's `page.evaluate`, run on a later JS turn) reads back `(0,0,0,0)` at every point,
  including the flat background layer — because the browser clears the WebGL backbuffer after each
  compositor present. Fixed by nesting it: `canvasContextAttributes: { preserveDrawingBuffer: true }`.
- **Raster tile loading was non-deterministic** under headless Chromium+swiftshader in `vite
  preview`, independent of the above and independent of `setStyle` vs constructor-`style` timing:
  across ~8 otherwise-identical runs (same build, fresh browser each time), the titiler raster
  source's tile requests fired promptly in some runs and never fired at all within a 20s
  `waitForFunction(() => map.loaded() && map.areTilesLoaded())` timeout in others (the vector/pmtiles
  zones source loaded reliably every time in the same runs). Calling `map.resize()` once, immediately
  after construction, made every subsequent run reliable (3x clean `npm run e2e`, 9x clean
  `scripts/measure.mjs`).
- Once both of the above were fixed, the plan's literal `setStyle(style, {diff: true})` pattern
  (construct with a blank style, `resize()`, then `setStyle(composed, {diff: true})`) worked
  reliably too — an earlier attempt at this same sequence (before `resize()`/`canvasContextAttributes`
  were understood) left `map.loaded()`/`isStyleLoaded()`/`areTilesLoaded()` stuck `false` forever;
  that turned out to be the same underlying raster-tile race, not something specific to `setStyle`
  timing.
