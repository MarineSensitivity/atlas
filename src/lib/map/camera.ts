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
