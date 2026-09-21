# S2 spike — raw measurements

atlas-0 Step 4, spike S2 ("First paint without WASM"). Measurements only — no verdict, no
recommendation (that's the later Opus review). Harness: `spikes/2/` (own `package.json`,
`vite.config.ts`, `playwright.config.ts`; Vite/TypeScript and `@playwright/test` resolve from the
root's `node_modules` via a relative path in `package.json`'s scripts — nothing installed twice).

## Fix round 1 (this revision)

The coordinator sent back four corrections after reading the first pass. All four are addressed
below; this section is a map of what changed and why, so the corrected numbers aren't read next to
stale ones without context.

1. **The timing gate was unfalsifiable.** `map.once("render", ...)` fires on the very first WebGL
   frame after `setStyle` — an empty background, before any network request for a tile has even
   been issued — so the old "map-first-frame ≈ 49.5ms" number could never exceed the 2.5s budget no
   matter how slow the real data actually was. Replaced with three marks computed inside
   `src/main.ts`'s own `render` handler, re-checked on every tick: **`firstDataFrame`** (both ocean
   probe points read back non-background via `gl.readPixels`), **`zonesPainted`**
   (`isSourceLoaded("zones")` AND a `queryRenderedFeatures` hit on the zones-line layer), and
   **`idle`** (MapLibre's own event). The gate now asserts `firstDataFrame <= 2500ms` with zero
   duckdb/wasm requests before it, and a new seeded fault (delay every S3/titiler response 3s) makes
   that gate genuinely fail — see below. The honest `firstDataFrame` numbers are reported as
   measured, not tuned to pass.
2. **The maplibre-gl 6.10 test used a default import, then a bare namespace import — never the
   ESM wiring v6 actually documents** (named/namespace import + an explicit worker URL via
   `setWorkerUrl()`). Redone below as a real 4-cell matrix (`vite dev` / `vite build`+preview ×
   with/without `optimizeDeps.exclude`) with that wiring.
3. **The npm audit summary was paraphrased, not quoted.** Replaced with the raw
   `npm audit --json` block plus the GitHub Security Advisory's own `vulnerable_version_range` /
   `first_patched_version` fields, and an explicit check of every 5.x release on npm against that
   range.
4. **Cross-origin bytes were reported as "unmeasurable."** They're not — the page's own Resource
   Timing API zeroes them out (no `Timing-Allow-Origin` from S3/titiler), but Chrome DevTools
   Protocol's `Network.loadingFinished.encodedDataLength` sees the real wire bytes regardless of
   CORS. `scripts/measure.mjs` now uses a CDP session for this. (A second, unrelated bug was found
   and fixed while building this: a titiler tile URL embeds the S3 COG url as a `?url=` query
   parameter, so classifying "is this an S3 request" by substring-matching the whole URL for
   `oceanmetrics.io-public` matched titiler requests too and silently zeroed out the titiler bucket.
   Fixed by classifying on `new URL(u).hostname` instead. The identical bug existed in the seeded
   S3/titiler-delay route matcher — it checked `url.hostname` against a string that's actually a
   *path* segment for S3's path-style URLs, so it silently never delayed S3 requests at all. Both
   are fixed in the committed files.)

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

## Timing table: FCP, firstDataFrame, zonesPainted, idle — cold profile, 9 runs

`scripts/measure.mjs`: a **fresh browser process** and a **fresh browser context** per run, HTTP
cache explicitly disabled via CDP (`Network.setCacheDisabled`) on top of the fresh-profile's already
having no disk cache. Navigates to `http://localhost:4312/` served by `vite preview`
(`maplibre-gl ^5.24.0`, `optimizeDeps.exclude: ["maplibre-gl"]` — the committed config).

```
run 1/9: FCP=16.0ms firstDataFrame=509.7ms zonesPainted=457.3ms idle=1051.1ms | before firstDataFrame: S3 6req/30036B, titiler 12req/12343B | before idle: S3 6req/30036B, titiler 28req/62354B
run 2/9: FCP=24.0ms firstDataFrame=499.1ms zonesPainted=462.9ms idle=1078.8ms | before firstDataFrame: S3 6req/30036B, titiler 14req/20000B | before idle: S3 6req/30036B, titiler 28req/62330B
run 3/9: FCP=24.0ms firstDataFrame=494.9ms zonesPainted=476.2ms idle=1033.3ms | before firstDataFrame: S3 6req/30036B, titiler 9req/18436B | before idle: S3 6req/30036B, titiler 28req/62353B
run 4/9: FCP=24.0ms firstDataFrame=467.8ms zonesPainted=429.4ms idle=1078.2ms | before firstDataFrame: S3 6req/30036B, titiler 12req/25420B | before idle: S3 6req/30036B, titiler 28req/62330B
run 5/9: FCP=28.0ms firstDataFrame=573.9ms zonesPainted=507.5ms idle=1080.6ms | before firstDataFrame: S3 6req/29916B, titiler 20req/35643B | before idle: S3 6req/29916B, titiler 28req/62353B
run 6/9: FCP=16.0ms firstDataFrame=492.2ms zonesPainted=456.3ms idle=1098.2ms | before firstDataFrame: S3 6req/29916B, titiler 10req/17757B | before idle: S3 6req/29916B, titiler 28req/62330B
run 7/9: FCP=24.0ms firstDataFrame=482.5ms zonesPainted=446.9ms idle=1076.6ms | before firstDataFrame: S3 6req/29916B, titiler 11req/18706B | before idle: S3 6req/29916B, titiler 28req/62353B
run 8/9: FCP=28.0ms firstDataFrame=502.0ms zonesPainted=432.8ms idle=1007.6ms | before firstDataFrame: S3 6req/29916B, titiler 15req/23251B | before idle: S3 6req/29916B, titiler 28req/62330B
run 9/9: FCP=28.0ms firstDataFrame=519.4ms zonesPainted=433.1ms idle=1084.6ms | before firstDataFrame: S3 6req/29916B, titiler 15req/20126B | before idle: S3 6req/29916B, titiler 28req/62354B

--- summary (N=9) ---
FCP: median=24.0ms range=[16.0, 28.0]ms
firstDataFrame: median=499.1ms range=[467.8, 573.9]ms  (gate: <= 2500ms)
zonesPainted: median=456.3ms range=[429.4, 507.5]ms
idle: median=1078.2ms range=[1007.6, 1098.2]ms

cross-origin bytes/requests, representative run (index 4):
  before firstDataFrame: S3 6 requests / 29916 bytes, titiler 20 requests / 35643 bytes
  before idle: S3 6 requests / 29916 bytes, titiler 28 requests / 62353 bytes
```

`firstDataFrame` here is the plan's actual "first paint" question — the first render tick at which
BOTH ocean probe points genuinely show non-background colour, not merely "a frame happened." This is
the honest number, measured, not tuned: median 499.1ms, worst observed 573.9ms, both comfortably
under the 2.5s budget on this machine/network. `zonesPainted` (vector zones layer with a rendered
feature) is reached slightly *before* `firstDataFrame` in every run — the pmtiles range request
settles faster than the raster tile fetches, so the vector boundary line is on-screen before the
score colour is. `idle` (all sources/placement settled) trails by another ~500-600ms as the
remaining tile requests (there are more titiler tiles than are needed for the two probe points)
finish.

Cross-origin bytes/requests are from CDP `Network.loadingFinished.encodedDataLength`, filtered to
requests whose `Network.requestWillBeSent`/`loadingFinished` CDP timestamp falls before the
`firstDataFrame`/`idle` mark (CDP timestamps are seconds since an arbitrary per-session epoch;
converted to "ms since the main-document request" and compared against the marks, which are
`performance.now()`-based — an approximation of the same instant, not exact to the millisecond, same
class of caveat as any cross-clock reconciliation). By `firstDataFrame`, titiler request counts vary
run to run (9-20) because `firstDataFrame` only requires the *two probe-point tiles* to have
rendered, but the harness's raster source issues many more z4 tiles across the viewport that keep
arriving concurrently; by `idle` every run converges on the same 28 titiler requests / ~62.3KB and 6
S3 requests / ~30KB (the zones pmtiles header + directory + one leaf-directory + tile-data fetches).

## Gates (`npm run e2e`, chromium only, against a real `vite build` + `vite preview`)

Blocks `**/*.wasm` and `**/duckdb*` via `page.route`; asserts `firstDataFrame <= 2.5s` with zero
duckdb/wasm requests before it (scoped to the cutoff, not just "ever"), 20 Program-Area rows, 7-8
flower petals, and painted pixels at the two ocean points (re-confirmed from the test side,
independent of the in-page `firstDataFrame` check).

Final run, verbatim (repeated 3x consecutively for reliability, all identical):

```
Running 4 tests using 1 worker

  ✓  1 [chromium] › e2e/s2.spike.spec.ts:21:3 › S2: first paint without WASM › shell paints the map + Program-Area table + flower; firstDataFrame gate (1.5s)
  ✘  2 [chromium] › e2e/s2.spike.spec.ts:108:3 › seeded fault: duckdb-named asset fetched before first frame › ?seed=duckdb-fetch trips the zero-duckdb-requests assertion (570ms)
  ✘  3 [chromium] › e2e/s2.spike.spec.ts:129:3 › seeded fault: unpainted canvas (style with no layers) › ?seed=blank-style trips the ocean-pixel-painted assertion (214ms)
  ✘  4 [chromium] › e2e/s2.spike.spec.ts:146:3 › seeded fault: S3 + titiler responses delayed 3s › 3s response delay on S3/titiler trips the firstDataFrame budget (3.6s)

  4 passed (7.3s)
```

(Tests 2-4 are wrapped in Playwright's `test.fail()` — an "✘" here means the assertion genuinely
failed, which is the REQUIRED/expected outcome per `test.fail()`, so the run is reported green
overall. This is the permanent, CI-safe form of the seeded-fault requirement, structurally the same
idea as the root's `tests/fixtures/size-budget-static-duckdb/` fixture proof.)

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

**(b) `?seed=blank-style` — must make the pixel probe FAIL:**

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

  136 |     for (const pt of OCEAN_POINTS) {
  137 |       const px = await readOceanPixel(page, pt);
> 138 |       expect(isPainted(px)).toBe(true);
      |                             ^
```

**(c) NEW — S3 + titiler responses delayed 3s — must make `firstDataFrame <= 2.5s` FAIL:**

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 2500
Received:    3507.7000000029802

  164 |
  165 |     // same assertion as the real gate above -- this is the one that must fail.
> 166 |     expect(firstDataFrameMs).toBeLessThanOrEqual(2500);
      |                              ^
```

All three seeded faults confirmed to fail the gate as required (`firstDataFrameMs` = 3507.7ms
against the 2500ms budget, a real ~3s delay plus ~500ms of normal overhead — matches the injected
delay honestly); `test.fail()` restored in the committed spec immediately after capturing this
output.

## maplibre-gl 6.10.0 vs `^5.24.0` under Vite 8

### Corrected 4-cell matrix: v6-documented ESM wiring

Wiring used for this matrix (not the default import, not a bare namespace import):
```ts
import { Map as MapLibreMap, addProtocol, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
setWorkerUrl(maplibreWorkerUrl);
```
(`maplibre-gl/dist/maplibre-gl-worker.mjs` is reachable via the package's own `"./dist/*": "./dist/*"`
export map. `Map` and `addProtocol`/`setWorkerUrl` are real named exports of `maplibre-gl.mjs` in
6.10.0 — confirmed via `node_modules/maplibre-gl/dist/maplibre-gl.d.ts`.)

| cell | starts? | pixel gate (`firstDataFrame` reached, both probe points painted) | notes |
|---|---|---|---|
| `vite dev`, WITH `optimizeDeps.exclude: ["maplibre-gl"]` | **yes** | **PASS** | marks: `firstDataFrame=1137.8ms`, `zonesPainted=763.9ms`, `idle=1928ms` (single run, not the 9-run cold table above) |
| `vite dev`, WITHOUT exclude | **yes** | **PASS** | marks: `firstDataFrame=986.5ms`, `zonesPainted=573.2ms`, `idle=1695.5ms` |
| `vite build` + `vite preview`, WITH exclude | **yes** | **PASS** | build succeeds; **the worker asset IS emitted this time**: `dist/assets/maplibre-gl-worker-CupLwWe3.mjs` (19.00KB raw, 6,090B gzip) — no 404, no `requestfailed`. This is the opposite of round 0's namespace-import-only attempt, where the worker file was silently dropped from the build. |
| `vite build` + `vite preview`, WITHOUT exclude | **yes** | **PASS** | identical build output to the WITH-exclude cell (`optimizeDeps.exclude` only affects `vite dev`'s pre-bundler, never `vite build`) |

All four cells: no `pageerror`, no uncaught exceptions; console noise was only the expected
z4-edge-tile 404s from titiler (out-of-bounds tiles, same as the `^5.24.0` runs, unrelated to
maplibre-gl version).

**gzip critical-path bytes (JS + CSS `index.html` loads statically — read from `dist/.vite/manifest.json`'s entry, `imports`/`css` only, never the worker, which the manifest lists under `assets`, not the JS module graph):**

| maplibre-gl | wiring | JS gzip | CSS gzip | critical-path total | worker (separate, not "critical path") |
|---|---|---|---|---|---|
| `6.10.0` | named import + `setWorkerUrl` | 282.15 KB | 10.71 KB | **292.86 KB** | 19.00 KB raw / 6.09 KB gzip |
| `^5.24.0` (`5.24.0`) | default import (committed) | 282.41 KB | 10.10 KB | **292.51 KB** | n/a (UMD build has no separate worker file — its worker is a Blob URL baked into the main bundle) |

Difference is ~0.35 KB either way at the critical-path level — essentially a wash; 6.10 additionally
ships a genuinely separate (lazy, not-in-the-static-graph) 19KB worker chunk that 5.24 doesn't need.

### Round 0's (superseded) default-import / bare-namespace-import findings, kept for the record

These used `import maplibregl from "maplibre-gl"` (default) or `import * as maplibregl from
"maplibre-gl"` (namespace, no explicit worker URL) — both still real, reproducible facts about
those specific wiring choices, just not the wiring v6 documents:

- `6.10.0`, `vite dev`, default import, WITH exclude:
  ```
  SyntaxError: The requested module '/node_modules/maplibre-gl/dist/maplibre-gl.mjs?v=4bd81e76' does not provide an export named 'default'
  ```
- `6.10.0`, `vite dev`, default import, WITHOUT exclude (same error, from the pre-bundled path —
  proves this is not an optimizer artifact, 6.10.0 genuinely has no default export):
  ```
  SyntaxError: The requested module '/node_modules/.vite/deps/maplibre-gl.js?v=298f22f0' does not provide an export named 'default'
  ```
  Confirmed directly in `maplibre-gl.mjs` (6.10.0): the file's `export{}` statement re-exports `Mm
  as Map` — `Map` is a **named** export only; there is no `export default` anywhere in the file.
- `6.10.0`, `vite build`, default import, WITH exclude (hard build failure, Rolldown):
  ```
  [MISSING_EXPORT] "default" is not exported by "node_modules/maplibre-gl/dist/maplibre-gl.mjs".
  ```
  (Vite 8's production bundler for this project is **Rolldown**, not Rollup — visible both in this
  error's `node_modules/rolldown/...` stack path and in the build's own warning text,
  `build.rolldownOptions.output.codeSplitting`.)
- `6.10.0`, bare namespace import (`import * as maplibregl`, no `setWorkerUrl`): `vite dev` worked
  in both exclude states; `vite build` succeeded; but `vite preview` of that build 404'd on
  `/assets/maplibre-gl-worker.mjs` (`page.on("requestfailed")`, `net::ERR_FAILED`) — the worker file
  was never emitted to `dist/assets/` at all. This is exactly what the explicit `?url` import +
  `setWorkerUrl()` wiring (the corrected matrix above) fixes.
- `5.24.0`, `vite dev`, default import, WITH exclude (fails — raw UMD file served directly as ESM
  without CJS interop, because exclude skips Vite's optimizer/CJS-to-ESM conversion step):
  ```
  SyntaxError: The requested module '/node_modules/maplibre-gl/dist/maplibre-gl.js?v=26d18af1' does not provide an export named 'default'
  ```
  Confirmed `maplibre-gl.js` (5.24.0) is a UMD/AMD bundle (ends `return maplibregl$1; }));`);
  package.json says `"type": "module"` but the file itself has no `export` statements — a real
  mismatch in the published package, not a Vite bug.
- `5.24.0`, `vite dev`, default import, WITHOUT exclude: works fine — Vite's optimizer performs the
  CJS/UMD→ESM interop that `exclude` skips.
- `5.24.0`, `vite build` + `vite preview`, default import, WITH exclude: works — production builds
  always run the full module graph through Rolldown regardless of the dev-only
  `optimizeDeps.exclude` list, so the UMD-as-ESM mismatch that breaks `vite dev` never appears in
  the build.

## npm audit — precise advisory facts

`npm audit --json` (package.json/lockfile has `maplibre-gl: ^5.24.0` resolved to `5.24.0`), exact
output:

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "maplibre-gl": {
      "name": "maplibre-gl",
      "severity": "critical",
      "isDirect": true,
      "via": [
        {
          "source": 1193680,
          "name": "maplibre-gl",
          "dependency": "maplibre-gl",
          "title": "MapLibre GL JS: XSS Sanitizer Bypass in DOM.sanitize() via Live NamedNodeMap Removal Skip",
          "url": "https://github.com/advisories/GHSA-jrc7-96c5-q579",
          "severity": "critical",
          "cwe": ["CWE-79"],
          "cvss": { "score": 10, "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N" },
          "range": "<=6.4.0"
        }
      ],
      "effects": [],
      "range": "<=6.4.0",
      "nodes": ["node_modules/maplibre-gl"],
      "fixAvailable": { "name": "maplibre-gl", "version": "6.10.0", "isSemVerMajor": true }
    }
  },
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 1, "total": 1 },
    "dependencies": { "prod": 30, "dev": 0, "optional": 0, "peer": 0, "peerOptional": 0, "total": 29 }
  }
}
```

Cross-checked against the GitHub Security Advisory itself (`GET
api.github.com/advisories/GHSA-jrc7-96c5-q579`, not just npm's summary of it):

- **Advisory ID**: `GHSA-jrc7-96c5-q579` (CVE-2026-85061)
- **Severity**: critical, CVSS v3.1 score **10.0** (`AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N`)
- **Vulnerable version range**: `<= 6.4.0` (GitHub's own `vulnerable_version_range` field, exact
  string — matches npm's `range`)
- **First patched version**: **`6.4.1`** (GitHub's own `first_patched_version` field). Note this is
  *not* the same as npm's `fixAvailable.version` (`6.10.0`) — that field is "the version `npm audit
  fix` would install" (the newest satisfying the declared range), not the first patched release;
  the true first fix landed at 6.4.1, per the advisory text ("Please upgrade to `maplibre-gl`
  version **6.4.1** (or latest)").

**Every 5.x release on npm, checked against the `<= 6.4.0` range:**
```
5.0.0, 5.0.1, 5.1.0, 5.1.1, 5.2.0, 5.3.0, 5.3.1, 5.4.0, 5.5.0, 5.6.0, 5.6.1, 5.6.2, 5.7.0, 5.7.1,
5.7.2, 5.7.3, 5.8.0, 5.9.0, 5.10.0, 5.11.0, 5.12.0, 5.13.0, 5.14.0, 5.15.0, 5.16.0, 5.17.0, 5.18.0,
5.19.0, 5.20.0, 5.20.1, 5.20.2, 5.21.0, 5.21.1, 5.22.0, 5.23.0, 5.24.0
```
Newest 5.x on npm: **`5.24.0`** (our pin). Every one of these 35 releases has a major.minor.patch
strictly less than `6.4.0`, so **every single 5.x release ever published is inside the vulnerable
`<=6.4.0` range — none is outside it.** There is no 5.x version that resolves this advisory; the
first patched release is 6.4.1 (a 6.x release).

## Other raw findings from building this harness

- **`preserveDrawingBuffer` moved under `canvasContextAttributes`** in maplibre-gl 5.x/6.x
  (`node_modules/maplibre-gl/dist/maplibre-gl.d.ts`: `canvasContextAttributes?:
  WebGLContextAttributesWithType`). A bare top-level `preserveDrawingBuffer: true` on the `Map`
  constructor (the shape the CalCOFI-era code/plan text describes) is silently accepted and ignored.
  Symptom: the map visibly renders correctly, but any out-of-process `gl.readPixels()` call
  (Playwright's `page.evaluate`, run on a later JS turn) reads back `(0,0,0,0)` at every point,
  including the flat background layer, because the browser clears the WebGL backbuffer after each
  compositor present. Fixed by nesting it: `canvasContextAttributes: { preserveDrawingBuffer: true }`.
- **Raster tile loading was non-deterministic** under headless Chromium+swiftshader in `vite
  preview` before an explicit `map.resize()` was added right after construction: across repeated
  runs of an otherwise-identical build, the titiler raster source's tile requests sometimes fired
  promptly and sometimes never fired at all within a 20s timeout (the vector/pmtiles zones source
  loaded reliably every time in the same runs). `map.resize()` immediately after construction made
  every subsequent run reliable — confirmed clean across dozens of `npm run e2e` and
  `scripts/measure.mjs` runs in this round.
- **URL-substring host matching is a real footgun with this data shape, found twice**: a titiler
  tile request embeds the S3 COG url as a `?url=` query parameter, so
  `wholeUrl.includes("oceanmetrics.io-public")` matches titiler requests too (classifying them as
  S3), and conversely `url.hostname` for an S3 path-style URL is `s3.us-east-1.amazonaws.com` —
  `"oceanmetrics.io-public"` never appears in the *hostname*, only the *path* — so a route matcher
  checking `url.hostname` against that string never matches S3 at all. Both bugs were caught while
  building fix round 1 (the byte classifier in `scripts/measure.mjs`, and the 3s-delay seeded
  fault's route matcher in `e2e/s2.spike.spec.ts`) and fixed by using `new URL(u).hostname`
  everywhere instead of substring matching on the full URL.
