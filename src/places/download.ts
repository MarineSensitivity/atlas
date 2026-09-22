// places/download.ts -- Deliverable 1's footer "Download places": a GeoJSON FeatureCollection of
// the DECODED geometries actually analysed -- never the geometry as drawn/uploaded (plan D8: every
// analysis, and therefore every export, runs on decode(encode(geometry))).
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Place } from "../lib/geo/placeCodec";
import { fallbackZoneLabel } from "./model";

/** RFC 7946 permits `"geometry": null` (a `zone`/`upload` place has none client-side); the
 * `@types/geojson` `Feature` type does not model that directly, so this local widening is the
 * narrowest fix rather than an `any`. */
type NullableFeature = Feature<Geometry | null>;

/**
 * One Feature per place. A `zone` place carries no geometry client-side (its polygon lives in the
 * release's PMTiles archive, not something this app reassembles into one clean, tile-boundary-free
 * shape) -- RFC 7946 permits `"geometry": null`, so its row still appears, with `set`/`keys`
 * properties naming exactly what it selects, rather than being silently dropped from the file.
 */
export function placesToGeoJson(places: readonly Place[]): FeatureCollection<Geometry | null> {
  const features: NullableFeature[] = places.map((p) => {
    if (p.kind === "geom") {
      return {
        type: "Feature",
        geometry: p.geometry,
        properties: { kind: "geom", name: p.name },
      };
    }
    if (p.kind === "upload") {
      return {
        type: "Feature",
        geometry: null,
        properties: {
          kind: "upload",
          name: p.name,
          digest: p.digest,
          note: "geometry too large for the link — ask the sender for the GeoJSON",
        },
      };
    }
    return {
      type: "Feature",
      geometry: null,
      properties: { kind: "zone", set: p.set, keys: p.keys, name: fallbackZoneLabel(p) },
    };
  });
  return { type: "FeatureCollection", features };
}

/** browser-only side effect (an anchor click); kept separate from the pure builder above so
 * `placesToGeoJson` stays Node-testable. */
export function downloadGeoJson(
  fc: FeatureCollection<Geometry | null>,
  fileName = "places.geojson",
): void {
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
