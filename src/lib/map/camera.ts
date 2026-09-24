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

/** CSS px reserved on each edge of the viewport by shell chrome (a docked panel, the phone sheet,
 * the bottom tab bar) -- never MapLibre's own persisted `padding` state (see `paddedStudyAreaCenter`
 * below for why). */
export interface ChromePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_PADDING: ChromePadding = { top: 0, right: 0, bottom: 0, left: 0 };

/** the uncapped shift math both {@link paddedStudyAreaCenter} and {@link boundsToCameraView} share
 * -- letting `worldPx = MERCATOR_TILE_SIZE * 2^zoom`, the shift is `(frontPad - backPad) / 2 /
 * worldPx` in normalized world units, on each axis independently: exact (not a linear
 * approximation) because it operates in the map's own Mercator space, the same one `zoom`/
 * `worldPx` already describe. Takes the two DIFFERENCES directly (never the full
 * {@link ChromePadding}) so a caller that needs to bound them first (`paddedStudyAreaCenter`) can,
 * without reconstructing a padding object just to have this re-subtract it. */
function shiftForPadding(
  center: { lon: number; lat: number },
  zoom: number,
  hDiff: number,
  vDiff: number,
): { lon: number; lat: number } {
  const worldPx = MERCATOR_TILE_SIZE * 2 ** zoom;
  const x = lngToMercatorX(center.lon) - hDiff / 2 / worldPx;
  const y = latToMercatorY(center.lat) - vDiff / 2 / worldPx;
  return { lon: mercatorXToLng(x), lat: mercatorYToLat(y) };
}

export interface BoundsToCameraOptions {
  /** CSS px reserved on every edge (the species lens' default is a uniform 40 —
   * `data/camera.ts`'s `DEFAULT_CAMERA_PADDING`), OR an asymmetric {@link ChromePadding} when the
   * caller also has a docked panel/sheet to keep the content out from under (P6/D8: "reuse it for
   * D8" — the SAME chrome-aware math the initial camera uses, so a model fit is not centred behind
   * the very chrome that is hiding half of it). A bare number is shorthand for all four edges equal. */
  padding?: number | ChromePadding;
  minZoom?: number;
  maxZoom?: number;
}

function paddingOf(padding: number | ChromePadding | undefined): ChromePadding {
  if (padding === undefined) return NO_PADDING;
  if (typeof padding === "number")
    return { top: padding, right: padding, bottom: padding, left: padding };
  return padding;
}

/**
 * The center+zoom that frames `bounds` in `viewport`, computed by hand in linear Mercator space so
 * `bounds[1][0]` (east) may exceed 180 without wrapping — the whole point of this module existing
 * instead of calling MapLibre's own `fitBounds`. Degenerate input (a zero-area box, a non-finite
 * viewport) still returns a sane camera: the box's own center at `maxZoom`'s bound, never `NaN`.
 *
 * P6/D8: an ASYMMETRIC {@link ChromePadding} (a docked panel/sheet occluding one side only) both
 * shrinks the available space (used for the zoom/scale, same as a uniform number) AND shifts the
 * fitted center toward the free area's own middle (`paddedStudyAreaCenter`'s same shift, reused
 * here at the FIT's own computed zoom rather than a caller-supplied one) — a uniform `padding`
 * (every existing caller) shifts by exactly zero, so this is additive, not a behaviour change for
 * them.
 */
export function boundsToCameraView(
  bounds: CameraBoundsInput,
  viewport: Viewport,
  opts: BoundsToCameraOptions = {},
): { center: [number, number]; zoom: number } {
  const padding = paddingOf(opts.padding);
  const minZoom = opts.minZoom ?? MERCATOR_MIN_ZOOM;
  const maxZoom = opts.maxZoom ?? MERCATOR_MAX_ZOOM;
  const [[west, south], [east, north]] = bounds;

  const x0 = lngToMercatorX(west);
  const x1 = lngToMercatorX(east);
  const y0 = latToMercatorY(north); // north has the SMALLER y (Mercator y grows southward)
  const y1 = latToMercatorY(south);

  const width = Math.max(x1 - x0, 1e-12);
  const height = Math.max(y1 - y0, 1e-12);

  const availW = Math.max((viewport.width || 0) - padding.left - padding.right, 1);
  const availH = Math.max((viewport.height || 0) - padding.top - padding.bottom, 1);

  const scaleX = availW / (width * MERCATOR_TILE_SIZE);
  const scaleY = availH / (height * MERCATOR_TILE_SIZE);
  const scale = Math.min(scaleX, scaleY);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.log2(Math.max(scale, 1e-9))));

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rawCenter = { lon: mercatorXToLng(cx), lat: mercatorYToLat(cy) };
  // an asymmetric padding shifts the fitted content toward the free area's own middle, at the
  // FIT's own zoom — UNCAPPED (unlike paddedStudyAreaCenter below): a bounds fit's zoom already
  // scales with the content being framed, so the shift stays a small fraction of the frame at any
  // zoom, never the "rotate the low-zoom globe by 30 degrees" regime that needs capping against
  // (MAX_STUDY_AREA_SHIFT_PX's own header).
  const shifted = shiftForPadding(
    rawCenter,
    zoom,
    padding.left - padding.right,
    padding.top - padding.bottom,
  );
  return { center: [shifted.lon, shifted.lat], zoom };
}

/** P2 (Opus 5.5 eyes-on, 2026-09-24): at the LOW zoom a study-area preset uses (~2, showing most of
 * the globe), `shiftForPadding`'s otherwise-exact Mercator math stops matching what the GLOBE
 * projection actually renders -- MapLibre's globe is a true 3D sphere at this zoom, not a flat
 * Mercator crop, so a large padding-driven shift (a half-open phone sheet reserves ~450px of an
 * 844px viewport) computed as if it were flat rotates the sphere far more than intended: measured
 * on the fallback study area (padding.bottom ~452px, zoom 2.16), the UNCAPPED formula moved the
 * reference latitude from 46.9 to 17.4 -- a 29.5-degree swing that pushed the whole visible globe
 * down and left ~100 CSS px of blank "space" above it, the exact defect the eyes-on review caught
 * (P2: "empty sky"). Capping the PADDING DIFFERENCE fed into the shift (not the shift itself, and
 * not `padding` as returned to any OTHER caller -- `initialChromePadding()`'s own free-area bounds
 * stay the true, uncapped occlusion) keeps the correction in the regime where flat Mercator is a
 * fair stand-in for the globe's own rendering, verified empirically (a hermetic black/white water
 * fixture, `.tmp/` screenshots) to cut that gap to roughly a third. `boundsToCameraView` below
 * does NOT need this cap: a bounds fit's zoom scales with the content being framed (a small species
 * range fits at a much higher zoom, where flat Mercator IS globe-accurate), so the same runaway
 * shift cannot occur there. */
export const MAX_STUDY_AREA_SHIFT_PX = 200;

function capAxis(diff: number): number {
  return Math.max(-MAX_STUDY_AREA_SHIFT_PX, Math.min(MAX_STUDY_AREA_SHIFT_PX, diff));
}

/**
 * usability M4 ("the panel/sheet cover the study area... frame the study area with padding for
 * the panel/sheet"): shifts a center+zoom camera so the SAME geographic point instead appears at
 * the middle of the VISIBLE (unobscured) rectangle of the viewport, not the middle of the whole
 * canvas. Deliberately NOT `map.setPadding()` (MapLibre's own persisted padding state): that would
 * also silently reshape every LATER `flyTo`/`flyToBounds` call (the species camera, `boundsToCameraView`
 * above) on top of their own, independently-computed zoom -- this is a one-time initial-view
 * adjustment, so it returns a plain `{lon,lat}` the caller bakes into the camera it constructs the
 * map with, and nothing else in the app ever reads MapLibre's padding state (`docs/map.md`: "no
 * fitBounds, anywhere" carries the same "no antimeridian-unsafe native camera math" spirit).
 *
 * See {@link MAX_STUDY_AREA_SHIFT_PX}'s own header for why the padding DIFFERENCE this feeds into
 * {@link shiftForPadding} is capped -- a phone sheet at "half" or a maximized panel can reserve far
 * more than that on its own, and this is the ONE call site (the low-zoom initial/default camera)
 * where an uncapped shift visibly breaks under the globe projection.
 */
export function paddedStudyAreaCenter(
  center: { lon: number; lat: number },
  zoom: number,
  padding: ChromePadding,
): { lon: number; lat: number } {
  const hDiff = capAxis(padding.left - padding.right);
  const vDiff = capAxis(padding.top - padding.bottom);
  return shiftForPadding(center, zoom, hDiff, vDiff);
}

// --- sel.area -> camera, the fly-on-load/fly-on-change decision -------------------------------
//
// The defect this fixes (owner report, 2026-09-24, live v7): `?area=AK` rendered the DEFAULT
// camera, not Alaska. Root cause was TWO bugs stacked: `Shell.svelte` resolved the initial study
// area against a literal `null` boot (`studyAreaFromBoot(null, sel.area)`), so it could never see
// a release's real `study_areas` rows; and the ONLY place that ever called `handle.flyTo(area)` was
// `LayersPanel.svelte`'s `onchange` handler — the panel BODY, which never runs for `sel.area` as it
// arrives from the URL on load (docs/map.md's 0.10.21 rule: a map input must be a lens/shell-level
// store, never panel-only UI, for exactly this reason — a collapsed/unmounted panel body must not
// be the only path a rule runs through). The fix is this pure decision, called from an effect that
// watches `sel.area`/`sel.map`/`boot` regardless of which tool/panel is open (Shell.svelte).
//
// Precedence (read this before touching the DEFAULT first-view camera elsewhere — e.g. a later
// round padding it for docked panel/sheet chrome in Shell.svelte/interaction.ts): an EXPLICIT
// `?area=` (a non-default key on the FIRST resolution once `boot` arrives) always wins over
// whatever camera framed the very first paint, default-fit padding included — the study area is a
// CAMERA, not a filter (CLAUDE.md), so a shared `?area=AK` link must always end up on Alaska. The
// only camera a `?area=` is not allowed to override is an EXPLICIT one — `sel.map` (a user's own
// pan, or a pasted `?map=` link) — same "camera preset applies only when `map` is absent" rule
// `state/types.ts`'s own `area` field doc and `map.ts`'s `start = opts.camera ?? area-derived`
// already encode; the caller is expected to skip this function entirely while `sel.map` is set
// (see `tests/map/camera.test.ts`'s "sel.map wins" case).
export interface AreaCameraState {
  /** the area key last flown to, or `undefined` before the first resolution (`boot` not loaded
   * yet, or the map not yet constructed). */
  flownAreaKey: string | undefined;
}

export const INITIAL_AREA_CAMERA_STATE: AreaCameraState = { flownAreaKey: undefined };

/**
 * Should `handle.flyTo(area)` run right now, and what state should the caller carry forward?
 * `areaKey` is the CURRENT `sel.area`, already resolved against the real `boot.study_areas`
 * (`studyAreaFromBoot`) by the caller — this function only ever compares keys, never resolves one.
 *
 * - Same key already flown to (including "still `undefined` and still the default" on a repeat
 *   effect run before boot has loaded) — no-op.
 * - The FIRST resolution (boot just arrived) landing on the DEFAULT key — no-op: the map was
 *   already constructed pointed roughly there (`createMap`'s own `opts.area` fallback), so flying
 *   again would be a same-place no-op at best and, once a later round pads that initial camera for
 *   docked chrome, would silently UN-pad it for no reason.
 * - Anything else — an explicit non-default `?area=` on load, or ANY later change (including back
 *   to the default, once it is no longer "first") — flies.
 */
export function shouldFlyToArea(
  areaKey: string,
  defaultAreaKey: string,
  state: AreaCameraState,
): { fly: boolean; next: AreaCameraState } {
  if (areaKey === state.flownAreaKey) return { fly: false, next: state };
  const isFirstResolve = state.flownAreaKey === undefined;
  const next: AreaCameraState = { flownAreaKey: areaKey };
  if (isFirstResolve && areaKey === defaultAreaKey) return { fly: false, next };
  return { fly: true, next };
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
