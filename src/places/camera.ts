// places/camera.ts -- "zoom to place" (Deliverable 1), centre + zoom ONLY. CLAUDE.md: "No
// fitBounds, anywhere" -- a bbox inverts across the antimeridian (PIS's true 67.5 deg span reads
// as 360), the exact reason `src/lib/map/interaction.ts`'s `flyToStudyArea` is centre+zoom too.
// This is places' own version because a place's bbox is not one of `boot.study_areas`.
//
// The zoom is an honest heuristic, not a claim of precision: at zoom z a MapLibre view is roughly
// `360 / 2^z` degrees wide, so this inverts that to fit a padded span. It only has to get the whole
// place comfortably on screen; `mapHandle.flyTo` (an imperative `StudyArea`) takes it from there.
import { bboxOf, type AreaGeometry } from "../lib/geo/types";

export interface CenterZoom {
  lon: number;
  lat: number;
  zoom: number;
}

export const MIN_ZOOM = 1.5;
export const MAX_ZOOM = 12;
/** shrinks the frame so the place doesn't touch the panel/rail chrome at the edges. */
export const PADDING_FACTOR = 1.6;

/**
 * Centre + zoom for a dateline-aware bbox (`[xmin, ymin, xmax, ymax]`; `xmax` may exceed 180 --
 * `geo/types.ts#bboxOf`'s own convention, which this reads literally and never re-wraps).
 */
export function centerZoomForBbox([x0, y0, x1, y1]: readonly [
  number,
  number,
  number,
  number,
]): CenterZoom {
  const lonSpan = Math.max(x1 - x0, 1e-6) * PADDING_FACTOR;
  const latSpan = Math.max(y1 - y0, 1e-6) * PADDING_FACTOR;
  // a degree of latitude reads about twice as "tall" on screen as a degree of longitude does wide
  // (at the equator); halving latSpan's WEIGHT here (not the value) keeps a tall, narrow place from
  // zooming out further than a wide place of the same area needs to.
  const span = Math.max(lonSpan, latSpan / 2);
  const zoom = Math.log2(360 / span);
  return {
    lon: (x0 + x1) / 2,
    lat: (y0 + y1) / 2,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
  };
}

export function centerZoomForGeometry(geom: AreaGeometry): CenterZoom {
  return centerZoomForBbox(bboxOf(geom));
}
