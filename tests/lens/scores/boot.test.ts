import { describe, expect, it } from "vitest";
import {
  defaultLayerKey,
  ecoregionZoneUnitFromManifest,
  flowerMaxComponentScore,
  layerByKey,
  layerGroups,
  metricLabelsFromManifest,
  primaryUnitLabel,
  primaryUnitNote,
  primaryUnitType,
  unitOptions,
  zoneAllKey,
  zoneRows,
} from "../../../src/lens/scores/boot";
import { BOOT_V1_PLANAREA, BOOT_V7 } from "./fixtures";

describe("primaryUnitType / primaryUnitLabel (D17: exactly one boot.units row)", () => {
  it("v7: programarea", () => {
    expect(primaryUnitType(BOOT_V7)).toBe("programarea");
    expect(primaryUnitLabel(BOOT_V7)).toBe("Program areas");
  });

  it("v1: planarea", () => {
    expect(primaryUnitType(BOOT_V1_PLANAREA)).toBe("planarea");
  });

  it("no units published: null, never a throw", () => {
    expect(primaryUnitType({})).toBeNull();
    expect(primaryUnitType(null)).toBeNull();
  });
});

describe("unitOptions", () => {
  it("cell first, then the release's one unit", () => {
    expect(unitOptions(BOOT_V7)).toEqual([
      { value: "cell", label: "Raster cells (0.05°)" },
      { value: "programarea", label: "Program areas" },
    ]);
  });

  it("cell only when no unit is published", () => {
    expect(unitOptions({})).toEqual([{ value: "cell", label: "Raster cells (0.05°)" }]);
  });
});

describe("primaryUnitNote", () => {
  it("v1 predates Program Areas: the note names the release and the label", () => {
    expect(primaryUnitNote(BOOT_V1_PLANAREA, "v1")).toBe(
      "v1 predates the BOEM Program Areas — it reports on Planning areas.",
    );
  });

  it("v7 already reports on programarea: no note", () => {
    expect(primaryUnitNote(BOOT_V7, "v7")).toBeNull();
  });

  it("no unit published: no note (nothing to caveat)", () => {
    expect(primaryUnitNote({}, "v0")).toBeNull();
  });
});

describe("layerGroups / defaultLayerKey", () => {
  it("groups composite, component, raw — each sorted by order", () => {
    const groups = layerGroups(BOOT_V7);
    expect(groups.map((g) => g.category)).toEqual(["composite", "component", "raw"]);
    const component = groups.find((g) => g.category === "component")!;
    expect(component.layers.map((l) => l.metric_key)).toEqual([
      "extrisk_bird_ecoregion_rescaled",
      "extrisk_other_ecoregion_rescaled",
    ]);
  });

  it("the default layer is the composite row, never boot.layers[0] (which is order 1 = raw)", () => {
    expect(defaultLayerKey(BOOT_V7)).toBe(
      "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
    );
  });

  it("no composite row: null, never a guess", () => {
    expect(
      defaultLayerKey({ layers: [{ metric_key: "x", category: "raw", order: 1 }] }),
    ).toBeNull();
  });
});

describe("layerByKey", () => {
  it("finds a real key", () => {
    expect(layerByKey(BOOT_V7, "primprod")?.category).toBe("raw");
  });

  it("unknown/undefined key: null, never a throw (an unknown ?lyr= must fall back)", () => {
    expect(layerByKey(BOOT_V7, "not-a-real-key")).toBeNull();
    expect(layerByKey(BOOT_V7, undefined)).toBeNull();
    expect(layerByKey(BOOT_V7, null)).toBeNull();
  });
});

describe("zoneAllKey", () => {
  it("prefers FULL when present among subregion keys", () => {
    expect(zoneAllKey(BOOT_V7)).toBe("FULL");
  });

  it("falls back to USA when FULL is absent (v1's subregion keys)", () => {
    expect(zoneAllKey(BOOT_V1_PLANAREA)).toBe("USA");
  });

  it("falls back to the literal USA when there is no subregion unit at all", () => {
    expect(zoneAllKey({})).toBe("USA");
  });
});

describe("zoneRows", () => {
  it("reads every zone of a unit with its metrics", () => {
    const rows = zoneRows(BOOT_V7, "programarea");
    expect(rows.map((r) => r.key)).toEqual(["GAA", "GEO"]);
    expect(rows[0].metrics.extrisk_bird_ecoregion_rescaled).toBeCloseTo(59.09);
  });

  it("an unpublished unit: [], never a throw", () => {
    expect(zoneRows(BOOT_V7, "ecoregion")).toEqual([]);
  });
});

// R3 orchestrator audit item 2: the standalone ecoregion outline, read from the release's
// MANIFEST (never `boot.units[]`, which D17 keeps at exactly one row) -- verified live against
// v7's real manifest.json (`zones[]` carries a `zone_set_key: "ecoregion_2025-06"` row).
describe("ecoregionZoneUnitFromManifest", () => {
  const MANIFEST_WITH_ECOREGION = {
    zones: [
      {
        tbl: "ply_ecoregions_2025",
        fld: "ecoregion_key",
        n: 12,
        zone_set_key: "ecoregion_2025-06",
        pmtiles: "https://s3.example/marine-atlas/zones/ecoregion_2025-06/zones.pmtiles",
      },
      {
        tbl: "ply_programareas_2026_v7",
        fld: "programarea_key",
        n: 20,
        zone_set_key: "programarea_2026-01",
        pmtiles: "https://s3.example/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
      },
    ],
  };

  it("finds the ecoregion row among several, and it is outline-only + always visible", () => {
    expect(ecoregionZoneUnitFromManifest(MANIFEST_WITH_ECOREGION)).toEqual({
      unit: "ecoregion",
      pmtiles: "https://s3.example/marine-atlas/zones/ecoregion_2025-06/zones.pmtiles",
      sourceLayer: "ecoregion",
      lineVisible: true,
    });
  });

  it("no fill, no labels, no highlightKey -- never a second choropleth-selectable unit (D17)", () => {
    const unit = ecoregionZoneUnitFromManifest(MANIFEST_WITH_ECOREGION)!;
    expect(unit.fill).toBeUndefined();
    expect(unit.labels).toBeUndefined();
    expect(unit.highlightKey).toBeUndefined();
  });

  it("null when the manifest has no zones array, no ecoregion row, or has not loaded yet", () => {
    expect(ecoregionZoneUnitFromManifest(null)).toBeNull();
    expect(ecoregionZoneUnitFromManifest(undefined)).toBeNull();
    expect(ecoregionZoneUnitFromManifest({})).toBeNull();
    expect(
      ecoregionZoneUnitFromManifest({
        zones: [MANIFEST_WITH_ECOREGION.zones[1]], // programarea only
      }),
    ).toBeNull();
  });

  it("a malformed ecoregion row (missing pmtiles) is skipped, never thrown", () => {
    expect(() =>
      ecoregionZoneUnitFromManifest({ zones: [{ fld: "ecoregion_key" }] }),
    ).not.toThrow();
    expect(ecoregionZoneUnitFromManifest({ zones: [{ fld: "ecoregion_key" }] })).toBeNull();
  });
});

// R3 orchestrator audit item 3: `boot.layers[].label` carries the LONG description (verified live
// on v7: `primprod`'s is a full paragraph), while the ported Shiny app's SHORT names ("fish: ext.
// risk, ecorgn") come from the manifest's `metrics[]` array instead.
describe("metricLabelsFromManifest", () => {
  const MANIFEST_WITH_METRICS = {
    metrics: [
      {
        metric_key: "extrisk_bird",
        subregion_key: "GA",
        label: "bird: ext. risk",
        description: "Extinction risk for bird",
      },
      {
        metric_key: "extrisk_bird",
        subregion_key: "FULL",
        label: "bird: ext. risk",
        description: "Extinction risk for bird",
      },
      { metric_key: "primprod", subregion_key: "FULL", label: "primary productivity" },
    ],
  };

  it("dedupes to one short label per metric_key (first occurrence wins)", () => {
    expect(metricLabelsFromManifest(MANIFEST_WITH_METRICS)).toEqual({
      extrisk_bird: "bird: ext. risk",
      primprod: "primary productivity",
    });
  });

  it("{} when the manifest has no metrics array or has not loaded yet", () => {
    expect(metricLabelsFromManifest(null)).toEqual({});
    expect(metricLabelsFromManifest({})).toEqual({});
  });

  it("a row missing metric_key or label is skipped, never thrown", () => {
    expect(() =>
      metricLabelsFromManifest({ metrics: [{ label: "no key" }, { metric_key: "no_label" }] }),
    ).not.toThrow();
    expect(
      metricLabelsFromManifest({ metrics: [{ label: "no key" }, { metric_key: "no_label" }] }),
    ).toEqual({});
  });
});

// P round deliverable 2 (Ben, live-review 2026-09-24): the flower panel's reference-ring value --
// see flowerGeometry.ts's own `computeFlowerReferenceRing` header for why "component" (never
// "composite"/"raw") is the right category to scan.
describe("flowerMaxComponentScore", () => {
  it("BOOT_V7's own two component rows both rescale to 100: the max is 100", () => {
    expect(flowerMaxComponentScore(BOOT_V7)).toBe(100);
  });

  it("a release whose component layers publish DIFFERENT maxima: the greatest one wins", () => {
    const boot = {
      ...BOOT_V7,
      layers: BOOT_V7.layers.map((l) =>
        l.metric_key === "extrisk_bird_ecoregion_rescaled"
          ? { ...l, by_subregion: { FULL: { ...l.by_subregion.FULL, rescale: [0, 93.456] } } }
          : l,
      ),
    };
    // "other" is untouched (rescale [0,100]) -- 100 still wins over 93.456, proving this is a real
    // MAX across rows, not "whichever row happens to be scanned last".
    expect(flowerMaxComponentScore(boot)).toBe(100);
    const bootLowered = {
      ...boot,
      layers: boot.layers.map((l) =>
        l.metric_key === "extrisk_other_ecoregion_rescaled"
          ? { ...l, by_subregion: { FULL: { ...l.by_subregion.FULL, rescale: [0, 80] } } }
          : l,
      ),
    };
    expect(flowerMaxComponentScore(bootLowered)).toBe(93.456);
  });

  it("no component layer publishes a rescale (every real release TODAY): null, never a guess", () => {
    // mirrors e2e/scores-hermetic.ts's real `bootFor('v7')`/`bootFor('v9')`: only the COMPOSITE row
    // carries `by_subregion` there -- component rows have none at all.
    expect(
      flowerMaxComponentScore({
        layers: [
          { metric_key: "a", category: "component", order: 1 },
          {
            metric_key: "score",
            category: "composite",
            order: 2,
            by_subregion: { FULL: { rescale: [0, 96] } },
          },
        ],
      }),
    ).toBeNull();
  });

  it("no layers/boot at all: null, never a throw", () => {
    expect(flowerMaxComponentScore({})).toBeNull();
    expect(flowerMaxComponentScore(null)).toBeNull();
  });
});
