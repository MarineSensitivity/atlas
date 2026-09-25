// The species lens' data layer, part 4: the camera, and the antimeridian.
//
// THE ONE RULE THAT MATTERS: a longitude is never NORMALIZED (`((x + 180) % 360) - 180`). A frame
// whose east edge exceeds 180 is how a map is told to cross the dateline; normalizing it turns a
// Bering Sea model into a 350-deg box framing Iceland (2,744 of v8's models once did exactly that;
// `atlas-refs/"parity species app.md"` §6.3, §11.10). This module only ever RE-EXPRESSES a frame
// (adding a whole 360 to one edge), never wraps one.
//
// WHAT THE PUBLISHED DATA ACTUALLY LOOKS LIKE (measured 2026-09-22 over every published shard, fix
// round 1 — the reason this module can't just copy the numbers through):
//   - v9 publishes 48,378 bboxes. Only **16** have `xmax > 180`; **6,273 have a naive span wider
//     than 180 deg** (5,053 wider than 300) — e.g. `[-173.7, -16.05, 163.7, 20.2]`, a Pacific taxon
//     written WRAPPED rather than in the minimal-span (`lon_span_agg`) frame the contract promises.
//     Read naively, that box is 337 deg of the wrong ocean. 38,448 more are `null`.
//   - **v7 publishes no bbox at all**: all 16,153 are `null` (its `model_asset` path yields none).
// So the contract's "already reduced to the minimal-span frame" does NOT hold for the data as
// published. The defect is atlas-1's to fix upstream (msens `.app_bbox` / `lon_span_agg` for v9,
// the v7 asset path); the LENS compensates here and now, with {@link minimalFrame} and a fallback
// chain that ends at the release's study-area view so a v7 species frames US waters, never a globe.
//
// THE SECOND RULE: re-fit only when the SPECIES changes (§6.3, §11.9, `rx_fitted_sp`). Switching
// layer or representation keeps the camera exactly where the user put it, which is the whole point
// of switching — comparing two models over the same water.
//
// WHY THERE IS NO QUERY HERE. The extent comes from the shard, which is what retires the per-model
// min/max over the 17 M-row cell table.
import { bboxSpansGlobe } from "../../../lib/grid/grid";
import {
  STUDY_AREA_REFERENCE_VIEWPORT,
  cameraViewToBounds,
  type CameraBoundsInput,
} from "../../../lib/map/camera";
import { MERGED_IN } from "./resolve";
import type { Bbox, TaxonCard } from "./shards";

/** `[[west, south], [east, north]]` — the shape the map module takes. `east` MAY exceed 180. */
export type CameraBounds = [[number, number], [number, number]];

/** the source rule that produced a camera — surfaced for the tests and for "Zoom to layer".
 * `"sibling"` (D8, Opus 5.5 eyes-on, 2026-09-24): a bbox from a DIFFERENT input of the SAME taxon —
 * see {@link anyInputBbox}'s own header. `"cog-bounds"`: fetched from the drawn COG itself, the
 * LAST resort when the bundle publishes no bbox at all (`state.svelte.ts#refineCameraFromCogBounds`
 * — that step lives outside this module, which stays network-free by contract). */
export type CameraSource =
  "input" | "sibling" | "merged" | "ecoregion" | "study-area" | "cog-bounds";

export interface BoundsCamera {
  kind: "bounds";
  bounds: CameraBounds;
  padding: number;
  source: Exclude<CameraSource, "study-area">;
  /** R3-A1 (round-3 plan, Ben 2026-09-25): set when `bounds` is the narrowed IN-US portion of a
   * wide-range model's own extent (the SWOT leatherback: nesting near Oceania, foraging to Alaska —
   * no phone zoom shows the whole thing meaningfully) — the un-narrowed bbox the species card's
   * "Zoom to: Whole range" toggle re-fits to. Absent for a compact model (nothing was narrowed) and
   * for every source but `"input"`/`"merged"` (the only two that call {@link wideRangeAware}). */
  wholeRangeBounds?: CameraBounds;
}

/** the last resort: `boot.study_areas[FULL]` is a VIEW (lon/lat/zoom), not an extent — which is
 * exactly why the camera type is a union rather than always-bounds. */
export interface CenterCamera {
  kind: "center";
  center: [number, number];
  zoom: number;
  source: "study-area";
}

export type Camera = BoundsCamera | CenterCamera;

/** padding in CSS pixels; a plain default the UI half may override per breakpoint. */
export const DEFAULT_CAMERA_PADDING = 40;

/** an extent spanning this much longitude cannot frame anything (`msens::bbox_spans_globe`,
 * grid.R:200-203, already ported as `bboxSpansGlobe`). */
export const GLOBE_SPAN_DEG = 350;

/** a bbox wider than this in longitude is read as WRAPPED and re-expressed (plan D8's rule, the
 * same 180-deg threshold `geo/unwrap.ts` uses on a ring's edges). */
export const MAX_FRAME_SPAN_DEG = 180;

/** `boot.study_areas[*]` — a camera preset, not an extent (see {@link StudyAreaView.bbox} for the
 * one forward-compatible exception). */
export interface StudyAreaView {
  key: string;
  lon: number;
  lat: number;
  zoom: number;
  /** R3-A1: a real extent, IF the release ever publishes one on this row (`msens::app_zones()`/
   * `study_areas()` do not today — every reader here still falls back to
   * {@link studyAreaBboxFallback}). Read opportunistically so this module needs no change the day
   * a release does start publishing one. */
  bbox?: Bbox;
}

/** the key that must always exist: "All US waters". */
export const FULL_STUDY_AREA = "FULL";

function bboxOf(raw: unknown): Bbox | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  return raw.every((v) => typeof v === "number" && Number.isFinite(v)) ? (raw as Bbox) : undefined;
}

/**
 * Read a study-area view out of `boot.study_areas`. Accepts the whole `boot` or the bare array.
 * `null` when absent or malformed — never a guessed centre, because a wrong centre is
 * indistinguishable from a right one and this is the camera of last resort.
 */
export function studyAreaView(boot: unknown, key: string = FULL_STUDY_AREA): StudyAreaView | null {
  const b = boot as { study_areas?: unknown } | unknown[];
  const rows = Array.isArray(b) ? b : Array.isArray(b?.study_areas) ? b.study_areas : null;
  if (!rows) return null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (r.key !== key) continue;
    if (typeof r.lon !== "number" || typeof r.lat !== "number" || typeof r.zoom !== "number")
      return null;
    const bbox = bboxOf(r.bbox);
    return bbox
      ? { key, lon: r.lon, lat: r.lat, zoom: r.zoom, bbox }
      : { key, lon: r.lon, lat: r.lat, zoom: r.zoom };
  }
  return null;
}

/**
 * R3-A1: "the study area as a box" — the release's own {@link StudyAreaView.bbox} when published,
 * else derived from the SAME camera the desktop default view already renders
 * ({@link cameraViewToBounds} at {@link STUDY_AREA_REFERENCE_VIEWPORT} — never an invented number;
 * see that constant's own header for the source). Converted to this module's `[[w,s],[e,n]]`
 * `Bbox` shape (xmin,ymin,xmax,ymax).
 */
export function studyAreaBboxFallback(area: StudyAreaView): Bbox {
  if (area.bbox) return area.bbox;
  const b: CameraBoundsInput = cameraViewToBounds(area, STUDY_AREA_REFERENCE_VIEWPORT);
  return [b[0][0], b[0][1], b[1][0], b[1][1]];
}

/** R3-A1: a model bbox spanning more than this many degrees of longitude cannot be usefully framed
 * whole on a narrow viewport — frame the IN-US portion instead (Ben, round-3 plan, 2026-09-25: the
 * SWOT leatherback nests near Oceania and forages to Alaska, a near-Pacific-wide span with no zoom
 * that shows it meaningfully on a 390px phone). Applies on BOTH viewports (a whole-Pacific fit is
 * also poor on desktop) — this module has no notion of viewport width, only of whether the MODEL
 * itself is wide, which is the same fact either way. */
export const WIDE_RANGE_SPAN_DEG = 120;

/**
 * Dateline-aware bbox intersection, in the SAME continuous (never re-wrapped) degree space
 * {@link minimalFrame} produces — either box may have `east`/`xmax` past 180 (a Bering Sea model),
 * or the two may simply have been re-expressed in DIFFERENT frames for the same ground (a model
 * written 160..210, a study area written -170..-120). Tries `b` as given and shifted a whole turn
 * either way, keeping whichever shift gives the WIDEST longitude overlap — the same "try the
 * complementary frame, keep whichever is narrower/real" spirit {@link minimalFrame} itself uses,
 * applied to two boxes instead of one. `null` when no shift produces a real (positive-area)
 * overlap — the caller's documented fallback is to keep the model's own whole-range fit, exactly as
 * a model under {@link WIDE_RANGE_SPAN_DEG} does today.
 */
export function intersectBbox(a: Bbox, b: Bbox): Bbox | null {
  let best: Bbox | null = null;
  let bestOverlap = 0;
  for (const shift of [0, -360, 360]) {
    const west = Math.max(a[0], b[0] + shift);
    const east = Math.min(a[2], b[2] + shift);
    if (east <= west) continue;
    const overlap = east - west;
    if (overlap <= bestOverlap) continue;
    const south = Math.max(a[1], b[1]);
    const north = Math.min(a[3], b[3]);
    if (north <= south) continue;
    bestOverlap = overlap;
    best = [west, south, east, north];
  }
  return best;
}

/**
 * R3-A1: applies the wide-range narrowing to one already-{@link framed} bbox (an `input`/`merged`
 * extent — the two `cameraFor()` steps this runs from). A compact model (span under {@link
 * WIDE_RANGE_SPAN_DEG}) or one with no study area to intersect against is unaffected — the ordinary
 * whole-range bounds, no `wholeRangeBounds` set (the species card's toggle stays hidden). A wide
 * model whose intersection comes back empty (the dateline-shift search in {@link intersectBbox}
 * found no real overlap) ALSO keeps the whole-range fit — narrowing to nothing would be worse than
 * not narrowing at all.
 *
 * EXPORTED (D1 fix, Opus 5.5 eyes-on review round 2, 2026-09-25): originally private, called only
 * from `cameraFor()`'s own `input`/`merged` bundle-bbox steps. v7 publishes NO bbox on ANY asset
 * for ANY taxon (`cameraFor()` falls all the way through to `kind: "center"` for every v7
 * species), so `state.svelte.ts#refineCameraFromCogBounds` -- the COG-bounds LAST resort that then
 * runs for literally every v7 species, including the leatherback, the Species lens' own DEFAULT
 * landing species -- built its own plain `BoundsCamera` by hand and never ran the wide-range check
 * at all. Exporting this function lets that caller apply the IDENTICAL rule instead of a second,
 * divergent copy. `source` widened from the two bundle-chain values to every non-`"study-area"`
 * `CameraSource` so a COG-bounds-refined camera can honestly report `source: "cog-bounds"` rather
 * than being mislabelled `"merged"`.
 */
export function wideRangeAware(
  bbox: Bbox,
  padding: number,
  source: Exclude<CameraSource, "study-area">,
  studyArea: StudyAreaView | null | undefined,
): BoundsCamera {
  const span = bbox[2] - bbox[0];
  if (span > WIDE_RANGE_SPAN_DEG && studyArea) {
    const usBbox = studyAreaBboxFallback(studyArea);
    const intersection = intersectBbox(bbox, usBbox);
    if (intersection) {
      return {
        kind: "bounds",
        bounds: boundsOf(intersection),
        padding,
        source,
        wholeRangeBounds: boundsOf(bbox),
      };
    }
  }
  return { kind: "bounds", bounds: boundsOf(bbox), padding, source };
}

export interface CameraOptions {
  /** representation to prefer when an input publishes more than one asset. */
  rep?: string;
  /** the release's ecoregion extent (§6.3's `er_bbox`), tried before the study area. */
  fallbackBbox?: Bbox | null;
  /** `studyAreaView(boot)` — the camera that always exists. Supply it, or a v7 taxon (no bbox is
   * published for ANY of them) has nothing to frame. */
  studyArea?: StudyAreaView | null;
  padding?: number;
}

/** `[xmin, ymin, xmax, ymax]` -> `[[w, s], [e, n]]`, copied verbatim. */
export function boundsOf(bb: Bbox): CameraBounds {
  return [
    [bb[0], bb[1]],
    [bb[2], bb[3]],
  ];
}

/**
 * The frame a bbox is really describing (plan D8's rule, applied client-side because the publisher
 * does not apply it — see the module header's measurements).
 *
 * A box whose naive span exceeds 180 deg is read as WRAPPED: its longitudes were written in
 * -180..180 and the data actually straddles the antimeridian, so the extent is the COMPLEMENTARY
 * interval `[xmax, xmin + 360]`. That frame is kept when it is narrower, which for a wrapped box it
 * always is. `[-173.7, -16.05, 163.7, 20.2]` (337.4 deg of empty Pacific) becomes
 * `[163.7, -16.05, 186.3, 20.2]` — 22.6 deg centred on 175 E, and `xmax > 180` on purpose.
 *
 * Two boxes are left exactly as they are: one already under 180 deg (`[160, 48, 210, 66]` keeps its
 * `xmax` of 210), and one whose complement would be degenerate (a genuinely circumglobal extent,
 * where the complement is zero-width and says nothing) — that one stays wide and falls through to
 * the next camera instead of framing a sliver. No such box exists in v9 today (the narrowest
 * complement measured is 10.1 deg), and the guard is what keeps that a fact rather than a hope.
 */
export function minimalFrame(bb: Bbox): Bbox {
  const span = bb[2] - bb[0];
  if (!(span > MAX_FRAME_SPAN_DEG)) return bb;
  const alt: Bbox = [bb[2], bb[1], bb[0] + 360, bb[3]];
  const altSpan = alt[2] - alt[0];
  return altSpan > 0 && altSpan < span ? alt : bb;
}

/** usable = present, finite, and — once re-framed — not circumglobal. */
function framed(bb: Bbox | null | undefined): Bbox | null {
  if (!bb || bb.length !== 4 || !bb.every((v) => Number.isFinite(v))) return null;
  const f = minimalFrame(bb);
  return bboxSpansGlobe(f, GLOBE_SPAN_DEG) ? null : f;
}

/** the extent an input publishes: the asset for `rep` if it has one, else the first asset that
 * carries a bbox at all (a pmtiles range and its COG twin describe the same ground). */
export function inputBbox(card: TaxonCard, dsKey: string, rep?: string): Bbox | null {
  const input = card.inputs.find((i) => i.dsKey === dsKey || i.mdlKey === dsKey);
  if (!input) return null;
  const preferred = rep ? input.assets.find((a) => a.rep === rep && a.bbox) : undefined;
  return (preferred ?? input.assets.find((a) => a.bbox))?.bbox ?? null;
}

/**
 * D8 (Opus 5.5 eyes-on, 2026-09-24): the walrus card (v9, WORMS:137077) is the worked example —
 * its `am` input (AquaMaps, `am|ITS-Mam-180639`) publishes `bbox: null` on both assets, and so does
 * `card.merged`, yet the SAME taxon's `ax` input (AquaX) carries a real one
 * (`[-177.7, 60.65, -139.15, 79]`, verified live in `tests/fixtures/species/v9/taxon/75.json`) —
 * selecting the `am` layer used to fall all the way to the study area for want of a bbox that a
 * SIBLING of the very taxon on screen already has. The first input (in the card's own order) that
 * carries ANY bbox on ANY of its assets, `rep`-preferred the same way {@link inputBbox} is —
 * `undefined` (not `selectedInput` itself, already tried by the caller).
 *
 * P6c (orchestrator, real-CI regression, 2026-09-24): MASK inputs (`isMask: true` — critical
 * habitat, range/DPS masks) are now SKIPPED, reversing this function's own original design (see
 * git history for the removed rationale). The original reasoning assumed a mask's narrow bbox
 * would only be tried as a fallback BEHIND the caller's ecoregion extent, and only when NO
 * ecoregion bbox is supplied would this step matter in practice — but `state.svelte.ts` never
 * supplies one AT ALL (its own header explains why: atlas-1 has not shipped `er_bbox` yet), so this
 * step is reached for EVERY taxon whose selected/merged input lacks a bbox, not just the ones this
 * function's own header worried about. Measured regression: the leatherback (`WORMS:137209`,
 * `merged.bbox: null`, `am`/`ax` also null) has a `ch_fws` critical-habitat mask whose bbox is
 * `[-64.95, 17.65, -64.85, 17.7]` — 0.1 x 0.05 degrees, a single reef off Puerto Rico — which this
 * function picked up FIRST (inputs are iterated in the card's own order, am/ax before ch_fws) and
 * flew the WHOLE-SPECIES default camera to, stranding `e2e/species.smoke.spec.ts`'s "a range draws
 * >= 1 rendered feature" gate (a Program-Area PMTiles fixture nowhere near that reef) on every
 * engine in CI. A mask is a CONSTRAINT on where a distribution model applies, never a stand-in for
 * "the species' own ground" — the walrus case this function exists for is unaffected (`ax` is a
 * real alternate DISTRIBUTION model, `isMask: false`), and a taxon with ONLY mask bboxes now falls
 * through to the study area (or, for a release with no bbox anywhere, `state.svelte.ts`'s COG-
 * bounds last resort) exactly as a taxon with no bbox at all already did. */
export function anyInputBbox(card: TaxonCard, rep?: string): Bbox | null {
  for (const input of card.inputs) {
    if (input.isMask) continue;
    const preferred = rep ? input.assets.find((a) => a.rep === rep && a.bbox) : undefined;
    const bbox = (preferred ?? input.assets.find((a) => a.bbox))?.bbox;
    if (bbox) return bbox;
  }
  return null;
}

/**
 * The camera for a taxon + the layer on screen (§6.3's fit target, with fix round 1's chain, D8's
 * "sibling" step added 2026-09-24, R3-A1's wide-range narrowing added 2026-09-25):
 *   1. the INPUT's own extent (when an input is on screen), re-framed, then narrowed to its IN-US
 *      portion if it spans more than {@link WIDE_RANGE_SPAN_DEG} ({@link wideRangeAware});
 *   2. the MERGED extent, re-framed and SIMILARLY narrowed — a wraparound range's own COG honestly
 *      is -180..180, and obeying it framed every Bering Sea species off Iceland (§11.10);
 *   3. the supplied ecoregion extent;
 *   4. ANY OTHER input of the SAME taxon that publishes a bbox (`anyInputBbox` — the walrus `am`
 *      selection frames itself off its own `ax` sibling's extent rather than falling one more step
 *      to the whole study area; tried AFTER ecoregion, see that function's own header for why);
 *   5. the release's study-area view (`boot.study_areas[FULL]`), which always exists — so a v7
 *      species, for which NO bbox is published on ANY input (`state.svelte.ts`'s own COG-bounds
 *      fetch is the caller's LAST resort beyond even this), frames US waters rather than the globe.
 * `null` only when the caller supplied no study area either.
 */
export function cameraFor(
  card: TaxonCard,
  selectedInput: string,
  opts: CameraOptions = {},
): Camera | null {
  const padding = opts.padding ?? DEFAULT_CAMERA_PADDING;

  if (selectedInput !== MERGED_IN) {
    const own = framed(inputBbox(card, selectedInput, opts.rep));
    if (own) return wideRangeAware(own, padding, "input", opts.studyArea);
  }
  const merged = framed(card.merged?.bbox ?? null);
  if (merged) return wideRangeAware(merged, padding, "merged", opts.studyArea);
  const er = framed(opts.fallbackBbox);
  if (er) return { kind: "bounds", bounds: boundsOf(er), padding, source: "ecoregion" };
  const sibling = framed(anyInputBbox(card, opts.rep));
  if (sibling) return { kind: "bounds", bounds: boundsOf(sibling), padding, source: "sibling" };
  const area = opts.studyArea;
  if (area)
    return { kind: "center", center: [area.lon, area.lat], zoom: area.zoom, source: "study-area" };
  return null;
}

/**
 * D8: the COG url the caller should ask `/cog/bounds` about, when `cameraFor()` above has already
 * fallen all the way to `"study-area"` for want of ANY bbox in the bundle (v7's own case — see this
 * module's header). Mirrors {@link inputBbox}'s own asset-selection rule so the url matches the
 * SAME asset a bbox would have come from, EXCEPT it returns whichever asset is drawable at all
 * (a `type: "cog"`) rather than requiring `.bbox`, since the whole point is that field is missing.
 * `null` when nothing drawable is even a COG (a pmtiles-only taxon has no raster to ask titiler
 * about). Deliberately NOT exported alongside a network call — this module stays network-free by
 * contract (header: "WHY THERE IS NO QUERY HERE"); the caller (`state.svelte.ts`) does the actual
 * `/cog/bounds` fetch.
 */
export function cogUrlForBoundsFallback(
  card: TaxonCard,
  selectedInput: string,
  rep?: string,
): string | null {
  if (selectedInput !== MERGED_IN) {
    const input = card.inputs.find((i) => i.dsKey === selectedInput || i.mdlKey === selectedInput);
    if (input) {
      const preferred = rep ? input.assets.find((a) => a.rep === rep) : undefined;
      const chosen = preferred ?? input.assets[0];
      if (chosen?.type === "cog") return chosen.url;
    }
  }
  if (card.merged?.type === "cog") return card.merged.url;
  return null;
}

/** the part of the view state a re-fit depends on. */
export interface CameraKey {
  sp?: string;
  in?: string;
  rep?: string;
}

/**
 * Should the map re-frame? ONLY when the species changed (§6.3/§11.9). A first render (`prev ===
 * null`) frames; a layer or representation switch never does.
 */
export function refitNeeded(prev: CameraKey | null | undefined, next: CameraKey): boolean {
  if (!prev) return true;
  return prev.sp !== next.sp;
}

/**
 * R3-W8 item 2: should picking a different INPUT (or representation) re-frame the camera? The
 * species card's "Zoom to layer on change" checkbox is this rule's on/off switch, applied by the
 * caller (`state.svelte.ts`) — this function only answers "did the layer itself change", never
 * reads the preference or the pan guard (both live outside the plain data layer by this module's
 * own "network-free / DOM-free" contract).
 *
 * A species change is NOT an input change (it is handled by {@link refitNeeded}'s own, unconditional
 * fit) — `prev.sp !== next.sp` returns `false` here so the two rules never both fire for the same
 * transition.
 */
export function refitOnInputChange(prev: CameraKey | null | undefined, next: CameraKey): boolean {
  if (!prev) return false;
  if (prev.sp !== next.sp) return false;
  return prev.in !== next.in || prev.rep !== next.rep;
}

/** the longitude span of a bounds camera, in degrees — the gate's measurement (`< 200` for every
 * model, including the 6,273 v9 extents written wrapped). */
export function lonSpanOf(camera: BoundsCamera): number {
  return camera.bounds[1][0] - camera.bounds[0][0];
}

/** the centre longitude, in the SAME frame the bounds arrived in (so it may exceed 180). */
export function centerLon(camera: BoundsCamera): number {
  return (camera.bounds[0][0] + camera.bounds[1][0]) / 2;
}
