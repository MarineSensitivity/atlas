// report/mapWiring.ts -- atlas-7 step 2/3: report.html's OWN, minimal MapLibre construction.
//
// WHY THIS DUPLICATES A SLICE OF `lib/map/map.ts` INSTEAD OF IMPORTING IT. `vite.config.ts` builds
// `index.html` and `report.html` in the SAME Rollup graph (unlike `gallery.html`, which gets its
// own config specifically to avoid this -- see that file's header, and
// `tests/size-budget-gallery-isolation.test.ts`, which pins index+report staying TOGETHER in one
// config). Rollup shares a chunk for any module reachable from two or more entry points in that
// one graph -- `lib/map/map.ts` is reachable STATICALLY from `index.html` (Shell.svelte) already,
// so the moment report's own map code reached it too (even through a dynamic `import()`), Rollup
// pulled it (and everything it transitively imports: camera.ts, interaction.ts, style.ts,
// styleQueue.ts, every `layers/*.ts`) out of index.html's own entry chunk and into a NEW shared
// chunk that index.html's manifest still lists as one of its own static imports -- measured: this
// grew index.html's committed 409.3 KB gzip baseline to 415.6 KB, entirely from code report.html
// alone needed. `node scripts/size-budget.mjs --entry index.html` is the gate that would catch a
// regression here; this file's whole purpose is to make sure it never has anything TO catch --
// report.html's map code touches NOTHING under `src/lib/map/**`, so nothing it imports can ever be
// shared with index.html's graph. `src/report/colors.ts` is this same principle applied to color
// literals; this is the map-construction analogue of it, and reached only through the SAME dynamic
// `import()` chain `reportMap.ts` already uses to keep `maplibre-gl` itself off report.html's own
// static critical path.
import { Map as MapLibreMap, addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";

let wired = false;

/** process-wide, once -- registering the pmtiles protocol or the worker URL twice throws on the
 * second map, same reasoning as `lib/map/map.ts#wireMapLibreOnce` (a DIFFERENT module-level flag:
 * report.html and index.html are never in the same page, so there is no real collision, only the
 * same defensive idempotency). */
function wireOnce(): void {
  if (wired) return;
  setWorkerUrl(maplibreWorkerUrl);
  addProtocol("pmtiles", new Protocol().tile);
  wired = true;
}

/**
 * A minimal, static (no camera-write, no resize-observer, no projection-toggle) MapLibre instance
 * for the report's print/export map -- it is composed once, captured to a PNG, and never touched
 * again, so it needs none of `lib/map/map.ts#createMap`'s interactive-app machinery. Still carries
 * the two measured-load-bearing options from that module's own header: named imports (6.x has no
 * default export), the worker wired via `?worker&url` + `setWorkerUrl()` (plain `?url` 404s on the
 * worker's own shared chunk), and `preserveDrawingBuffer: true` (without it, `captureMapPng()`'s
 * `toDataURL()`/`drawImage()` read back all-transparent pixels).
 */
export function createReportMap(
  container: HTMLElement,
  opts: { style: StyleSpecification; center: [number, number]; zoom: number },
): MapLibreMap {
  wireOnce();
  const map = new MapLibreMap({
    container,
    style: opts.style,
    center: opts.center,
    zoom: opts.zoom,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  map.resize();
  return map;
}
