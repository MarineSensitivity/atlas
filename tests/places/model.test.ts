import { describe, expect, it } from "vitest";
import {
  addPlace,
  addZonePlace,
  duplicatePlaceAt,
  fallbackZoneLabel,
  hashFromPlaces,
  isGeomOrUpload,
  MAX_PLACES,
  placesFromHash,
  removePlaceAt,
  renamePlaceAt,
  unitForZoneSet,
  zoneSetForUnit,
} from "../../src/places/model";
import type { GeomPlace, Place, ZonePlace } from "../../src/lib/geo/placeCodec";

const SQUARE: GeomPlace = {
  kind: "geom",
  name: "Square",
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
const ZONE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA"] };

describe("placesFromHash / hashFromPlaces", () => {
  it("round-trips a zone place through the hash", () => {
    const hash = hashFromPlaces([ZONE]);
    expect(hash).toBeDefined();
    expect(placesFromHash(hash)).toEqual([ZONE]);
  });

  it("an empty list clears the hash key (undefined, not '')", () => {
    expect(hashFromPlaces([])).toBeUndefined();
  });

  it("an absent hash decodes to zero places", () => {
    expect(placesFromHash(undefined)).toEqual([]);
  });

  it("an unreadable token is dropped, never thrown (decodePlaces' own contract)", () => {
    expect(placesFromHash("not.a.valid.token~z.pa.GAA")).toEqual([ZONE]);
  });
});

describe("addPlace: the 20-place cap (Deliverable 1)", () => {
  it("appends under the cap", () => {
    const r = addPlace([], ZONE);
    expect(r.ok).toBe(true);
    expect(r.places).toEqual([ZONE]);
  });

  it("refuses the 21st place, leaving the list unchanged", () => {
    const full: Place[] = Array.from({ length: MAX_PLACES }, () => ZONE);
    const r = addPlace(full, ZONE);
    expect(r.ok).toBe(false);
    expect(r.places).toHaveLength(MAX_PLACES);
    expect(r.reason).toMatch(/20/);
  });
});

describe("removePlaceAt", () => {
  it("removes exactly the index given, leaving the rest in order", () => {
    const list = [ZONE, SQUARE, { ...ZONE, keys: ["WGA"] }];
    expect(removePlaceAt(list, 1)).toEqual([ZONE, { ...ZONE, keys: ["WGA"] }]);
  });
});

describe("renamePlaceAt", () => {
  it("renames a geom place, clamped to 60 chars", () => {
    const r = renamePlaceAt([SQUARE], 0, "a".repeat(90));
    expect(r.ok).toBe(true);
    expect((r.places[0] as GeomPlace).name.length).toBeLessThanOrEqual(60);
  });

  it("refuses an empty name", () => {
    const r = renamePlaceAt([SQUARE], 0, "   ");
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([SQUARE]);
  });

  it("refuses to rename a zone place (no name field in the codec) and leaves it unchanged", () => {
    const r = renamePlaceAt([ZONE], 0, "My Areas");
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([ZONE]);
  });

  it("refuses an out-of-range index", () => {
    const r = renamePlaceAt([SQUARE], 5, "x");
    expect(r.ok).toBe(false);
  });
});

describe("duplicatePlaceAt", () => {
  it("appends a copy of a geom place with ' copy' suffixed", () => {
    const r = duplicatePlaceAt([SQUARE], 0);
    expect(r.ok).toBe(true);
    expect(r.places).toHaveLength(2);
    expect((r.places[1] as GeomPlace).name).toBe("Square copy");
    expect((r.places[1] as GeomPlace).geometry).toEqual(SQUARE.geometry);
  });

  it("refuses to duplicate a zone place", () => {
    const r = duplicatePlaceAt([ZONE], 0);
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([ZONE]);
  });

  it("respects the 20-place cap", () => {
    const full: Place[] = Array.from({ length: MAX_PLACES }, () => SQUARE);
    const r = duplicatePlaceAt(full, 0);
    expect(r.ok).toBe(false);
  });
});

describe("addZonePlace: the pick-mode / zones-table hook", () => {
  it("adds one new zone place carrying every picked key, deduplicated", () => {
    const r = addZonePlace([], "pa", ["GAA", "WGA", "GAA"]);
    expect(r.ok).toBe(true);
    expect(r.places).toEqual([{ kind: "zone", set: "pa", keys: ["GAA", "WGA"] }]);
  });

  it("refuses an empty pick", () => {
    const r = addZonePlace([], "pa", []);
    expect(r.ok).toBe(false);
  });
});

describe("isGeomOrUpload", () => {
  it("is true for geom and upload, false for zone", () => {
    expect(isGeomOrUpload(SQUARE)).toBe(true);
    expect(isGeomOrUpload({ kind: "upload", name: "x", digest: "0".repeat(8) })).toBe(true);
    expect(isGeomOrUpload(ZONE)).toBe(false);
  });
});

describe("fallbackZoneLabel", () => {
  it("joins the keys with ', '", () => {
    expect(fallbackZoneLabel({ kind: "zone", set: "pa", keys: ["GAA", "WGA"] })).toBe("GAA, WGA");
  });
});

describe("zoneSetForUnit / unitForZoneSet: the codec <-> boot.units mapping, inverse of each other", () => {
  it("maps every unit this app knows about", () => {
    expect(zoneSetForUnit("programarea")).toBe("pa");
    expect(zoneSetForUnit("planarea")).toBe("pl");
    expect(zoneSetForUnit("ecoregion")).toBe("er");
    expect(zoneSetForUnit("subregion")).toBe("sr");
    expect(zoneSetForUnit("nonsense")).toBeNull();
  });

  it("round-trips: unitForZoneSet(zoneSetForUnit(u)) === u for every known unit", () => {
    for (const u of ["programarea", "planarea", "ecoregion", "subregion"]) {
      const set = zoneSetForUnit(u);
      expect(set).not.toBeNull();
      expect(unitForZoneSet(set!)).toBe(u);
    }
  });
});
