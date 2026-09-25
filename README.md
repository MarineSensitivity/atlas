# atlas

MarineSensitivity Atlas — one static web app for scores, species, places and reports over U.S.
marine areas. Svelte 5 + Vite + TypeScript, no server component: the same build is meant to run
under `https://marinesensitivity.org/atlas/` (public releases) and
`https://preview.marinesensitivity.org/{ver}/atlas/` (a reviewer preview host, behind Cloudflare
Access) with no code change between the two — see
[`2026-09-20 atlas app plan.md`](../workflows/.claude/plans_todo/2026-09-20%20atlas%20app%20plan.md)
for the full architecture and decisions, and [`CLAUDE.md`](./CLAUDE.md) for the rules that don't
change phase to phase (relative URLs, URL-is-the-view, the size budget, the testing pyramid).

**Status:** built and live at <https://marinesensitivity.org/atlas/> (GitHub Pages, published by CI
after the fast checks job) and at `https://preview.marinesensitivity.org/{ver}/atlas/` for restricted
releases. Round 2 (usability, 0.10.21 → 0.10.67, 2026-09-21..25) is complete: scores and species
lenses, places (pick, draw, coordinates, upload incl. GeoPackage, share, GeoJSON download), the
Program Area results panel, Scores search, a layer stack with a spatial-unit toggle, the flower plot
with a reference ring, the client-side report with places painted by score and HTML/ZIP/DOCX
exports, Send feedback (Sheet + email + GitHub issue), a usage beacon, and a service-health banner.
`docs/status.md` is the board (live version, what landed, open items), `CHANGELOG.md` the per-version
changes, `docs/parity.html` the parity page against the Shiny apps, and
`../workflows/.claude/plans_todo/2026-09-25 atlas app plan, round 3.md` everything still open with
evidence screenshots.

**How a change lands** (see `CLAUDE.md` "Round-2 lessons"): a worktree branch with a reserved
version; unit + build-invariant + Playwright gates and a seeded fault proving the new test can fail;
eyes-on screenshots of the real build (`scripts/eyes-shots.mjs`) reviewed before the push; CI runs
the three-engine suite, the gallery baselines and the whole seeded-fault suite on every push.

## Getting started

```sh
npm ci
npm run dev        # http://localhost:5173
```

| command                           | what it does                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server                                                   |
| `npm run build`                   | production build → `dist/`                                        |
| `npm run preview`                 | serve `dist/` locally                                             |
| `npm run check`                   | svelte-check (type-checks inside `.svelte` files too)             |
| `npm test`                        | unit tests (vitest)                                               |
| `npm run e2e`                     | Playwright smoke spec, chromium + webkit + firefox                |
| `npm run lint` / `npm run format` | eslint / prettier                                                 |
| `npm run size-budget`             | critical-path gzip budget + lazy-chunk check against a real build |

See `CLAUDE.md` for what each of these actually enforces and why.

## Runtime health detection

The app depends on two external services it does not control: the titiler-v8 tile server (every
score/species raster) and the S3 data origin each release's own files are fetched from. `src/lib/
health/` probes both and `src/lib/ui/HealthBanner.svelte` shows a dismissible top banner naming the
failing host, what it breaks and what still works, with a Retry — added 2026-09-24 after titiler-v8
was down for an hour and the live map kept rendering normally with no raster and no word to anyone.

**What it detects:** the tiler and data origin going unreachable or slow (checked once at boot, and
again whenever a map tile actually fails to load with a real error — a 5xx, a network error, or a
timeout; a 403/404 tile is a normal "this release has no data here" gap and is never reported). A
manual Retry always re-checks immediately. It does not poll continuously while everything is fine.

**What it does NOT detect:** a partial outage (some tiles/objects failing, others not — a further
real request may still surface it), degraded-but-200 responses (a tile that loads but paints wrong
data), or a preview session's own restricted data prefix (the probe always checks the public bucket
origin, not a signed-in `session.data` override — see `src/lib/health/services.ts`'s own note). It
also cannot detect a failure in anything it does not probe — DuckDB-WASM's own parquet fetches,
PMTiles zone archives, and the basemap are outside this module's scope.

## Repo layout

`index.html` (map) and `report.html` (print-first report) are the two build entries; `gallery.html`
is reserved but not wired in. App code lives under `src/lib/` (by concern: `release`, `state`,
`grid`, `geo`, `engine`, `raster`, `map`, `report`, `ui`, `brand`, `analytics`) and `src/lens/`
(`scores`, `species`) and `src/places/`. `sql/` holds the DuckDB-WASM query twins of the `msens` R
functions. `tests/` is unit tests + fixtures; `e2e/` is Playwright; `scripts/` is build/verification
tooling; `docs/` and `spikes/` hold the design and de-risking-spike write-ups. Most of these are
still empty placeholders (a lone `.gitkeep` note) — later plan phases (`atlas-1` through `atlas-9`)
fill them in; see the plan's phase table for the order.

## License

[MIT](./LICENSE)
