import { describe, expect, it } from "vitest";
import { placesToGeoJson } from "../../src/places/download";
import type { GeomPlace, Place, UploadPlace, ZonePlace } from "../../src/lib/geo/placeCodec";

const GEOM: GeomPlace = {
  kind: "geom",
  name: "My Draw",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    ],
  },
};
const ZONE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA", "WGA"] };
const UPLOAD: UploadPlace = { kind: "upload", name: "Too Big", digest: "deadbeef" };

describe("placesToGeoJson: the DECODED geometries actually analysed (Deliverable 1)", () => {
  it("a geom place carries its real geometry, unmodified", () => {
    const fc = placesToGeoJson([GEOM]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry).toEqual(GEOM.geometry);
    expect(fc.features[0].properties).toEqual({ kind: "geom", name: "My Draw" });
  });

  it("a zone place has no geometry client-side (RFC 7946 allows `geometry: null`) but names its keys", () => {
    const fc = placesToGeoJson([ZONE]);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties).toMatchObject({
      kind: "zone",
      set: "pa",
      keys: ["GAA", "WGA"],
    });
  });

  it("an upload place (too large for the link) is a null-geometry stub naming the digest", () => {
    const fc = placesToGeoJson([UPLOAD]);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties).toMatchObject({
      kind: "upload",
      name: "Too Big",
      digest: "deadbeef",
    });
  });

  it("one Feature per place, in order", () => {
    const places: Place[] = [GEOM, ZONE, UPLOAD];
    expect(placesToGeoJson(places).features).toHaveLength(3);
  });

  it("an empty list is an empty FeatureCollection", () => {
    expect(placesToGeoJson([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});
