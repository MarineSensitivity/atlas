# atlas 0.2.0

Plan `atlas-2` Step 2: `release/`'s production resolution pipeline and `state/`, the `Sel` object
that is the whole view (master plan D8). No UI in this phase — everything below is data and pure
functions, importable by the lenses later.

- **`src/lib/release/resolveVer.ts`**: the production version-resolution pipeline — `previewVer()`/
  `previewUser()` read `session.raw.{ver,user}` (Caddy writes `ver` from the preview host's path);
  `candidateVer()` makes `session.ver` authoritative in preview mode, ignoring the path AND `?ver=`
  outright; `resolveVer()` gates the result through the existing `decideAccess()` (access.ts,
  unchanged) so a label must both match `VERSION_RE` and exist in `versions.json`.
- **`src/lib/release/preview.ts`**: `previewSwitchUrl()` builds the `/{v}/atlas/...` preview-host URL
  (path segment replaced, query + hash kept) used both for switching release on the preview host and
  for `underReviewInfo()`'s "under review" modal data (ver, reason, preview link) on the public host;
  `sessionExpiryLatch()` raises one "session expired" signal per page load for a same-origin 401 or
  opaque redirect, never one per request.
- **`src/lib/release/manifest.ts`** / **`boot.ts`**: `manifest()`/`boot()` consume `window.__early`
  when present, falling back to a fresh fetch otherwise (`report.html` has no early-fetch script);
  validated through an injectable validator (`minimalManifestCheck`/`minimalBootCheck` structural
  checks stand in until msens ships the real JSON Schema — TODO atlas-1, skipped tests name it).
  `manifestCapability()` defaults every capability to FALSE, including when the whole block is
  missing (mirrors msens `manifest_can()` exactly; deliberately more lenient than msens's own
  publish-time `validate_manifest()`, which throws instead).
- **`src/lib/state/`** (new): one `Sel` object ⇄ URL, exactly per the atlas-2 key table. Query holds
  short scalars; the hash holds only `#pl` (the place codec, opaque here) and `#t` (report title) —
  a fragment never reaches a server or analytics. `history.replaceState` only, never `pushState`;
  every field is written only when it differs from its default (`lens`'s default depends on `sp`,
  `out`'s on `lens`); `,`/`:` are un-escaped for a readable link; unknown keys are ignored, unknown
  values clamp to the default, and parsing never throws. Legacy `mdl_key`/`mdl_seq` (→ `sp`, +`in`
  via an injectable `alias/{xx}.json`-backed lookup, not yet published), `splash=false` (→
  `tour=off`) and `er_clr` (kept, untouched) are rewritten/tolerated on read. `sel.svelte.ts` is the
  only file under `src/lib` that uses a Svelte rune — everything else in `state/` is a plain,
  Node-testable module (guarded by `tests/state/invariants.test.ts`'s repo-wide scan).
- A seeded-fault URL round-trip property test (`tests/state/roundtrip.property.test.ts`, fixed-seed
  PRNG, N=300, no new dependency) and source-scan invariant tests cover the gates that have no other
  executable form under Node (no `pushState`, the hash/query split, the svelte-import boundary,
  "preview mode has exactly one door" — no `localStorage`, no `location.host` compare anywhere under
  `src/lib/release`).

Fix round 1 (review):

- **`Sel.theme` is now tri-state** (`"light" | "dark" | "auto"`, plan atlas-3): `"auto"` is the
  default — never written to the URL — and follows `prefers-color-scheme` at render time via the new
  `resolveTheme(theme, prefersDark)` (`"navy" | "paper"`, `null`/unavailable resolves to `"navy"`).
  `theme=light` and `theme=dark` are both explicit overrides and now BOTH round-trip: previously
  `"light"` was (wrongly) treated as the constant default and silently dropped on format.
- `defaultOut`'s scores/species mapping now reads a single exported `DEFAULT_OUT_BY_LENS` table
  (`src/lib/state/types.ts`) that `parseSel` and `formatSel` both read, pinned by a test that checks
  parse and format against the same table for every `Lens`.
- Added a named, skipped test (`tests/release/inline-early-fetch.test.ts`) documenting that
  `index.html`'s inline early-fetch script does not yet prefer `session.ver` in preview mode the way
  `src/lib/release/resolveVer.ts`'s `candidateVer()` does — harmless today (the preview host's path
  always carries the same version), deliberately not wired up yet.

Design system, step 1 of phase `atlas-3` (the MMA visual language). Nothing is wired into the app
yet — `index.html` is untouched, so `dist/` and the size budget are unchanged; this is the review
surface for Ben's mockup checkpoint.

- **`src/lib/brand/tokens.css`**: the brand tokens and the only file in the repo allowed to contain a
  color literal. MMA palette (Gold, Steel Blue, Navy Blue, Crimson Red), a semantic layer for both
  themes — **`navy`** (dark, the default) and **`paper`** (light) — the 12/13/14/16/20/28 type scale,
  4 px spacing, radius, elevation, motion (zeroed under `prefers-reduced-motion`), and the data
  colors: eight CVD-safe category hues and the Spectral legend stops.
- **Contrast is a gate, not a review note.** `node scripts/contrast.mjs` reads the pairs from an
  `@contrast` block inside `tokens.css` and fails if a text pair is under 4.5:1, a non-text pair is
  under 3:1, a paired token is not opaque, or **any color token is unclassified**. 66 pairs pass in
  both themes. Gold assigned to text on `paper` turns it red (1.71:1) — asserted in
  `tests/contrast.test.ts`.
- **`node scripts/check-hex-literals.mjs`**: no hex literal outside `tokens.css` across
  `src/lib/brand` and the mockups; vendored brand marks are allowed only while they carry a
  provenance line. Motif opacity is capped at the guide's 10 %. Both have planted-fault tests.
- **Motifs** `src/lib/brand/motifs/{hex,wave}.svg` (tileable, one `currentColor` each, used as CSS
  masks so the tint is always a token) and the vendored MST mark for the top bar — the MMA seal is
  never in the top bar (it may not be shown below 0.75 in).
- **`docs/design/spec.md`** and three token-only mockups under `docs/design/mockups/`
  (desktop Scores with a Program Area selected, desktop Species with a drawn place, phone with the
  sheet at half), screenshotted in both themes into `docs/design/mockups/screenshots/`.
- **axe (WCAG 2.0/2.1 A + AA) over all six screens: 0 critical, 0 serious, 0 moderate, 0 minor.**
  New dev dependency `@axe-core/playwright` pinned at exactly `4.13.0`.

Plan `atlas-2` Step 5: `raster/` and `analytics/`. Both are plain TypeScript modules under `src/lib`
(no svelte import, Node-testable); nothing is wired into `index.html`/`report.html` yet, so the
static graph and size budget are unchanged.

- **`src/lib/raster/tiles.ts`**: `titilerTileUrl()` builds the stock titiler `/cog/tiles` URL
  byte-for-byte (`?url=<enc>&colormap_name=<c>&rescale=<min>,<max>`), behind a `RasterSource`
  interface for a future client-side COG renderer (plan D4, spike S3, deferred). The titiler host is
  `TitilerConfig.host`, one named constant, never a literal repeated at call sites.
- **`src/lib/raster/point.ts`**: a `ValueSource` interface with a `/cog/point` implementation for
  species values ONLY — `assertSpeciesValueRequest()` throws at runtime if ever asked for a
  `"scores"`-domain value (scores/cell/zonal numbers come from Parquet, never a tile pixel).
- **`src/lib/raster/urlEncode.ts`**: `encodeUrlReserved()`, a byte-exact twin of R's
  `URLencode(x, reserved = TRUE)` (escapes `! * ' ( )`, which a bare `encodeURIComponent` leaves bare).
- **`src/lib/raster/ramps.ts`**: THE ONLY place a color ramp is defined. Reads the 11 stops per
  palette from `boot.palettes` at runtime (never hardcoded); exposes `legendStops()`, the continuous
  `colorForValue()` blend and the choropleth `choroplethBin()`
  (`clamp(roundHalfEven((v-min)/max(max-min,1e-6)*10)+1, 1, 11)`, a local half-even helper with a
  TODO to import `geo/round.ts` once merged). `tests/raster/ramps.wiring.test.ts` scans `src/` and
  fails if a second ramp/palette array is ever planted outside this file.
- **`src/lib/analytics/`**: port of `msens::ga_js` — GA4 `G-9HW6L751XG`, `content_group`
  `atlas`/`atlas-preview`, a batched Sheet beacon (`logUrl`/`VITE_LOG_URL`; unset = no-op),
  `navigator.webdriver` sessions excluded entirely from both legs. `page_location` (and the Sheet
  log's `page` column) is REBUILT from origin + path + `state/`'s own `QUERY_KEYS` allow-list —
  `location.hash` is never read, so a place's geometry and the report title can never reach
  analytics. `sanitizeParams()` additionally strips any `pl`/`t` param key at the event-payload level
  as defense in depth. Events: the union of the scores and species apps' names plus `place_draw`,
  `place_upload`, `place_share`, `report_open`, `report_export{format}`, `opfs_fallback`. Every
  browser global (navigator, document, window, storage, gtag) is injected with a guarded default via
  `env.ts`'s `hasBrowserGlobals()` — gated on `window`/`document`, not `navigator`/`fetch` alone,
  since Node itself now ships working globals for those two — so no test in this repo ever makes a
  real network call.

Fix round 1 (review, real defect): a privacy leak in `analytics/`.

- **`gtag("config", ...)` alone was not enough to keep a place's geometry / the report title out of
  GA4.** With no `send_page_view: false`, gtag.js fires its OWN automatic `page_view` whose
  `page_location` it fills in internally from the live page location — fragment included — no
  matter what this app's own events did. Fixed: every `config` call now sets
  `send_page_view: false` and carries an explicit, sanitized `page_location`/`page_title`; the app
  fires its own `page_view` event immediately after with the same sanitized fields; every
  `track()`-driven event carries them too, so nothing ever falls back to a gtag.js default.
  `page_title` is a fixed label (`"Atlas"` / `"Atlas (preview)"`, `pageLocation.ts`'s
  `buildPageTitle()`) — never the live document title.
- **New `Analytics.updateLocation(loc)`**: the state layer (owns `history.replaceState`) calls this
  after every URL change so the sanitized fields stay current across an SPA navigation without
  `analytics/` ever reading a live location itself.
- **`tests/analytics/noRawLocation.wiring.test.ts`** (new): source-scans `src/lib/analytics/**` —
  code AND comments — for the live page location's `href`/fragment fields or the document's own
  URL/location globals; zero occurrences allowed anywhere in the directory.
- **`docs/analytics.md`** (new) documents the one thing no code here can enforce: GA4's Enhanced
  Measurement "page changes based on browser history events" property setting must stay OFF for
  `G-9HW6L751XG`, plus how to verify it in the network panel.
- **`e2e/fixtures/analytics-privacy/`** (new, own scoped Playwright config, `npm run
e2e:analytics-privacy`, port 4382): a real browser, real DOM, real `location` (navigated with
  `#pl=g1.test.AAAA&t=secret` already in the URL) exercising this module's guarded defaults for the
  first time outside an injected fake — asserts no request or `gtag()` call ever carries the
  fragment's data. Root `playwright.config.ts` gained a `testIgnore: ["fixtures/**"]` so `npm run
e2e` doesn't also try (and fail) to run this fixture's spec against the main app's server.

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
