// Q1 (atlas-8 P-round, 2026-09-24): red-first unit tests for the Scores lens' top-bar search --
// the pure matcher (`matchZones`) and coordinate parser (`parseCoordinateQuery`) behind
// `ScoresSearch.svelte`. Wiring (the `sel`/camera/popup writes) is covered by
// `e2e/scores.search.spec.ts`, the same split `state.svelte.ts`'s own `handleMapClick` already has
// (no unit test for the wiring itself, only for the pure logic it calls).
import { describe, expect, it } from "vitest";
import {
  formatCoordLabel,
  matchZones,
  parseCoordinateQuery,
  scoresSearch,
} from "../../../src/lens/scores/search";
import { BOOT_V1_PLANAREA, BOOT_V7 } from "./fixtures";

describe("matchZones", () => {
  it("exact key match (case-insensitive)", () => {
    expect(matchZones(BOOT_V7, "GAA")).toEqual([
      { kind: "zone", unit: "programarea", key: "GAA", label: "Gulf of America, Eastern (GAA)" },
    ]);
    expect(matchZones(BOOT_V7, "gaa")).toEqual(matchZones(BOOT_V7, "GAA"));
  });

  it("name substring match", () => {
    const m = matchZones(BOOT_V7, "gulf");
    expect(m.map((r) => (r.kind === "zone" ? r.key : null))).toContain("GAA");
  });

  it("an exact key match ranks ABOVE a substring name match containing the same text", () => {
    // "AK" is a subregion key; its own NAME is "Alaska" -- querying "AK" must not let some OTHER
    // zone's name-substring match (none here, but the ranking rule is what's under test) outrank
    // the exact key hit itself.
    const m = matchZones(BOOT_V7, "AK");
    expect(m[0]).toEqual({ kind: "zone", unit: "subregion", key: "AK", label: "Alaska (AK)" });
  });

  it("matches the release's other published zone archives too (subregion here) -- 'if the bundle has them'", () => {
    const m = matchZones(BOOT_V7, "alaska");
    expect(m).toEqual([{ kind: "zone", unit: "subregion", key: "AK", label: "Alaska (AK)" }]);
  });

  it("a key with no published name falls back to the bare key (paLabel's own rule)", () => {
    // BOOT_V1_PLANAREA's own `zones` carries no `planarea`/`programarea` rows at all -- only a
    // `subregion: [{key:"USA", name:"All US waters"}]` row survives the override.
    const m = matchZones(BOOT_V1_PLANAREA, "usa");
    expect(m).toEqual([
      { kind: "zone", unit: "subregion", key: "USA", label: "All US waters (USA)" },
    ]);
  });

  it("an unpublished unit / no match: [], never a throw", () => {
    expect(matchZones(BOOT_V7, "nonexistent-place")).toEqual([]);
    expect(matchZones(null, "GAA")).toEqual([]);
    expect(matchZones({}, "GAA")).toEqual([]);
  });

  it("a blank query matches nothing, never 'everything'", () => {
    expect(matchZones(BOOT_V7, "")).toEqual([]);
    expect(matchZones(BOOT_V7, "   ")).toEqual([]);
  });

  it("caps at `limit` (default 8)", () => {
    const boot = {
      zones: {
        programarea: Array.from({ length: 12 }, (_, i) => ({
          key: `Z${i}`,
          name: `Zone ${i}`,
          metrics: {},
        })),
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    expect(matchZones(boot, "zone")).toHaveLength(8);
    expect(matchZones(boot, "zone", 3)).toHaveLength(3);
  });
});

describe("parseCoordinateQuery", () => {
  it("default order: 'lon, lat'", () => {
    expect(parseCoordinateQuery("-140, 57")).toEqual({ lon: -140, lat: 57, swapped: false });
  });

  it("comma-less, whitespace-separated", () => {
    expect(parseCoordinateQuery("-140   57")).toEqual({ lon: -140, lat: 57, swapped: false });
  });

  it("inferred 'lat, lon' when the default reading's latitude is out of range", () => {
    // read as lon=57, lat=-140 the default way -- lat -140 is invalid, so this falls back to
    // lon=-140, lat=57 (the same point as "-140, 57" above, just typed the other way round).
    expect(parseCoordinateQuery("57, -140")).toEqual({ lon: -140, lat: 57, swapped: true });
  });

  it("an ambiguous pair (valid either way) keeps the 'lon, lat' default, no swap", () => {
    expect(parseCoordinateQuery("40, 50")).toEqual({ lon: 40, lat: 50, swapped: false });
  });

  it("explicit lat/lon labels win outright, in either order", () => {
    expect(parseCoordinateQuery("lat 57, lon -140")).toEqual({ lon: -140, lat: 57, swapped: true });
    expect(parseCoordinateQuery("lon: -140 lat: 57")).toEqual({
      lon: -140,
      lat: 57,
      swapped: true,
    });
    expect(parseCoordinateQuery("latitude=57, longitude=-140")).toEqual({
      lon: -140,
      lat: 57,
      swapped: true,
    });
  });

  it("out of range under BOTH readings: null", () => {
    expect(parseCoordinateQuery("200, 200")).toBeNull();
  });

  it("not exactly two numbers: null", () => {
    expect(parseCoordinateQuery("-124.5, 40.0, -123.0")).toBeNull();
    expect(parseCoordinateQuery("-140")).toBeNull();
  });

  it("not numeric: null", () => {
    expect(parseCoordinateQuery("Aleutian Arc")).toBeNull();
    expect(parseCoordinateQuery("abc, 57")).toBeNull();
  });

  it("empty/whitespace: null", () => {
    expect(parseCoordinateQuery("")).toBeNull();
    expect(parseCoordinateQuery("   ")).toBeNull();
  });

  it("decimals parse", () => {
    expect(parseCoordinateQuery("-140.25, 57.5")).toEqual({
      lon: -140.25,
      lat: 57.5,
      swapped: false,
    });
  });
});

describe("formatCoordLabel", () => {
  it("default order reads 'lon, lat'", () => {
    expect(formatCoordLabel({ lon: -140, lat: 57, swapped: false })).toBe(
      "Fly to lon -140.00, lat 57.00",
    );
  });

  it("swapped order says so", () => {
    expect(formatCoordLabel({ lon: -140, lat: 57, swapped: true })).toBe(
      "Fly to lat 57.00, lon -140.00",
    );
  });
});

describe("scoresSearch", () => {
  it("a coordinate parses first, ahead of any zone text match", () => {
    const results = scoresSearch(BOOT_V7, "-140, 57");
    expect(results[0]).toEqual({
      kind: "coord",
      lon: -140,
      lat: 57,
      label: "Fly to lon -140.00, lat 57.00",
    });
  });

  it("falls through to zone matches when the text is not a coordinate", () => {
    const results = scoresSearch(BOOT_V7, "GAA");
    expect(results).toEqual([
      { kind: "zone", unit: "programarea", key: "GAA", label: "Gulf of America, Eastern (GAA)" },
    ]);
  });

  it("caps the COMBINED list at `limit`", () => {
    const boot = {
      zones: {
        programarea: Array.from({ length: 12 }, (_, i) => ({
          key: `Z${i}`,
          name: `Zone ${i}`,
          metrics: {},
        })),
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    expect(scoresSearch(boot, "zone", 5)).toHaveLength(5);
  });
});
