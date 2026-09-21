# size-budget red fixture: over-budget runtime worker

A tiny, self-contained Vite project whose entry (`index.html` → `main.ts`) **statically** imports
`padded-worker.ts?worker&url` — the same wiring `docs/spikes/S2.md` pins for maplibre-gl's real worker
(`maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` + `setWorkerUrl`). `padded-worker.ts` is padded
with deterministic, gzip-incompressible bytes (a SHA-256 hash chain, not `crypto.randomBytes`, so the
build is byte-identical on every checkout) so the emitted worker chunk's gzip size — ~167.8 KB — exceeds
`RUNTIME_WORKER_BUDGET_BYTES` (150 KB, `scripts/size-budget-core.mjs`) on its own, with the rest of the
page trivially small.

This is atlas-0 review round 1 finding F3's seeded fault: before this fix, `scripts/size-budget-core.mjs`
walked only the manifest's `imports` (and, incidentally, `assets`) — a worker referenced only through a
`new URL(..., import.meta.url)` string inside compiled JS was not reliably found or budgeted at all, so a
worker this large could ship with the checker still green.

Build it, then run the checker against its output — this must exit non-zero (red), listing the worker
under its own budget line:

```sh
npm run build:fixture:size-budget-worker
npm run size-budget -- --dist tests/fixtures/size-budget-worker/dist
```

Raising the worker budget past what this fixture's worker actually weighs is the "second variant" the
review asked for — same fixture, still red by default, green once the worker budget is wide enough, and
the worker still listed either way:

```sh
npm run size-budget -- --dist tests/fixtures/size-budget-worker/dist --worker-budget-kb 200
```

The real app's own `npm run build && node scripts/size-budget.mjs` (green, no worker referenced yet in
atlas-0) and `tests/fixtures/size-budget-static-duckdb/` (red for a different reason — a static import of
a forbidden library) are the other two controls.
