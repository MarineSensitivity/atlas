import { describe, expect, it } from "vitest";
import {
  defaultLayerKey,
  layerByKey,
  layerGroups,
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
