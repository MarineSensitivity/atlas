// The ONE MapLibre instance, and the only file in the app that constructs one.
//
// Every line of the wiring below is a rule from docs/spikes/S2.md's verdict (CLAUDE.md "The spike
// pins"), and each one has a measured failure mode behind it:
//
//  - NAMED imports. maplibre-gl 6.x has no default export; a default import is a hard Rolldown
//    `[MISSING_EXPORT]` build failure, not a style preference.
//  - `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` + `setWorkerUrl()`. Plain `?url` emits a
//    worker whose 514 KB shared chunk 404s — rasters still paint and VECTOR TILES SILENTLY NEVER
//    PARSE. That is why every map spec asserts a rendered vector feature, not just pixels.
//  - `canvasContextAttributes: { preserveDrawingBuffer: true }`. The bare top-level key is silently
//    ignored in 5.x/6.x and every out-of-process `readPixels` then reads (0,0,0,0) while the map
//    visibly renders.
//  - `map.resize()` immediately after construction: without it raster tile requests were measurably
//    non-deterministic under headless Chromium.
//  - ONE composed style, applied with `setStyle(style, {diff:true})` — see style.ts. This file
//    never calls `addLayer`, `addSource` or `moveLayer`.
//
// The camera rule (CLAUDE.md "URL-is-the-view") lives in camera.ts: rounded, de-duplicated,
// debounced ~300 ms, `history.replaceState` only (through the caller's `onCamera`, which is
// `selStore.set` in the shell), and NEVER for a programmatic move — MapLibre's own `eventData`
// pass-through carries `atlasProgrammatic: true` from every `flyTo`/`jumpTo` this module makes, so
// there is no mutable flag to get out of sync.
import { Map as MapLibreMap, addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { createCameraWriter, type CameraWriter } from "./camera";
import { FALLBACK_FULL_STUDY_AREA, PROGRAMMATIC_EVENT_DATA, type StudyArea } from "./interaction";
import { applyStyle } from "./style";
import type { MapView, Projection, ResolvedTheme, StyleSpecification } from "./types";

/** the empty style the map is constructed with; the real one arrives via `applyStyle` one tick
 * later, so construction never blocks on boot.json. The projection travels IN it: `setProjection()`
 * before the first style has loaded throws "Style is not done loading" (measured, atlas-map). */
function blankStyle(projection: Projection): StyleSpecification {
  return { version: 8, projection: { type: projection }, sources: {}, layers: [] };
}

let wired = false;

/**
 * Process-wide, once: the worker URL and the `pmtiles://` protocol. Both are global MapLibre state,
 * so registering them per map would re-register the protocol and throw on the second map (the
 * report page builds its own).
 */
export function wireMapLibreOnce(): void {
  if (wired) return;
  setWorkerUrl(maplibreWorkerUrl);
  addProtocol("pmtiles", new Protocol().tile);
  wired = true;
}

export interface CreateMapOptions {
  theme: ResolvedTheme;
  /** the URL's camera (`?map=`); when absent, `area` decides. */
  camera?: MapView;
  /** the study area to open on when there is no `?map=` — `boot.study_areas[sel.area]`. */
  area?: StudyArea;
  projection?: Projection;
  /** called with a settled, rounded, user-driven camera. The shell passes `selStore.set({map})`. */
  onCamera?: (camera: MapView) => void;
  /** override only in a test. */
  cameraDelayMs?: number;
}

export interface MapHandle {
  /** the raw MapLibre map — for `on`/`off` and `queryRenderedFeatures`; never for `addLayer`. */
  readonly map: MapLibreMap;
  /** apply a composed style (`composeStyle`) — the one `setStyle(diff:true)`. */
  applyStyle(style: StyleSpecification): void;
  /** globe ⇄ mercator. Also expressible as `composeStyle({projection})`; this is the imperative
   * twin for a control that flips it without recomposing anything else. */
  setProjection(projection: Projection): void;
  /** fly to a study area's centre + zoom. Never `fitBounds` (see interaction.ts). */
  flyTo(area: StudyArea): void;
  /** the current camera, rounded for the URL. */
  camera(): MapView;
  resize(): void;
  /** write any pending camera immediately (the shell calls this on unload). */
  flushCamera(): void;
  destroy(): void;
}

/** does this move event come from the app rather than the user? */
function isProgrammatic(e: unknown): boolean {
  return !!(e as { atlasProgrammatic?: boolean } | undefined)?.atlasProgrammatic;
}

export function createMap(container: HTMLElement, opts: CreateMapOptions): MapHandle {
  wireMapLibreOnce();

  const start = opts.camera ?? {
    lon: (opts.area ?? FALLBACK_FULL_STUDY_AREA).lon,
    lat: (opts.area ?? FALLBACK_FULL_STUDY_AREA).lat,
    zoom: (opts.area ?? FALLBACK_FULL_STUDY_AREA).zoom,
  };

  const map = new MapLibreMap({
    container,
    style: blankStyle(opts.projection ?? "globe"),
    center: [start.lon, start.lat],
    zoom: start.zoom,
    bearing: start.bearing ?? 0,
    pitch: start.pitch ?? 0,
    // the on-map About card carries the attribution (spec.md §9); MapLibre's own control would be
    // a second, unstyled copy of it floating over the map.
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  // S2 consequence 6: without this, raster tile requests are non-deterministic headless.
  map.resize();

  // ...and this one keeps it right afterwards. The `resize()` above runs before the shell's grid
  // has laid out, so the canvas can latch a wrong height and never correct it (measured: a 1280×800
  // viewport produced a 300 px-tall canvas, putting a probe point off the bottom edge). A
  // ResizeObserver on the container is the only signal that covers BOTH a window resize and a
  // layout-driven one — a panel opening, the phone sheet changing detent — neither of which fires a
  // window `resize` event.
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
  }

  function currentCamera(): MapView {
    const c = map.getCenter();
    return {
      lon: c.lng,
      lat: c.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
  }

  let queued: StyleSpecification | undefined;
  let queuedListener = false;
  let writer: CameraWriter | undefined;
  const onMove = (e: unknown) => {
    if (!writer || isProgrammatic(e)) return;
    writer.push(currentCamera());
  };
  if (opts.onCamera) {
    writer = createCameraWriter({ write: opts.onCamera, delayMs: opts.cameraDelayMs }, start);
    map.on("move", onMove);
    map.on("moveend", onMove);
  }

  return {
    map,
    applyStyle(style: StyleSpecification) {
      // MapLibre can only DIFF against a loaded style: called earlier it logs "Unable to perform
      // style diff … Rebuilding the style from scratch" and throws the diff away (measured,
      // atlas-map). Queue the latest style instead — a lens may legitimately compose one before the
      // blank constructor style has finished loading.
      if (map.isStyleLoaded()) {
        applyStyle(map, style);
        return;
      }
      queued = style;
      if (!queuedListener) {
        queuedListener = true;
        map.once("style.load", () => {
          queuedListener = false;
          const next = queued;
          queued = undefined;
          if (next) applyStyle(map, next);
        });
      }
    },
    setProjection(projection: Projection) {
      // deferred until a style exists: `setProjection` on a map whose first style has not loaded
      // throws "Style is not done loading" (measured, atlas-map — it is why the constructor above
      // carries the projection in its blank style instead of calling this).
      if (map.isStyleLoaded()) map.setProjection({ type: projection });
      else map.once("style.load", () => map.setProjection({ type: projection }));
    },
    flyTo(area: StudyArea) {
      // a programmatic move supersedes whatever the user's last gesture was still holding.
      writer?.cancel();
      map.flyTo({ center: [area.lon, area.lat], zoom: area.zoom }, { ...PROGRAMMATIC_EVENT_DATA });
    },
    camera: currentCamera,
    resize() {
      map.resize();
    },
    flushCamera() {
      writer?.flush();
    },
    destroy() {
      writer?.cancel();
      observer?.disconnect();
      map.off("move", onMove);
      map.off("moveend", onMove);
      map.remove();
    },
  };
}
