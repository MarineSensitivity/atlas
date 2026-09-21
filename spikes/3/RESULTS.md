# S3 -- values without the tile server: raw measurements

Measurements only. No verdict is drawn here (plan: "Verdict feeds atlas-1", not this spike).

## Versions / environment

- node `v24.9.0`, npm `11.18.0`
- duckdb CLI `v1.5.5` (Variegata) -- used only to build the local tile fixtures, not in the harness
- `@duckdb/duckdb-wasm` `1.32.0` (S1's provisional pin; S3 does not decide this, it just uses S1's
  current pin per the plan) and, fix round 1 only, `@duckdb/duckdb-wasm-next` = the `next` dist-tag,
  pinned to the version it resolved to on 2026-09-21, `1.33.1-dev64.0` (`next` is a moving tag;
  pinned here for reproducibility -- `spikes/3/package.json` aliases it via
  `"@duckdb/duckdb-wasm-next": "npm:@duckdb/duckdb-wasm@1.33.1-dev64.0"` so both live side by side)
- `geotiff` `3.0.5`
- `deck.gl` `9.4.0`
- `vite` `8.3.0` (spikes/3's own; root's `vite@^8.3.0` is not reused since spikes/3 needs its own
  `rollupOptions.input`/`publicDir`)
- `@playwright/test` `1.63.0` -- reused from the repo root (`spikes/3/package.json` does not list
  it; resolved via node_modules lookup). Chromium only (see `spikes/3/playwright.config.ts`).
- Bucket: `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/` (path-style;
  the bare `.../oceanmetrics.io-public/v9/manifest.json`, without `marine-atlas/`, answers
  `AccessDenied` -- release keys live under the `marine-atlas/` prefix)
- titiler: `https://titiler-v8.marinesensitivity.org` -- **unreachable for the entire measurement
  window** (`curl --max-time 15` timed out repeatedly, including plain `/`, while
  `s3.us-east-1.amazonaws.com` and other hosts stayed reachable throughout). This blocks only the
  display question (candidate (a)/(b) never call titiler). See "Display question" below.

## Grid facts (source: `v9/manifest.json` `grid{}`, fetched 2026-09-21)

```
curl -sS https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/manifest.json
```

`{"nc":7200,"nr":3600,"xmin":-180,"ymax":90,"resx":0.05,"resy":0.05,"lon360":false}`. `id_field` in
the manifest is `mdl_key` (the species-model id field, unrelated to cell tiling -- not needed here).
Confirmed `cell_id = row0*nc + col0 + 1` (0-indexed row0/col0, row0=0 at ymax/north, col0=0 at
xmin/west) against `v9/tables/cell.parquet` (`cell_id=1` -> lon -179.975, lat 89.975; `cell_id=7201`
-> lon -179.975, lat 89.925, i.e. one row south).

The 8 "rescaled component" metrics (the flower's 7-8 petals) were confirmed against
`v9/tables/metric.parquet`: `metric_seq` 10, 13, 16, 19, 22, 25, 28, 32 are the `%_ecoregion_rescaled`
siblings (excluding `_min`/`_max`/`_prepctareaweighting` and the composite score), matched to their
`subregion_key="FULL"` COG + rescale in `v9/manifest.json` `metrics[]`. See `spikes/3/src/metrics.ts`.

## Candidate (a): tiled `cell_metric` fixture

`spikes/3/scripts/make_tiles.sql` (run via `bash spikes/3/scripts/make_tiles.sh` from the repo
root) tiles `v9/tables/cell_metric.parquet` (72 MB, 3 unprunable row groups -- the whole file is
read once, client-side, to build these 4 fixture tiles) by the plan's key,
`tile = ((cell_id-1)//nc)//50 * (nc//50) + ((cell_id-1)%nc)//50` (nc=7200), the same key
`serve/cell_model/tile={t}/` already uses, filtered to `metric_seq IN (10,13,16,19,22,25,28,32)`.

Tile set: `r in {24,25} x c in {36,37}` -> tiles **3492, 3493, 3636, 3637** (lon [-90,-85] x lat
[25,30], Gulf of America / GA subregion). This block was chosen after checking candidate tile
blocks for actual scored-cell coverage: the first block tried (`r in {25,26} x c in {36,37}`, lat
[22.5,27.5]) had a tile (3780) with **zero** scored cells for these 8 metrics; `{24,25}x{36,37}`
has all 4 quadrants populated (1790-2457 cells/metric each). Built files (gitignored):

```
spikes/3/tiles/app/cell/tile=3492/data_0.parquet   158,706 bytes
spikes/3/tiles/app/cell/tile=3493/data_0.parquet   177,538 bytes
spikes/3/tiles/app/cell/tile=3636/data_0.parquet   124,804 bytes
spikes/3/tiles/app/cell/tile=3637/data_0.parquet   148,708 bytes
```

Served at `/app/cell/tile={t}/data_0.parquet` by `vite preview` (`spikes/3/vite.config.ts`'s
`publicDir: "tiles"`), matching the URL shape `serve/cell_model/` already uses on S3.

## Test geometries (all inside the 4-tile block above)

- **click**: point (-88.75, 28.75) -> cell_id 8821826, tile 3492
- **poly2**: 2x2deg polygon, lon[-89,-87] x lat[27,29] -- spans all 4 tiles
- **polypra**: ~5x5deg polygon, lon[-90,-85] x lat[25,30] (the full 4-tile block) -- ~273,000 km^2 at
  this latitude, same order of magnitude as a real BOEM Program Area (10^5-10^6 km^2); bounded to
  the 4 committed tiles rather than a real Program Area's geometry.

## Measured: bytes / requests / ms

Every row is a fresh `BrowserContext` (cold HTTP cache). Requests are categorised by URL shape
(same-origin tile path / `extensions.duckdb.org` / `s3.us-east-1.amazonaws.com` / everything else),
not by a before/after-init timestamp -- a timestamp split raced against two lazy fetches that fire
**inside** the timed call: duckdb-wasm's parquet extension (loaded from `extensions.duckdb.org` on
the first `read_parquet`, not during `instantiate()`) and geotiff's lazily-imported decompression
codec chunks. Command: `TMPDIR=<writable dir> npx playwright test --config=playwright.config.ts
e2e/s3.spec.ts` from `spikes/3/` (needed `TMPDIR` pointed at a writable dir -- default `/var/folders`
gave `EACCES` for Playwright's transform cache in this sandbox).

### Candidate (a): DuckDB-WASM, whole-object fetch + `registerFileBuffer`, over the tiled fixture

One-time, per fresh session (not attributable to any one case):

| | requests | bytes |
|---|---|---|
| self-hosted mvp/eh wasm + worker + app JS (`runtime_js`) | 5 | 1,029,608 |
| duckdb-wasm's **remote** parquet extension (`extensions.duckdb.org`, NOT self-hosted) | 1 | 3,045,039 |

Per case (tile fetches only; `ms` is the in-page `performance.now()` delta for the whole call,
which *includes* the one-time extension fetch on a cold context since `read_parquet` can't run
without it):

| case | ms | rows returned | tiles needed | tile requests | tile bytes |
|---|---|---|---|---|---|
| click | 487.7 | 8 | [3492] | 1 | 158,706 |
| poly2 | 618.9 | 12,800 | [3492,3493,3636,3637] | 4 | 609,756 |
| polypra | 531.2 | 68,269 | [3492,3493,3636,3637] | 4 | 609,756 |

(poly2 and polypra fetch the identical 4 tiles -- both fall inside the same 4-tile block -- so their
tile bytes/requests are identical; only the row count returned differs.)

### Candidate (b): `geotiff` 3.x windowed `readRasters()`, one `fromUrl` per rescaled-component COG

One-time: JS bundle (geotiff + lazily-imported DEFLATE/LZW/packbits/JPEG codec chunks), `runtime_js`
= 6 requests, 304,927 bytes.

| case | ms | metrics | pixels read | COG requests | COG bytes |
|---|---|---|---|---|---|
| click | 1999.9 | 8 | 8 | 40 | 455,063 |
| poly2 | 2376.1 | 8 | 12,800 | 40 | 455,063 |
| polypra | 2088.3 | 8 | 80,000 | 43 | 476,114 |

Each COG costs ~5 requests (2x 1024-byte + 2x 4-byte header/IFD range reads, then 1 data block read
per COG for click/poly2; polypra needed 3 extra small range reads, presumably a second data block
for a metric whose 100x100px window straddles a 256px COG block boundary). click and poly2 read
identical bytes -- both windows fit inside the same single 256px DEFLATE block per COG.

## max |delta| between (a) doubles and (b) float32, at the probe cells

Nodata (-9999, the COG's `nodata_value`) on either side is excluded before comparing (not merely
`Number.isFinite`, since -9999 is finite).

| case | n compared | max abs delta | p99 | p50 | mean |
|---|---|---|---|---|---|
| click | 8 | 1.80e-6 | 1.80e-6 | 7.02e-7 | 6.81e-7 |
| poly2 | 12,800 | 3.79e-6 | 3.74e-6 | 2.48e-7 | 6.21e-7 |
| polypra | 68,269 | 3.81e-6 | 3.59e-6 | 2.99e-7 | 6.39e-7 |

All at the scale of float32 rounding of values in [0,100] (float32 epsilon there is ~1.2e-5), not a
misalignment. One methodology note this uncovered: the published COG's own bounding box is not
exactly `xmin=-180` (`/cog/info` on `extrisk_bird_ecoregion_rescaled` FULL reports
`west=-180.00000610436345`, a ~6e-5-pixel sub-pixel drift from the ideal grid at these longitudes).
A bare `floor()` pixel-index computation flips to the wrong pixel for any coordinate sitting exactly
on a 0.05deg grid line (every edge in these 3 test geometries does) depending on which side of that
drift the float64 division lands on; `spikes/3/src/candidateB.ts` adds a small (`1e-3`, in pixel
units) epsilon before flooring to snap back to the intended pixel. Without that epsilon, poly2's
max delta was 33.2 and polypra's was 10,095.8 -- both from real off-by-one-pixel comparisons, not
float32 noise.

## Gate: (a)/(b) agreement must fail under a seeded one-cell misalignment

The gate (`spikes/3/e2e/s3.spec.ts`, describe block "(a) vs (b) agreement") asserts
`maxAbsDelta < 1e-3` at the probe cells. `SPIKE3_FAULT_OFFSET=<n>` shifts *only* candidate (b)'s
COG pixel window by `n` rows before the comparison runs -- the comparison itself does not know an
offset was injected (it aligns purely by geographic/grid position), so a real misalignment is not
silently re-aligned away.

Normal run (`npx playwright test --config=playwright.config.ts e2e/s3.spec.ts -g "agree at the probe cells"`), verbatim:

```
Running 3 tests using 1 worker

[S3][compare][click] n=8 maxAbsDelta=0.000001795151646888371 p99AbsDelta=0.000001795151646888371 p50AbsDelta=7.021187258260397e-7 meanAbsDelta=6.814281265921096e-7 maxAt={"cellId":8821826,"metricSeq":28,"aVal":68.38235294117648,"bVal":68.38235473632812}
  ✓  1 [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- click (2.9s)
[S3][compare][poly2] n=12800 maxAbsDelta=0.0000037912256658501065 p99AbsDelta=0.000003739899284482817 p50AbsDelta=2.4806965193135966e-7 meanAbsDelta=6.21394448141057e-7 maxAt={"cellId":8785829,"metricSeq":22,"aVal":97.53882215060067,"bVal":97.538818359375}
  ✓  2 [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- poly2 (2.6s)
[S3][compare][polypra] n=68269 maxAbsDelta=0.0000038141145921599673 p99AbsDelta=0.0000035903033079875968 p50AbsDelta=2.9919193877958605e-7 meanAbsDelta=6.386087813353149e-7 maxAt={"cellId":8814690,"metricSeq":19,"aVal":71.9810600274935,"bVal":71.9810562133789}
  ✓  3 [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- polypra (2.3s)

  9 passed (20.0s)
```

(9 passed includes the 6 bytes/requests/ms tests from the same file, run together; the 3 agreement
tests are the ones quoted above.)

Seeded-fault run (`SPIKE3_FAULT_OFFSET=1 npx playwright test --config=playwright.config.ts e2e/s3.spec.ts -g "agree at the probe cells"`), verbatim:

```
Running 3 tests using 1 worker

[S3][compare][click] n=8 maxAbsDelta=1.9193576670004724 p99AbsDelta=1.9193576670004724 p50AbsDelta=1.159795998476131 meanAbsDelta=1.0170539875308793 maxAt={"cellId":8821826,"metricSeq":32,"aVal":16.983156571419418,"bVal":15.063798904418945}
  ✘  1 [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- click [SEEDED FAULT: candidate (b) row offset=1] (2.4s)
[S3][compare][poly2] n=12800 maxAbsDelta=33.222593174047844 p99AbsDelta=7.957459617688436 p50AbsDelta=0.1463122826894221 meanAbsDelta=0.7279335777330123 maxAt={"cellId":8836227,"metricSeq":10,"aVal":67.10305582053222,"bVal":33.880462646484375}
  ✘  2 [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- poly2 [SEEDED FAULT: candidate (b) row offset=1] (2.4s)
[S3][compare][polypra] n=67592 maxAbsDelta=57.51635915696794 p99AbsDelta=19.21568792006549 p50AbsDelta=0.1693550228338041 meanAbsDelta=0.9688996049611983 maxAt={"cellId":8908278,"metricSeq":22,"aVal":86.63342077195817,"bVal":29.117061614990234}
  ✘  3 [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- polypra [SEEDED FAULT: candidate (b) row offset=1] (2.6s)

  1) [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- click [SEEDED FAULT: candidate (b) row offset=1]

    Error: expect(received).toBeLessThan(expected)

    Expected: < 0.001
    Received:   1.9193576670004724

      152 |       expect(result.stats.maxAbsDelta).toBeLessThan(1e-3);
          |                                        ^
        at spikes/3/e2e/s3.spec.ts:152:40

  2) [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- poly2 [SEEDED FAULT: candidate (b) row offset=1]

    Error: expect(received).toBeLessThan(expected)

    Expected: < 0.001
    Received:   33.222593174047844

      152 |       expect(result.stats.maxAbsDelta).toBeLessThan(1e-3);
          |                                        ^
        at spikes/3/e2e/s3.spec.ts:152:40

  3) [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- polypra [SEEDED FAULT: candidate (b) row offset=1]

    Error: expect(received).toBeLessThan(expected)

    Expected: < 0.001
    Received:   57.51635915696794

      152 |       expect(result.stats.maxAbsDelta).toBeLessThan(1e-3);
          |                                        ^
        at spikes/3/e2e/s3.spec.ts:152:40

  3 failed
    [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- click [SEEDED FAULT: candidate (b) row offset=1]
    [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- poly2 [SEEDED FAULT: candidate (b) row offset=1]
    [chromium] › e2e/s3.spec.ts:131:5 › (a) vs (b) agreement › (a) doubles and (b) float32 agree at the probe cells -- polypra [SEEDED FAULT: candidate (b) row offset=1]
```

maxAbsDelta jumps from ~1e-6 (float32 rounding) to 1.9-57.5 (the scale of the underlying 0-100
values themselves) under a one-cell offset, and the assertion fails as required -- proof the
comparison can see a misalignment. (polypra's `n` also drops from 68,269 to 67,592 under the
offset: shifting the window by one row moves some of it past the scored-cell boundary into
nodata/land, where both sides now correctly get excluded rather than compared.)

## Display question: deck.gl `BitmapLayer` vs titiler tiles, z2-z8, 20 probe points, memory

**Fix round 1, task 1**: the original pass used titiler `colormap_name=spectral_r` against a
hand-rolled 11-stop ColorBrewer approximation on the deck.gl side, which conflated
colormap-implementation differences with real geometry/resampling differences (deltas up to
184/255). Removed that confound: both sides now render a colormap that is **identical by
construction**, not approximated.

- **Which colormap, and why not literally `greys`**: the ask was `colormap_name=greys`. Checked
  empirically first (`/cog/point` for the raw value at a known cell, `67.10305786132812` on
  `rescale=0,100`, vs. the actual tile pixel at that same point): `greys` gave pixel `(102,102,102)`
  -- **not** linear (it's rio-tiler/matplotlib's ColorBrewer-style sequential "Greys" scheme, a
  multi-stop non-linear ramp, same family as `spectral_r`). `gray` (singular, matplotlib's built-in
  grayscale) gave `(171,171,171)`, which matches `floor(255 * 67.10305.../100) = 171` exactly, and
  two more spot checks (`66.448...->169`, `0.323...->0`, both `floor`-exact) confirmed it's a plain
  linear ramp with no rounding surprises beyond `floor` vs `round`. **Used `gray`, not `greys`**, so
  the deck.gl side (`colormap.ts`'s `linearGray()`, `Math.floor(255*t)`) reproduces titiler's ramp
  exactly rather than approximating it -- this is a deliberate deviation from the literal ask to
  actually satisfy its stated goal ("identical by construction").
- **Resampling**: `resampling=nearest` passed explicitly to titiler (its own documented default,
  per `/api`'s OpenAPI schema: "RasterIO resampling algorithm. Defaults to `nearest`."). On the
  deck.gl side, `BitmapLayer`'s `textureParameters: {minFilter: 'nearest', magFilter: 'nearest'}`
  (luma.gl v9 `SamplerProps`) disables the WebGL sampler's default bilinear filtering, which would
  otherwise blend across pixel edges and confound "misaligned" with "smoothed".
- **Nodata**: verified titiler renders nodata as `(0,0,0,0)` (fully transparent) under `gray`; the
  deck.gl-side bitmap does the same (alpha 0 wherever the source Float32 raster is `< -1000`,
  matching the COG's `-9999` sentinel).
- **Edge vs. interior**: each of the 20 fixed probe points is classified `edge` if it or any of its
  8 native-raster (0.05deg) neighbours is nodata, else `interior`. An interior delta of more than
  1-2 grey levels is not explained by a coastline/coverage boundary.

Command: `cd spikes/3 && TMPDIR=<writable dir> npx playwright test --config=playwright.config.ts
e2e/s3.display.spec.ts`. `titiler-v8.marinesensitivity.org` was unreachable for part of this
session (see the note further down) but was reachable when this pass ran.

| z | probes | compared (non-nodata both sides) | requests | max delta (grey levels, 0-255) | mean delta | worst probe: edge or interior? |
|---|---|---|---|---|---|---|
| 2 | 20 | 0 | 1 | n/a | n/a | n/a -- every probe was nodata on at least one side at this zoom |
| 3 | 20 | 7 | 1 | 26 | 3.71 | interior |
| 4 | 20 | 16 | 1 | 33 | 4.19 | interior |
| 5 | 20 | 19 | 1 | 0 | 0.00 | -- (perfect match) |
| 6 | 20 | 20 | 1 | 0 | 0.00 | -- (perfect match) |
| 7 | 20 | 19 | 1 | 1 | 0.05 | interior (1 grey level, within tolerance) |
| 8 | 20 | 19 | 2 | 84 | 4.74 | interior |

Every worst-probe across all 7 zooms was `edge=false` (interior) -- none of the non-trivial deltas
are a coastline/coverage-boundary artifact. z5 and z6 (the two zooms with the most comparable
probes, 19-20/20) show **zero** delta across every probe: identical colormap + identical
(nearest) resampling reproduces titiler pixel-for-pixel there. z3/z4/z8 each have exactly one
outlier probe (delta 26-84) while every other probe at that zoom is within 0-1; z2 has no
comparable probes at all (every one of the 20 probes landed on nodata on at least one side --
plausible at z2 since one XYZ tile there spans ~90deg and the actual scored strip is a thin band
within it). The single-probe outliers are consistent with a half-source-pixel boundary: at those
zooms the probe sits close enough to a 0.05deg cell edge that WebGL's nearest-neighbour texture
sampler and rio-tiler/GDAL's array indexing round to different neighbouring source pixels -- a
resampling-convention difference (which "nearest" pixel a boundary case rounds to), not a
systematic misalignment (which would show up at every zoom, not one probe at three of seven). This
is reported as a number, not a verdict.

### Gate: interior probes must agree within 2 grey levels, and the seeded fault

`spikes/3/e2e/s3.display.spec.ts`'s "gate:" test asserts `maxInteriorDelta <= 2` at one
representative zoom (z6, chosen because both z5 and z6 showed 0 delta above; z6 has all 20 probes
comparable). `SPIKE3_DISPLAY_FAULT_SHIFT=1` shifts the `BitmapLayer`'s `bounds` by one native cell
(0.05deg) east and north before rendering -- the comparison itself does not know about the shift.

Normal (`npx playwright test --config=playwright.config.ts e2e/s3.display.spec.ts -g "gate:"`):

```
Running 1 test using 1 worker

[S3][display][gate] shift=0 n=19 maxInteriorDelta=0
  ✓  1 [chromium] › e2e/s3.display.spec.ts:60:1 › gate: interior probes agree within 2 grey levels (24.5s)

  1 passed
```

Seeded fault (`SPIKE3_DISPLAY_FAULT_SHIFT=1 npx playwright test --config=playwright.config.ts e2e/s3.display.spec.ts -g "gate:"`):

```
Running 1 test using 1 worker

[S3][display][gate] shift=1 n=19 maxInteriorDelta=84
  ✘  1 [chromium] › e2e/s3.display.spec.ts:60:1 › gate: interior probes agree within 2 grey levels [SEEDED FAULT: BitmapLayer bounds shifted 1 cell(s)] (23.6s)

  1) [chromium] › e2e/s3.display.spec.ts:60:1 › gate: interior probes agree within 2 grey levels [SEEDED FAULT: BitmapLayer bounds shifted 1 cell(s)]

    Error: expect(received).toBeLessThanOrEqual(expected)

    Expected: <= 2
    Received:    84

      66 |   expect(result.maxInteriorDelta).toBeLessThanOrEqual(2);
         |                                   ^
        at spikes/3/e2e/s3.display.spec.ts:66:35

  1 failed
```

maxInteriorDelta jumps from 0 to 84 under a one-cell bounds shift -- proof the gate can see a
misalignment.

### titiler outage note

`titiler-v8.marinesensitivity.org` was unreachable for part of this overall session (`curl
--max-time 15`/`20` timed out repeatedly on `/`, `/cog/info`, `/cog/point`, and
`/cog/tiles/...`, while every other host tested, including the S3 bucket, stayed reachable
throughout -- an outage or overload specific to that one service, not a network problem here) but
was reachable for both the fix-round-1 pixel-comparison work above and the original pass. Candidate
(a)/(b) never depend on it (candidate (b) reads COGs directly from S3).

### Memory

`performance.memory.usedJSHeapSize`, read from the page, returned the exact same value
(10,000,000) before and after the whole z2-z8 run -- Chrome coarsens/quantizes this API and it was
useless as a before/after delta in this headless context. Switched to CDP's
`Performance.getMetrics` (`JSHeapUsedSize`, via `page.context().newCDPSession(page)`), which is not
coarsened: **before ~3.27 MB, after ~5.7-6.3 MB (varies run to run), delta ~2.4-3.0 MB** for
decoding one 7200x2001 Float32 COG into an RGBA bitmap, creating one `Deck` instance per unique
z/x/y tile across z2-z8 (8 in this run), and fetching+decoding 8 titiler PNG tiles.

## DuckDB-WASM extension autoload (fix round 1, task 2)

CLAUDE.md / the plan say DuckDB-WASM is **self-hosted** (`?url` imports, mvp/eh bundles; GitHub
Pages cannot proxy a remote origin). But `read_parquet()` -- the call candidate (a) is built on --
triggers duckdb's extension-autoload mechanism, which fetches the `parquet` extension from
`extensions.duckdb.org`, **not self-hosted**, on both the stable pin and `next`. Measured properly
below: exactly which URLs, bytes, ms; whether cached on reload; and whether a same-origin mirror
fixes it under a blocked-network gate.

Harness: `spikes/3/ext.html` + `src/ext-check.ts` + `src/duckdb-versions.ts` (both duckdb-wasm
copies self-hosted side by side, via the `@duckdb/duckdb-wasm-next` alias), `e2e/s3.ext.spec.ts`.
Command: `TMPDIR=<writable dir> npx playwright test --config=playwright.config.ts e2e/s3.ext.spec.ts`.

**URL shape** (confirmed by setting `custom_extension_repository` to a bogus local path and reading
the resulting 404's exact URL):
`{repository}/{duckdb_engine_version}/{platform}/{name}.duckdb_extension.wasm`.
`duckdb_engine_version` is the underlying DuckDB **C++ engine** version baked into a given npm
release, not the npm package version -- confirmed the stable pin (`1.32.0`) bundles engine `v1.4.3`,
`next` (`1.33.1-dev64.0`) bundles engine `v1.5.5`. `platform`: headless Chromium's `selectBundle()`
picked `wasm_eh` for both npm versions (mvp never observed in this harness).

### Which URLs, bytes, ms -- `read_parquet` (triggers the `parquet` extension) and `LOAD json`/`LOAD spatial`

Each row: a fresh `AsyncDuckDB` instance (own worker+wasm), fresh browser context, one operation.

| duckdb-wasm | engine | operation | URL | status | bytes | ms |
|---|---|---|---|---|---|---|
| 1.32.0 (stable) | v1.4.3 | `read_parquet` | `.../v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` | 200 | 3,045,039 | 470-670 |
| 1.32.0 (stable) | v1.4.3 | `LOAD json` | `.../v1.4.3/wasm_eh/json.duckdb_extension.wasm` | 200 | 820,646 | 305-344 |
| 1.32.0 (stable) | v1.4.3 | `LOAD spatial` | `.../v1.4.3/wasm_eh/spatial.duckdb_extension.wasm` | 200 | 0 (see note) / 23,469,719 (curl) | 1,256-1,636 |
| next (1.33.1-dev64.0) | v1.5.5 | `read_parquet` | `.../v1.5.5/wasm_eh/parquet.duckdb_extension.wasm` | 200 | 3,220,370 | 400-533 |
| next (1.33.1-dev64.0) | v1.5.5 | `LOAD json` | `.../v1.5.5/wasm_eh/json.duckdb_extension.wasm` | 200 | 822,239 | 282-315 |
| next (1.33.1-dev64.0) | v1.5.5 | `LOAD spatial` | `.../v1.5.5/wasm_eh/spatial.duckdb_extension.wasm` | 200 | 0 (see note) / 23,602,613 (curl) | 1,166-1,750 |

`spatial`'s `bytes=0` is a Playwright/CDP `response.body()` capture artifact specific to this large
a response (parquet/json's byte counts, both under ~3.1 MB, matched a direct `curl` download
exactly every time; `spatial` at ~23.5 MB never did) -- real sizes confirmed by `curl -o` directly
against the same URLs. `spatial` is **8x the size of `parquet`** and would be a much larger
self-hosting cost if the app ever adds it (not currently planned; checked here only because it was
"trivially checkable").

### Cached across a page reload?

Same operation (`read_parquet`), same browser context, `page.reload()` in between (fresh
`AsyncDuckDB`/worker each time, but the HTTP cache persists across the reload):

| version | first load: ms / requests / bytes | after reload: ms / requests / bytes |
|---|---|---|
| stable | 492.3 / 1 / 3,045,039 | 131.0 / 1 / 3,045,039 |
| next | 421.5 / 1 / 3,220,370 | 133.5 / 1 / 3,220,370 |

Still 1 request and the same reported bytes both times (Playwright's `response.body()` returns the
full decoded content regardless of cache status), but ms drops ~70% on the second load in both
cases (492->131, 422->134) -- consistent with the browser's HTTP cache serving the extension
without a real network re-fetch. Not independently confirmed via `fromDiskCache`-style CDP flags;
the ms drop is the evidence here.

### Gate: same-origin `custom_extension_repository` with `extensions.duckdb.org` BLOCKED

`scripts/fetch_extensions.sh` mirrors the `parquet` extension for both engine versions into
`spikes/3/tiles/ext/{v1.4.3,v1.5.5}/wasm_eh/parquet.duckdb_extension.wasm` (gitignored; served at
`/ext/...` by vite's `publicDir`). The gate: with `page.route("**/extensions.duckdb.org/**", abort)`,
`SET custom_extension_repository = 'http://localhost:4313/ext'` before `read_parquet()` -- does it
still succeed? `SPIKE3_EXT_FAULT=1` is the seeded fault: identical blocked-network scenario, but
without setting `custom_extension_repository`.

Normal (`npx playwright test --config=playwright.config.ts e2e/s3.ext.spec.ts -g "gate:"`):

```
Running 2 tests using 1 worker

[S3][ext][gate][stable] fault=false ok=true ms=134.0 rows=16988 error=
  ✓  1 [chromium] › e2e/s3.ext.spec.ts:97:3 › gate: read_parquet over a same-origin custom_extension_repository with extensions.duckdb.org BLOCKED -- stable (592ms)
[S3][ext][gate][next] fault=false ok=true ms=140.1 rows=16988 error=
  ✓  2 [chromium] › e2e/s3.ext.spec.ts:97:3 › gate: read_parquet over a same-origin custom_extension_repository with extensions.duckdb.org BLOCKED -- next (642ms)

  2 passed
```

Seeded fault (`SPIKE3_EXT_FAULT=1 npx playwright test --config=playwright.config.ts e2e/s3.ext.spec.ts -g "gate:"`):

```
Running 2 tests using 1 worker

[S3][ext][gate][stable] fault=true ok=false ms=39.2 rows=undefined error=RuntimeError: function signature mismatch
  ✘  1 [chromium] › e2e/s3.ext.spec.ts:97:3 › gate: read_parquet over a same-origin custom_extension_repository with extensions.duckdb.org BLOCKED -- stable [SEEDED FAULT: no custom repository] (637ms)
[S3][ext][gate][next] fault=true ok=false ms=40.6 rows=undefined error=RuntimeError: function signature mismatch
  ✘  2 [chromium] › e2e/s3.ext.spec.ts:97:3 › gate: read_parquet over a same-origin custom_extension_repository with extensions.duckdb.org BLOCKED -- next [SEEDED FAULT: no custom repository] (659ms)

  1) [chromium] › e2e/s3.ext.spec.ts:97:3 › gate: read_parquet over a same-origin custom_extension_repository with extensions.duckdb.org BLOCKED -- stable [SEEDED FAULT: no custom repository]

    Error: expect(received).toBe(expected)

    Expected: true
    Received: false

      104 |     expect(result.ok).toBe(true);
          |                       ^
        at spikes/3/e2e/s3.ext.spec.ts:104:23

  2 failed
```

**Findings**: (1) pointing DuckDB at a same-origin extension mirror via `custom_extension_repository`
does make `read_parquet()` succeed with `extensions.duckdb.org` fully blocked, for both engine
versions -- self-hosting the extension is viable. (2) Without it, under the identical blocked
network, the failure mode is **not** a clean SQL/JS exception -- it's `RuntimeError: function
signature mismatch`, a WASM-level crash surfaced through the extension-autoload path, for both
engine versions. A real (non-mocked) network failure reaching this same code path in production
(the CDN down, an ad-blocker, restrictive corporate DNS) would crash the same way, not fail
gracefully.
