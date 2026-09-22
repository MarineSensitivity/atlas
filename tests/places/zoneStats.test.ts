import { describe, expect, it } from "vitest";
import {
  summarizeZoneStats,
  zoneCenterFromBoot,
  zoneDisplayName,
  zoneStatFromBoot,
  zoneStatsFor,
} from "../../src/places/zoneStats";

const BOOT = {
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "St. George Basin",
        area_km2: 16850,
        pct_covered: 100,
        composite: 33.9,
        label_pt: [188.5, 56.6],
      },
      { key: "WGA", name: "Western Gulf of Alaska", area_km2: 22000, composite: 21.1 },
    ],
  },
};

describe("zoneStatFromBoot", () => {
  it("reads a row's numbers, tolerant of a `coverage` alias and a `score` alias", () => {
    expect(zoneStatFromBoot(BOOT, "programarea", "GAA")).toEqual({
      key: "GAA",
      name: "St. George Basin",
      areaKm2: 16850,
      coveragePct: 100,
      composite: 33.9,
    });
  });

  it("returns null for a key the release doesn't publish", () => {
    expect(zoneStatFromBoot(BOOT, "programarea", "ZZZ")).toBeNull();
  });

  it("returns null for an absent unit or a boot with no zones at all", () => {
    expect(zoneStatFromBoot(BOOT, "ecoregion", "GAA")).toBeNull();
    expect(zoneStatFromBoot(null, "programarea", "GAA")).toBeNull();
    expect(zoneStatFromBoot({}, "programarea", "GAA")).toBeNull();
  });
});

describe("zoneStatsFor", () => {
  it("keeps every key in order, even one with no boot row (name falls back to the key, numbers null)", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "ZZZ"]);
    expect(stats).toEqual([
      { key: "GAA", name: "St. George Basin", areaKm2: 16850, coveragePct: 100, composite: 33.9 },
      { key: "ZZZ", name: "ZZZ", areaKm2: null, coveragePct: null, composite: null },
    ]);
  });
});

describe("summarizeZoneStats", () => {
  it("sums area, means composite/coverage over the KNOWN values only", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "WGA"]);
    expect(summarizeZoneStats(stats)).toEqual({
      areaKm2: 16850 + 22000,
      coveragePct: 100, // WGA has none -- the mean is over GAA alone
      composite: (33.9 + 21.1) / 2,
    });
  });

  it("every field is null when nothing is known", () => {
    expect(
      summarizeZoneStats([
        { key: "x", name: "x", areaKm2: null, coveragePct: null, composite: null },
      ]),
    ).toEqual({ areaKm2: null, coveragePct: null, composite: null });
  });
});

describe("zoneDisplayName", () => {
  it("joins resolved names with ', '", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "WGA"]);
    expect(zoneDisplayName(stats)).toBe("St. George Basin, Western Gulf of Alaska");
  });
});

describe("zoneCenterFromBoot", () => {
  it("is the mean of the picked keys' label points (zoneLabelsFromBoot's own -180..180 rewrap)", () => {
    // label_pt is cached 0-360 (map/layers/zones.ts); 188.5 comes back as 188.5 - 360 = -171.5.
    expect(zoneCenterFromBoot(BOOT, "programarea", ["GAA"])).toEqual({ lon: -171.5, lat: 56.6 });
  });

  it("is null when the unit has no labels at all", () => {
    expect(zoneCenterFromBoot(BOOT, "ecoregion", ["GAA"])).toBeNull();
  });

  it("is null when none of the picked keys has a label point", () => {
    expect(zoneCenterFromBoot(BOOT, "programarea", ["WGA"])).toBeNull();
  });
});
