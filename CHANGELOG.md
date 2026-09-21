# atlas 0.2.0

Core geometry runtime (plan phase `atlas-2`, Step 1). Plain TypeScript under `src/lib`, no Svelte
import anywhere in it, so every rule below is callable from a test — and from `scripts/parity/`
later — under plain Node.

- **`src/lib/geo/placeCodec.ts` — the `g1` place codec** (plan D8): places live in the URL hash as
  `g1.<name>.<base64url>` (delta + zigzag varints, 0x10 magic, precision 3, or 4 for a place under
  half a degree), `z.<set>.<keys>` for a published zone, or `u.<name>.<sha256_8>` when a geometry is
  too large to carry. Longitudes are stored **unwrapped**, so a Bering place runs 170...190 and no
  decoder has to guess at the antimeridian. **Every analysis runs on `decode(encode(geometry))`**
  (`roundTrip()`), so a shared link reproduces the sender's numbers exactly. `fitPlacesToUrl()`
  applies the budget ladder: silent to 2,000 characters, a "long link" note to 8,000, then
  Douglas-Peucker from 0.001 deg doubling to 0.02 deg — each rung taken only while the area moves by
  <= 1 % and every ring stays simple — and finally the `u.` form. A 30-vertex place costs 104
  characters. The shared vectors are `tests/fixtures/place_codec.json`, which msens carries
  byte-identically as `inst/fixtures/place_codec.json`.
- **`src/lib/grid/grid.ts` — both cell grids**, ported from `msens/R/grid.R`
  (`cellFromLonLat`, `cellLonLat`, `lonSpan`, `lonSpanAgg`, `bboxSpansGlobe`) plus `tileOf()` from
  `msens/R/cell_model.R`. The geometry always comes from a `boot.grid`-shaped object and the module
  contains no grid constants at all: `usa05` (3103 x 2006 from 141.10 E on a 0-360 frame) and
  `global05` (7200 x 3600 from -180) disagree about what a `cell_id` means, and a hardcoded `nc`
  is how v7 ids get painted on v8's grid.
- **`src/lib/geo/coverage.ts` — `cellsInPolygon()`**, the twin of `msens::cells_in_polygon_grid()`:
  planar in degrees, interior cells by scanline, boundary cells by clipping the polygon (outer minus
  holes) to the cell square, multipolygon parts summed and capped at 1, `pct` rounded R's way (half
  to **even**, after a 1e-9 snap so a 0.5 % sliver is not decided by float noise) and cells at 0
  dropped. Columns wrap modulo `nc` on `global05` and shift into the 141.10 frame on `usa05`.
  Measured: a 74,024-cell place in 45 ms (target: 150 ms). `cellFractions()` exposes the same cells
  with their unrounded fraction.
- **The 1e-9 snap in front of that rounding is now proven, not asserted.** A sweep over exact-half
  rectangles across the Gulf finds that **4,522 of 8,640 on `global05` and 4,002 of 8,640 on
  `usa05`** round the wrong way if the raw `frac * 100` is rounded as it arrives — so
  `tests/fixtures/places/knife-edge-{0p5,2p5,3p5}-global05.json` and `knife-edge-2p5-usa05.json`
  pin four of them (each records its raw value to 17 digits and the pct with and against the snap),
  and removing the snap turns all four red. The error runs both ways: the 3.5 % case rounds _down_
  to 3 unsnapped where the rule says 4.

# atlas 0.1.1

- **Restricted releases can no longer render on the public host** (plan D6). `versions.json`'s
  `access` column is now enforced: v7b, v8 and v9 are restricted, and
  `marinesensitivity.org/atlas/?ver=v9` makes **zero** requests for that release — it shows
  `latest.txt`'s public release instead and records why on `window.__early.denied`. A restricted
  release renders only where the same-origin `session.json` says `preview: true` (the preview host).
  Unknown versions, a row with no `access`, and an unreadable `versions.json` all fail closed.
- **The registry and release files are read from the bucket, absolutely**, not from the page's own
  origin: `latest.txt`, `versions.json` and `{ver}/manifest.json` now come from
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/`. This fixes the
  doubled-path 404 (`/v9/atlas/v9/manifest.json`) that made the preview host's version path fetch
  nothing at all. `session.json` remains the only same-origin request, and the public path no longer
  waits on it.
- New `src/lib/release/dataBase.ts` (the one place a data origin is formed; honours a validated,
  https-only `session.data` prefix on a preview session) and `src/lib/release/access.ts` (the gate),
  both unit-tested through the same case table as `index.html`'s inline early-fetch copy.

# atlas 0.1.0

Initial scaffold (plan phase `atlas-0`, Deliverables 1-5; the four de-risking spikes are a separate,
later change).

- **Project scaffold**: Svelte 5 (runes) + Vite 8 + TypeScript strict, no SvelteKit, no client
  router. Two build entries, `index.html` (map) and `report.html` (print-first report); `base: "./"`
  so the same `dist/` can run under both `/atlas/` and a version-prefixed preview path.
  ESLint (flat config) + Prettier, Vitest, Playwright (chromium/webkit/firefox) all wired up.
  `@duckdb/duckdb-wasm` and a `maplibre-gl` version are intentionally **not** added yet — those pins
  belong to spikes S1/S2.
- **`index.html` shell** that paints from static HTML + inlined critical CSS alone (brand top bar,
  tool rail, an empty panel skeleton, the four MMA hex colors as CSS variables) before any
  JavaScript runs, plus the inline early-fetch script that starts `latest.txt`, `versions.json` and
  `session.json`, then chains `{ver}/manifest.json` and `{ver}/app/boot.json`, all stashed on
  `window.__early`.
- **`src/lib/release/version.ts`** — version resolution (path beats `?ver=` beats `latest.txt`,
  `^v[0-9]+[a-z]?$`, matching `msens::atlas_resolve_ver()`) and **`src/lib/release/session.ts`** —
  preview-mode detection (a same-origin `session.json`; 404 or a network error is public, only a
  `200` with `preview: true` is preview). Both unit-tested; the inline early-fetch script mirrors
  the same logic by hand since it must run before any module import is possible.
- **CI** (`.github/workflows/pages.yml`): `npm ci`, `tsc --noEmit`, `vitest run`, `vite build`, the
  size budget and two build-time invariant checks (below) on every push and pull request; a
  separate, elevated job publishes the checked `dist/` to the `gh-pages` branch, only on push to
  `main`.
- **`scripts/size-budget.mjs`**: fails when the critical path exceeds 350 KB gzip, or when a
  lazy-only chunk (`duckdb*`, `terra-draw*`, `docx*`, `shp*`, the treemap) is reachable by a static
  import. `tests/fixtures/size-budget-static-duckdb/` is the committed fixture that proves the
  check can fail (a stub module statically imported on purpose).
- **`scripts/check-dist-session.mjs`**: fails the build if `dist/` ever contains `session.json`
  (that file must only be served by the preview host).
- **`scripts/check-relative-assets.mjs`**: fails the build on any absolute `/assets/...` URL in an
  emitted file.
- **Playwright smoke spec** (`e2e/shell.smoke.spec.ts`): the shell paints and logs zero unexpected
  console errors, on chromium, webkit and firefox. **`scripts/verify.mjs`**: skeleton state-matrix
  runner (desktop 1280×800 / phone 390×844, `assertLayout()` = no horizontal overflow, every
  `[data-control]` on screen) for later phases to grow into.
- **`CLAUDE.md`**, **`README.md`**, **`LICENSE`** (MIT, mirroring `apps`).
