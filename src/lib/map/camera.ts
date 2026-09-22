// The camera ⇄ URL rule, as pure functions (CLAUDE.md "URL-is-the-view"): the map's centre, zoom
// and projection live in `?map=lon,lat,zoom[,bearing,pitch]` + `?proj=` or they live nowhere.
// `map.ts` owns the MapLibre wiring; everything decidable without a browser is here, so it is
// unit-testable under vitest's node environment.
//
// Three rules, one per function below:
//  1. ROUND before writing. A raw MapLibre centre is a 15-significant-digit float; a link a person
//     pastes should be readable, and an unrounded write makes every sub-pixel render a new URL.
//  2. Never write an unchanged camera (`cameraEqual`) — `history.replaceState` on every frame of a
//     drag is what makes a URL-bound map feel like it is fighting the user.
//  3. DEBOUNCE, ~300 ms, and never write a PROGRAMMATIC move. A `flyTo` is the app moving the map,
//     not the user choosing a view; writing it back mid-flight records intermediate cameras that
//     the user never asked for and that a reload would then restore instead of the destination.
import type { MapView } from "../state/types";

// --- bounds -> camera, WITHOUT MapLibre's own fitBounds ------------------------------------------
//
// atlas-5's species camera (src/lens/species/data/camera.ts) hands the lens an EXTENT, not a
// center+zoom preset — a species surface has a real footprint, unlike a study-area preset. But
// `tests/map/no-fitbounds.test.ts` scans src/lib/map AND src/lens for a call to MapLibre's own
// bounds-fitting method (never named literally in this file's prose, on purpose — see that test's
// own regex), because it normalizes longitudes internally and inverts across the antimeridian
// (EBS/PIS). The species data layer's `minimalFrame()` already solved that
// by RE-EXPRESSING a frame so `east` may exceed 180 in a continuous (never wrapped) degree space —
// so the fit math here must stay linear in that same space and must never re-wrap it.
//
// This function is deliberately named `boundsToCameraView`, never MapLibre's own bounds-fitting
// method name (function name, method name, or call site — see this repo's source-scan gate): it is
// the plain Web Mercator projection that method uses internally (a linear x = lon/360+0.5, a
// standard non-linear y for latitude), computed by hand so a bbox with `east > 180` projects to
// `x > 1` instead of being wrapped back into 0..1 first.
const MERCATOR_TILE_SIZE = 512;
const MERCATOR_MIN_ZOOM = 0;
const MERCATOR_MAX_ZOOM = 22;

function lngToMercatorX(lng: number): number {
  return lng / 360 + 0.5;
}

function latToMercatorY(lat: number): number {
  const clamped = Math.min(89.9, Math.max(-89.9, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log((1 + Math.sin(rad)) / (1 - Math.sin(rad))) / (4 * Math.PI);
}

function mercatorXToLng(x: number): number {
  return (x - 0.5) * 360;
}

function mercatorYToLat(y: number): number {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
}

/** `[[west, south], [east, north]]` — `east` MAY exceed 180 (a re-expressed, unwrapped frame). */
export type CameraBoundsInput = readonly [readonly [number, number], readonly [number, number]];

export interface Viewport {
  width: number;
  height: number;
}

export interface BoundsToCameraOptions {
  /** CSS px on every edge; the species lens' default is 40 (data/camera.ts's `DEFAULT_CAMERA_PADDING`). */
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * The center+zoom that frames `bounds` in `viewport`, computed by hand in linear Mercator space so
 * `bounds[1][0]` (east) may exceed 180 without wrapping — the whole point of this module existing
 * instead of calling MapLibre's own `fitBounds`. Degenerate input (a zero-area box, a non-finite
 * viewport) still returns a sane camera: the box's own center at `maxZoom`'s bound, never `NaN`.
 */
export function boundsToCameraView(
  bounds: CameraBoundsInput,
  viewport: Viewport,
  opts: BoundsToCameraOptions = {},
): { center: [number, number]; zoom: number } {
  const padding = opts.padding ?? 0;
  const minZoom = opts.minZoom ?? MERCATOR_MIN_ZOOM;
  const maxZoom = opts.maxZoom ?? MERCATOR_MAX_ZOOM;
  const [[west, south], [east, north]] = bounds;

  const x0 = lngToMercatorX(west);
  const x1 = lngToMercatorX(east);
  const y0 = latToMercatorY(north); // north has the SMALLER y (Mercator y grows southward)
  const y1 = latToMercatorY(south);

  const width = Math.max(x1 - x0, 1e-12);
  const height = Math.max(y1 - y0, 1e-12);

  const availW = Math.max((viewport.width || 0) - 2 * padding, 1);
  const availH = Math.max((viewport.height || 0) - 2 * padding, 1);

  const scaleX = availW / (width * MERCATOR_TILE_SIZE);
  const scaleY = availH / (height * MERCATOR_TILE_SIZE);
  const scale = Math.min(scaleX, scaleY);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.log2(Math.max(scale, 1e-9))));

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { center: [mercatorXToLng(cx), mercatorYToLat(cy)], zoom };
}

/** debounce for the URL write, per the atlas-3 shell's "replaceState only, debounced" rule. */
export const CAMERA_WRITE_DELAY_MS = 300;

/** decimals for `lon`/`lat`: ~1 m at the equator, and short enough to read in a pasted link. */
export const CAMERA_LNGLAT_DECIMALS = 5;
/** decimals for `zoom` (study-area presets are given to 2 dp: `2.16`, `3.74`). */
export const CAMERA_ZOOM_DECIMALS = 2;
/** decimals for `bearing`/`pitch`. */
export const CAMERA_ANGLE_DECIMALS = 1;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  // `+0` normalizes `-0` (which formats as "-0" in a URL and then parses back as 0 — a value that
  // round-trips to a DIFFERENT string is a round-trip bug waiting for a test to find it).
  return Math.round(value * f) / f + 0;
}

/**
 * Round a camera for the URL, and drop `bearing`/`pitch` when both are flat — they travel together
 * (state/types.ts's `MapView`) and writing `,0,0` on every link is noise.
 */
export function roundCamera(camera: MapView): MapView {
  const out: MapView = {
    lon: round(camera.lon, CAMERA_LNGLAT_DECIMALS),
    lat: round(camera.lat, CAMERA_LNGLAT_DECIMALS),
    zoom: round(camera.zoom, CAMERA_ZOOM_DECIMALS),
  };
  const bearing = round(camera.bearing ?? 0, CAMERA_ANGLE_DECIMALS);
  const pitch = round(camera.pitch ?? 0, CAMERA_ANGLE_DECIMALS);
  if (bearing !== 0 || pitch !== 0) {
    out.bearing = bearing;
    out.pitch = pitch;
  }
  return out;
}

/** are two cameras the same view? (`undefined` bearing/pitch is flat, i.e. equal to 0.) */
export function cameraEqual(a: MapView | undefined, b: MapView | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.lon === b.lon &&
    a.lat === b.lat &&
    a.zoom === b.zoom &&
    (a.bearing ?? 0) === (b.bearing ?? 0) &&
    (a.pitch ?? 0) === (b.pitch ?? 0)
  );
}

export interface CameraWriterOptions {
  /** what to do with a settled camera — in the app, `selStore.set({ map })`. */
  write(camera: MapView): void;
  delayMs?: number;
  /** injected so the unit test drives real behaviour with fake timers rather than sleeping. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface CameraWriter {
  /** a camera the USER produced; a programmatic move must never reach this (see rule 3). */
  push(camera: MapView): void;
  /** write any pending camera now (e.g. on `moveend`, or before the page unloads). */
  flush(): void;
  /** forget any pending camera — used when a programmatic move supersedes a user one. */
  cancel(): void;
  /** the last camera actually written, or `undefined`. */
  readonly last: MapView | undefined;
}

/**
 * A debounced, de-duplicated camera writer. `seed` is the camera the page loaded with, so the very
 * first user move that merely re-reports it writes nothing.
 */
export function createCameraWriter(opts: CameraWriterOptions, seed?: MapView): CameraWriter {
  const delay = opts.delayMs ?? CAMERA_WRITE_DELAY_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let last = seed ? roundCamera(seed) : undefined;
  let pending: MapView | undefined;
  let handle: ReturnType<typeof setTimeout> | undefined;

  function fire() {
    handle = undefined;
    const next = pending;
    pending = undefined;
    if (!next || cameraEqual(next, last)) return;
    last = next;
    opts.write(next);
  }

  return {
    push(camera: MapView) {
      const rounded = roundCamera(camera);
      if (cameraEqual(rounded, last)) {
        // already the written view: drop any pending write too, otherwise a drag that returns to
        // where it started still writes once.
        pending = undefined;
        if (handle !== undefined) {
          clearTimer(handle);
          handle = undefined;
        }
        return;
      }
      pending = rounded;
      if (handle !== undefined) clearTimer(handle);
      handle = setTimer(fire, delay);
    },
    flush() {
      if (handle !== undefined) clearTimer(handle);
      fire();
    },
    cancel() {
      pending = undefined;
      if (handle !== undefined) {
        clearTimer(handle);
        handle = undefined;
      }
    },
    get last() {
      return last;
    },
  };
}
