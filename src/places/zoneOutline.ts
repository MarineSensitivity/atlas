// places/zoneOutline.ts -- the picked/selected zone keys' outline, built from whatever is
// CURRENTLY RENDERED on the map (Deliverable 2's pick-mode highlight). `queryRenderedFeatures`
// with no point argument returns every feature of the given layers within the viewport -- the
// standard MapLibre "highlight the selected features" pattern (the alternative, holding a full
// copy of the zone vector tiles' geometry client-side, would duplicate what the PMTiles archive
// already serves). The one accepted limitation: a key whose zone is entirely outside the current
// viewport contributes no outline until it (or a re-pick) scrolls into view -- acceptable for an
// interactive, click-driven pick session.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { zoneFillId, zoneKeyProperty, zoneLineId } from "../lib/map/layers/zones";

export interface RenderedFeatureLike {
  properties?: Record<string, unknown> | null;
  geometry?: Geometry;
}

export interface RenderedFeatureMap {
  queryRenderedFeatures(options?: { layers?: string[] }): RenderedFeatureLike[];
}

export const EMPTY_FEATURE_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** the outline of every picked key of `unit` that is currently rendered, deduplicated by
 * (key, geometry) -- a fill layer and a line layer over the same source report the same feature
 * twice at every zoom. */
export function renderedZoneOutline(
  map: RenderedFeatureMap,
  unit: string,
  keys: readonly string[],
): FeatureCollection {
  if (!keys.length) return EMPTY_FEATURE_COLLECTION;
  const wanted = new Set(keys.map(String));
  const keyProp = zoneKeyProperty(unit);
  const seen = new Set<string>();
  const features: Feature[] = [];
  for (const f of map.queryRenderedFeatures({ layers: [zoneFillId(unit), zoneLineId(unit)] })) {
    const key = f.properties?.[keyProp];
    if (typeof key !== "string" && typeof key !== "number") continue;
    if (!wanted.has(String(key))) continue;
    if (!f.geometry) continue;
    const dedupeKey = `${key}:${JSON.stringify(f.geometry)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    features.push({ type: "Feature", geometry: f.geometry, properties: { ...f.properties } });
  }
  return { type: "FeatureCollection", features };
}
