// atlas-0 Step 4, S2, fix round 2: the real, committed entry. v6-documented ESM wiring -- named
// import + an explicit worker URL via setWorkerUrl(), imported with Vite's `?worker&url` suffix
// (NOT `?url` alone -- round 1's mistake, kept as the seeded fault in main-fault-worker-url.ts).
//
// Why `?worker&url` and not `?url`: the worker file (maplibre-gl-worker.mjs) itself statically
// imports "./maplibre-gl-shared.mjs" (~514KB, code shared between the main thread and the
// worker). `?url` copies the worker file VERBATIM (an unprocessed asset copy) with that import
// statement untouched, so the worker tries to fetch a literal "maplibre-gl-shared.mjs" next to
// itself in dist/assets/ -- a file Vite never emits under that name (the main thread's copy of
// that same shared code gets bundled straight into the entry chunk instead, since our one JS
// entry already needs it). The worker's own import then 404s, so it throws during its own module
// init before it ever handles a single message -- vector tile parsing (which happens IN the
// worker) silently never happens, while the RASTER score layer keeps painting fine (raster tiles
// don't need the worker to decode). Round 1's pixel gate only probed the raster ocean points, so
// it never saw this. `?worker&url` tells Vite to build the worker as its own bundle root (a real,
// separate build pass over the worker's module graph, not a raw file copy), which resolves and
// inlines its "./maplibre-gl-shared.mjs" dependency correctly -- confirmed: the built worker
// chunk is self-contained (~508KB, no separate shared chunk request at runtime) and
// e2e/s2.spike.spec.ts's vector-feature assertion passes. See RESULTS.md "fix round 2".
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { runApp } from "./app";

runApp(maplibreWorkerUrl);
