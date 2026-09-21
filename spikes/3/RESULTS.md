# S3 -- values without the tile server: raw measurements

Measurements only. No verdict is drawn here (plan: "Verdict feeds atlas-1", not this spike).

## Versions / environment

- node `v24.9.0`, npm `11.18.0`
- duckdb CLI `v1.5.5` (Variegata) -- used only to build the local tile fixtures, not in the harness
- `@duckdb/duckdb-wasm` `1.32.0` (S1's provisional pin; S3 does not decide this, it just uses S1's
  current pin per the plan)
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

Harness built and functional (`spikes/3/display.html`, `src/display.ts`,
`e2e/s3.display.spec.ts`): decodes one score COG (`extrisk_bird_ecoregion_rescaled`, FULL, rescale
0-100) once into an RGBA bitmap client-side (an 11-stop ColorBrewer "Spectral" LUT, reversed, as an
approximation of titiler's `colormap_name=spectral_r` -- see the methodology caveat below), renders
it through a `Deck` instance with one `BitmapLayer` (`_imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT`)
positioned per zoom via `WebMercatorViewport.fitBounds()` on each z2-z8 XYZ tile's exact bbox, reads
the rendered pixels back with `gl.readPixels` (`onAfterRender`, no `drawImage`/canvas-taint
involved), and compares them against the corresponding titiler PNG tile
(`/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?...&colormap_name=spectral_r&rescale=0,100`) at 20
fixed probe points clustered near the click case's center (so they stay inside the same z8 tile).
Records `performance.memory.usedJSHeapSize` (Chrome-only) before/after.

`titiler-v8.marinesensitivity.org` was unreachable for most of this session (`curl --max-time
15`/`20` timed out repeatedly on `/`, `/cog/info`, `/cog/point`, and `/cog/tiles/...`, while every
other host tested, including the S3 bucket, stayed reachable throughout -- an outage or overload
specific to that one service, not a network problem here) but came back before the session ended;
candidate (a)/(b) above never depended on it (candidate (b) reads COGs directly from S3).

Command: `cd spikes/3 && TMPDIR=<writable dir> npx playwright test --config=playwright.config.ts
e2e/s3.display.spec.ts`.

**Methodology caveat**: titiler's actual `spectral_r` colormap implementation was not inspected (no
endpoint exposes its LUT), so the pixel deltas below include colormap-implementation differences
between our 11-stop ColorBrewer interpolation and titiler's, not only geometric/resampling
differences between the two rendering paths -- the two are not separated in these numbers. The
source raster was decoded and colormapped at its full native resolution (7200x2001px) once, then
reused as the `BitmapLayer`'s `image` across every zoom (WebGL handles the up/downsampling per
viewport); titiler resamples fresh per tile server-side.

| z | probes | titiler requests | max per-channel delta (0-255) | mean per-channel delta |
|---|---|---|---|---|
| 2 | 20 | 1 | 0 | 0.00 |
| 3 | 20 | 1 | 77 | 15.58 |
| 4 | 20 | 1 | 169 | 14.43 |
| 5 | 20 | 1 | 71 | 3.93 |
| 6 | 20 | 1 | 184 | 8.92 |
| 7 | 20 | 1 | 180 | 10.68 |
| 8 | 20 | 2 | 136 | 7.67 |

z2's exact 0 match is very likely coincidental, not a sign of fidelity: at z2 one XYZ tile spans
~90deg, so the 20 probe points (clustered in a 0.6deg box) all round to the same handful of very
coarse output pixels on both sides. From z3 up, where the probe cluster spans a much larger
fraction of the (now much smaller) tile, real per-channel differences of 70-184/255 show up at
some probes -- a substantial fraction of the 0-255 range, though the *mean* (4-16/255, i.e.
roughly 2-6%) is more modest than the max.

Memory: `performance.memory.usedJSHeapSize`, read from the page, returned the exact same value
(10,000,000) before and after the whole z2-z8 run -- Chrome coarsens/quantizes this API and it was
useless as a before/after delta in this headless context. Switched to CDP's
`Performance.getMetrics` (`JSHeapUsedSize`, via `page.context().newCDPSession(page)`), which is not
coarsened: **before 3,268,012 bytes, after 5,703,604 bytes, delta ~2.44 MB** for decoding one
7200x2001 Float32 COG into an RGBA bitmap, creating 8 `Deck` instances (one per unique z/x/y tile
across z2-z8), and fetching+decoding 8 titiler PNG tiles.
