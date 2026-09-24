import { describe, expect, it } from "vitest";
import {
  allZoneStats,
  paLabel,
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
  // P3 fix (owner-reported, 2026-09-24): "Program area selection should list full names and
  // parenthetical acronyms" -- every resolved zone name now carries its acronym in parens
  // (`paLabel`), never the bare name alone. Seeded fault: dropping the `paLabel` call here turns
  // this back into "St. George Basin, Western Gulf of Alaska" -- red.
  it("joins resolved 'Name (KEY)' labels with ', '", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "WGA"]);
    expect(zoneDisplayName(stats)).toBe("St. George Basin (GAA), Western Gulf of Alaska (WGA)");
  });

  it("a zone with no boot row falls back to the bare key, not 'ZZZ (ZZZ)'", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["ZZZ"]);
    expect(zoneDisplayName(stats)).toBe("ZZZ");
  });
});

describe("paLabel (P3: 'Aleutian Arc (ALA)' style labels everywhere a Program Area is shown)", () => {
  it("formats 'Name (KEY)' when a name is published", () => {
    expect(paLabel("ALA", "Aleutian Arc")).toBe("Aleutian Arc (ALA)");
  });

  it("falls back to the bare key when the bundle publishes no name", () => {
    expect(paLabel("ALA", undefined)).toBe("ALA");
    expect(paLabel("ALA", null)).toBe("ALA");
    expect(paLabel("ALA", "")).toBe("ALA");
  });

  it("falls back to the bare key rather than 'ALA (ALA)' when name already equals the key", () => {
    expect(paLabel("ALA", "ALA")).toBe("ALA");
  });
});

describe("allZoneStats (P3, orchestrator-directed 2026-09-24: the Places panel's 'Add a Program Area' chooser)", () => {
  // boot's OWN publish order is deliberately NOT alphabetical, so this proves the sort, not a
  // coincidence of the fixture's order.
  const UNSORTED_BOOT = {
    zones: {
      programarea: [
        { key: "WGA", name: "Western Gulf of Alaska", area_km2: 22000, composite: 21.1 },
        { key: "GAA", name: "St. George Basin", area_km2: 16850, composite: 33.9 },
        { key: "ZZZ", area_km2: 1 }, // no boot `name` -- falls back to the bare key
      ],
    },
  };

  it("returns every published zone, sorted by its resolved paLabel text (not boot's publish order)", () => {
    const stats = allZoneStats(UNSORTED_BOOT, "programarea");
    expect(stats.map((s) => paLabel(s.key, s.name))).toEqual([
      "St. George Basin (GAA)",
      "Western Gulf of Alaska (WGA)",
      "ZZZ",
    ]);
  });

  it("is [] for a unit the release does not publish, never a throw", () => {
    expect(allZoneStats(UNSORTED_BOOT, "ecoregion")).toEqual([]);
    expect(allZoneStats(null, "programarea")).toEqual([]);
    expect(allZoneStats({}, "programarea")).toEqual([]);
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
