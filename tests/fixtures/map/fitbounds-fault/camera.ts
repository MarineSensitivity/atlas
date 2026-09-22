// FAULT 3 — a `fitBounds` call (atlas-map seeded fault for tests/map/no-fitbounds.test.ts).
//
// This file exists only to be scanned. Framing a zone set by its bounding box is the bug the
// Shiny app deliberately avoided (atlas-4 §6.5: "there is no `fit_bounds` anywhere"): EBS and PIS
// both cross the antimeridian, and PIS's true 67.5° span reads as 360°, so `fitBounds` zooms out to
// the whole globe. All camera moves are centre+zoom from `boot.study_areas`.
interface BoundsTarget {
  fitBounds(bounds: [number, number, number, number]): unknown;
}

export function frameZones(map: BoundsTarget, bbox: [number, number, number, number]): void {
  map.fitBounds(bbox);
}
