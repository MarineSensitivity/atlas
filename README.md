# atlas

MarineSensitivity Atlas — one static web app for scores, species, places and reports over U.S.
marine areas. Svelte 5 + Vite + TypeScript, no server component: the same build is meant to run
under `https://marinesensitivity.org/atlas/` (public releases) and
`https://preview.marinesensitivity.org/{ver}/atlas/` (a reviewer preview host, behind Cloudflare
Access) with no code change between the two — see
[`2026-09-20 atlas app plan.md`](../workflows/.claude/plans_todo/2026-09-20%20atlas%20app%20plan.md)
for the full architecture and decisions, and [`CLAUDE.md`](./CLAUDE.md) for the rules that don't
change phase to phase (relative URLs, URL-is-the-view, the size budget, the testing pyramid).

**Status:** scaffold only (plan phase `atlas-0`). There is no map, no scores lens, no species lens,
and no places yet — just the shell, the CI pipeline, and the harnesses those later phases build on.
Nothing is deployed: this repo is not yet public, has no remote configured, and GitHub Pages has
not been enabled.

## Getting started

```sh
npm ci
npm run dev        # http://localhost:5173
```

| command | what it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | production build → `dist/` |
| `npm run preview` | serve `dist/` locally |
| `npm run check` | svelte-check (type-checks inside `.svelte` files too) |
| `npm test` | unit tests (vitest) |
| `npm run e2e` | Playwright smoke spec, chromium + webkit + firefox |
| `npm run lint` / `npm run format` | eslint / prettier |
| `npm run size-budget` | critical-path gzip budget + lazy-chunk check against a real build |

See `CLAUDE.md` for what each of these actually enforces and why.

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
