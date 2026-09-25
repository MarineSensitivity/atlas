// places/download.ts -- Deliverable 1's footer "Download places": a GeoJSON FeatureCollection of
// the DECODED geometries actually analysed -- never the geometry as drawn/uploaded (plan D8: every
// analysis, and therefore every export, runs on decode(encode(geometry))).
//
// Owner review item 2 (Ben, live 0.10.62): "Download places returns a places.geojson with
// `geometry: null` and `name: GAA`, ie only acronym and not full program name." Two separate bugs,
// both in the OLD `zone` branch below: (1) `fallbackZoneLabel` was a bare `keys.join(", ")` --
// never the resolved "Gulf of America ... (GAA)" label `paLabel`/`zoneDisplayName` already give
// every other zone-place surface (Places.svelte's own row, the results panel); (2) a zone place
// carries no DRAWN geometry client-side, but its polygon is not actually unavailable -- it is
// exactly what `map/layers/zones.ts` already draws the zone's outline/choropleth FROM, the
// release's own PMTiles vector-tile source. `ZonePolygonSource` (below) queries it live, off the
// SAME source/layer/key-property every other zone reader uses (never a second geometry fetch);
// this module stays Node-testable by taking that query as an INJECTED function rather than a real
// MapLibre instance.
import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import type { MapHandle } from "../lib/map/map";
import { zoneKeyProperty, zoneSourceId, zoneUnitsFromBoot } from "../lib/map/layers/zones";
import type { Place, ZonePlace } from "../lib/geo/placeCodec";
import { unitForZoneSet } from "./model";
import { ringsFromFeatures, zoneCenterFromBoot, zoneDisplayName, zoneStatsFor } from "./zoneStats";

/** RFC 7946 permits `"geometry": null` (a place with no resolvable geometry at all); the
 * `@types/geojson` `Feature` type does not model that directly, so this local widening is the
 * narrowest fix rather than an `any`. */
type NullableFeature = Feature<Geometry | null>;

/** a zone place's own REAL polygon feature(s), queried live off the release's PMTiles source --
 * `querySourceFeatures`-shaped (not viewport-limited, unlike `queryRenderedFeatures`), so a zone
 * added to Places earlier in the session still resolves even if it is off-screen now. `[]` when
 * the covering tile has not loaded, or the unit/key genuinely is not in the archive -- the caller
 * degrades further rather than throwing. */
export interface ZonePolygonSource {
  queryZonePolygons(
    unit: string,
    keys: readonly string[],
  ): readonly { geometry?: { type: string; coordinates: unknown } | null }[];
}

/** a small square around a point (`combinedBbox`'s own "point ± 0.5°" convention, `report/
 * reportMap.ts`) -- the BBOX fallback (`geometry_source: "bbox"`) for when no polygon tile has
 * loaded but the release at least publishes a label point for this zone. */
function bboxPolygonAround(lon: number, lat: number, d = 0.5): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ],
    ],
  };
}

function zoneFeature(
  p: ZonePlace,
  boot: unknown,
  polygons: ZonePolygonSource | undefined,
): NullableFeature {
  const unit = unitForZoneSet(p.set);
  const name = zoneDisplayName(zoneStatsFor(boot, unit, p.keys));
  const properties: Record<string, unknown> = { kind: "zone", set: p.set, keys: p.keys, name };

  const rendered = polygons?.queryZonePolygons(unit, p.keys) ?? [];
  const rings = ringsFromFeatures(
    rendered.filter((f): f is { geometry: { type: string; coordinates: unknown } } => !!f.geometry),
  );
  if (rings.length) {
    return { type: "Feature", geometry: { type: "MultiPolygon", coordinates: rings }, properties };
  }

  const center = zoneCenterFromBoot(boot, unit, p.keys);
  if (center) {
    return {
      type: "Feature",
      geometry: bboxPolygonAround(center.lon, center.lat),
      properties: { ...properties, geometry_source: "bbox" },
    };
  }

  // neither a loaded polygon tile nor a published label point (docs/parity.html's own "known gap
  // G-01") -- an honest, reported gap rather than a silent one; still never dropped from the file.
  return {
    type: "Feature",
    geometry: null,
    properties: {
      ...properties,
      note: "no polygon tile loaded and no label point published for this zone yet",
    },
  };
}

/**
 * One Feature per place. `boot` resolves a zone place's full "Name (KEY)" label (`zoneDisplayName`,
 * the SAME reader every other zone-place surface uses) and, together with `polygons`, its REAL
 * geometry (see this module's own header) -- both optional so a caller with neither still gets a
 * feature per place (bare keys, `geometry: null`), never a thrown error.
 */
export function placesToGeoJson(
  places: readonly Place[],
  boot?: unknown,
  polygons?: ZonePolygonSource,
): FeatureCollection<Geometry | null> {
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
    return zoneFeature(p, boot, polygons);
  });
  return { type: "FeatureCollection", features };
}

/** R3-W2: a `ZonePolygonSource` off a real, live `MapHandle` -- extracted so the Download menu
 * (`src/shell/DownloadMenu.svelte`) can build one without duplicating `Places.svelte`'s own
 * identical inline `zonePolygonSource()` a third time. Additive: `Places.svelte` keeps its own copy
 * unchanged (round-3's file-ownership rule -- a file another slice may be mid-edit on is left
 * alone; this is the same logic, exported once, so a FUTURE change only has one place to make). */
export function zonePolygonSourceFromMap(
  mapHandle: MapHandle | undefined,
  boot: unknown,
): ZonePolygonSource | undefined {
  if (!mapHandle) return undefined;
  const handle = mapHandle;
  return {
    queryZonePolygons(unit, keys) {
      const spec = zoneUnitsFromBoot(boot).find((u) => u.unit === unit);
      if (!spec) return [];
      const wanted = new Set(keys.map(String));
      try {
        return handle.map.querySourceFeatures(zoneSourceId(unit), {
          sourceLayer: spec.sourceLayer,
          filter: ["in", ["get", zoneKeyProperty(unit)], ["literal", [...wanted]]] as never,
        }) as never;
      } catch {
        return []; // source not added/loaded yet — never a throw for a download click
      }
    },
  };
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
