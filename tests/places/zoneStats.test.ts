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
      {
        key: "ZZZ",
        name: "ZZZ",
        areaKm2: null,
        coveragePct: null,
        composite: null,
        status: "unpublished",
      },
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

  // P8 item 2: a composite-less summary is a permanent fact about the release ("unpublished"),
  // never silently indistinguishable from "not analysed yet" -- `Places.svelte`'s zone-row branch
  // reads this `status` to pick the honest chip.
  it("status is 'unpublished' when nothing is known", () => {
    expect(
      summarizeZoneStats([
        { key: "x", name: "x", areaKm2: null, coveragePct: null, composite: null },
      ]),
    ).toEqual({ areaKm2: null, coveragePct: null, composite: null, status: "unpublished" });
  });
});

// P8 item 2 (P7 handback + Opus docs review finding #27): the ORIGINAL fixture above (flat
// `composite`/`pct_covered` fields) is not what a real release publishes -- every Program-Area row
// was reading undefined fields and showing "not analysed yet" forever. This fixture is copied from
// the REAL live v7 `boot.json` (`s3://oceanmetrics.io-public/marine-atlas/v7/app/boot.json`,
// `zones.programarea[0]` and `[1]`, and the one `layers` row with `category: "composite"`), values
// verbatim.
const REAL_V7_BOOT = {
  layers: [
    { metric_key: "primprod", category: "raw" },
    { metric_key: "extrisk_bird_ecoregion_rescaled", category: "component" },
    {
      metric_key: "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
      label:
        "Combined score of extinction risk per species category and primary productivity, equally weighted",
      category: "composite",
    },
  ],
  zones: {
    programarea: [
      {
        key: "ALA",
        n_cells: 45790,
        area_km2: 875225.027218056,
        n_taxa: 2503,
        metrics: {
          extrisk_bird: 89.085250176649,
          extrisk_bird_ecoregion_rescaled: 42.3898340211856,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 28.2800625961801,
        },
        coverage: null,
      },
      {
        key: "ALB",
        n_cells: 10272,
        area_km2: 167874.54763979,
        n_taxa: 1222,
        metrics: {
          extrisk_bird: 47.1228117341986,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 12.2811149697871,
        },
        coverage: null,
      },
    ],
  },
};

describe("zoneStatFromBoot on the REAL v7 boot.json shape (P8 item 2)", () => {
  it("reads the composite NESTED under metrics[compositeMetricKey], not a flat `composite` field", () => {
    expect(zoneStatFromBoot(REAL_V7_BOOT, "programarea", "ALA")).toEqual({
      key: "ALA",
      name: "ALA", // v7 publishes no `name` on the row -- bare key (docs review finding #23)
      areaKm2: 875225.027218056,
      coveragePct: null, // `coverage: null` published explicitly -- "not published", read as null
      composite: 28.2800625961801,
    });
  });

  it("a second zone reads its OWN composite, not the first's", () => {
    expect(zoneStatFromBoot(REAL_V7_BOOT, "programarea", "ALB")?.composite).toBe(12.2811149697871);
  });

  it("status is 'unpublished' -- never 'not analysed yet' -- when metrics carries no composite key at all", () => {
    const noComposite = {
      layers: REAL_V7_BOOT.layers,
      zones: {
        programarea: [{ key: "ZZZ", area_km2: 1, metrics: { extrisk_bird: 1 }, coverage: null }],
      },
    };
    expect(zoneStatFromBoot(noComposite, "programarea", "ZZZ")).toEqual({
      key: "ZZZ",
      name: "ZZZ",
      areaKm2: 1,
      coveragePct: null,
      composite: null,
      status: "unpublished",
    });
  });

  it("a Program-Area row shows its composite AND coverage when both are actually present", () => {
    const withCoverage = {
      layers: REAL_V7_BOOT.layers,
      zones: {
        programarea: [
          {
            key: "GEO",
            area_km2: 100,
            pct_covered: 42.1,
            metrics: {
              score_extriskspcat_primprod_ecoregionrescaled_equalweights: 27.2,
            },
          },
        ],
      },
    };
    expect(zoneStatFromBoot(withCoverage, "programarea", "GEO")).toEqual({
      key: "GEO",
      name: "GEO",
      areaKm2: 100,
      coveragePct: 42.1,
      composite: 27.2,
    });
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
