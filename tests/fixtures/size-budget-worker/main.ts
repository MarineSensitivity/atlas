// atlas-0 review fix round 1, F3: STATIC `?worker&url` import, on purpose — the same wiring S2.md
// pins for maplibre-gl's real worker (`import x from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"`).
// A worker referenced this way downloads at construction time (here, at module load — before first
// interaction), so it must be found and budgeted even though it is neither a static `import` nor
// reliably present in the manifest's own `assets` array.
import workerUrl from "./padded-worker.ts?worker&url";

const w = new Worker(workerUrl, { type: "module" });
w.postMessage("ping");
