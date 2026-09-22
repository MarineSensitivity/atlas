// The species lens' data layer, part 4: the camera, and the antimeridian.
//
// THE ONE RULE THAT MATTERS: longitudes are never normalized. The release publishes each extent
// already reduced to the minimal-span frame (msens `lon_span_agg()`, grid.R:175-185, ported as
// `lonSpanAgg` in lib/grid/grid.ts): keep the 0-360 frame iff it is narrower than the -180..180 one
// AND under 350 deg. So a Bering Sea model arrives as `[160, 48, 210, 66]` with **xmax > 180**, and
// the map reads that as crossing the dateline. Put it through `((x + 180) % 360) - 180` anywhere on
// the way and the same model spans 350 deg the wrong way round the world and frames off Iceland
// (2,744 of v8's models once did exactly that; `atlas-refs/"parity species app.md"` §6.3, §11.10).
// Hence: this module only ever COPIES the numbers the release gave it.
//
// THE SECOND RULE: re-fit only when the SPECIES changes (§6.3, §11.9, `rx_fitted_sp`). Switching
// layer or representation keeps the camera exactly where the user put it, which is the whole point
// of switching — comparing two models over the same water.
//
// WHY THERE IS NO QUERY HERE. The bbox is precomputed in the shard (atlas-1's contract), which is
// what retires the per-model min/max over the 17 M-row cell table.
import { bboxSpansGlobe } from "../../../lib/grid/grid";
import { MERGED_IN } from "./resolve";
import type { Bbox, TaxonCard } from "./shards";

/** `[[west, south], [east, north]]` — the shape the map module takes. `east` MAY exceed 180. */
export type CameraBounds = [[number, number], [number, number]];

export interface Camera {
  bounds: CameraBounds;
  padding: number;
  /** which rule produced it — surfaced for the tests and for "Zoom to layer" telemetry. */
  source: "input" | "merged" | "fallback";
}

/** padding in CSS pixels; a plain default the UI half may override per breakpoint. */
export const DEFAULT_CAMERA_PADDING = 40;

/** an extent spanning this much longitude cannot frame anything (`msens::bbox_spans_globe`,
 * grid.R:200-203, already ported as `bboxSpansGlobe`). */
export const GLOBE_SPAN_DEG = 350;

export interface CameraOptions {
  /** representation to prefer when an input publishes more than one asset. */
  rep?: string;
  /** last-resort extent: the release's ecoregion extent (§6.3's `er_bbox`). */
  fallbackBbox?: Bbox | null;
  padding?: number;
}

/** `[xmin, ymin, xmax, ymax]` -> `[[w, s], [e, n]]`, copied verbatim. */
export function boundsOf(bb: Bbox): CameraBounds {
  return [
    [bb[0], bb[1]],
    [bb[2], bb[3]],
  ];
}

/** usable = present, finite, and not circumglobal. */
function usable(bb: Bbox | null | undefined): bb is Bbox {
  return !bboxSpansGlobe(bb, GLOBE_SPAN_DEG);
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
 * The camera for a taxon + the layer on screen (§6.3's fit target):
 *   merged  -> the merged extent;
 *   input   -> the INPUT's own extent, unless it spans the globe (a wraparound range's COG honestly
 *              is -180..180, and obeying it framed every Bering Sea species off Iceland, §11.10),
 *              then the merged extent, then the supplied fallback.
 * `null` when nothing framable was published — the caller leaves the camera alone.
 */
export function cameraFor(
  card: TaxonCard,
  selectedInput: string,
  opts: CameraOptions = {},
): Camera | null {
  const padding = opts.padding ?? DEFAULT_CAMERA_PADDING;
  const merged = card.merged?.bbox ?? null;

  if (selectedInput !== MERGED_IN) {
    const own = inputBbox(card, selectedInput, opts.rep);
    if (usable(own)) return { bounds: boundsOf(own), padding, source: "input" };
  }
  if (usable(merged)) return { bounds: boundsOf(merged), padding, source: "merged" };
  if (usable(opts.fallbackBbox))
    return { bounds: boundsOf(opts.fallbackBbox), padding, source: "fallback" };
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

/** the longitude span of a camera, in degrees — the gate's measurement (`< 200` for a model that
 * crosses the dateline). */
export function lonSpanOf(camera: Camera): number {
  return camera.bounds[1][0] - camera.bounds[0][0];
}

/** the centre longitude, in the SAME frame the bounds arrived in (so it may exceed 180). */
export function centerLon(camera: Camera): number {
  return (camera.bounds[0][0] + camera.bounds[1][0]) / 2;
}
