import { describe, expect, it } from "vitest";
import { parseSel } from "../../../src/lib/state/codec";
import { DEFAULT_SEL } from "../../../src/lib/state/types";
import {
  csvFilename,
  formatAreaKm2,
  formatPercent0,
  formatPercent2,
  modelHref,
  modelSelPatch,
  speciesFilenameStem,
  speciesHeader,
  taxonUrl,
  unitSingularLabel,
} from "../../../src/lens/scores/species";

describe("unitSingularLabel", () => {
  it("programarea / planarea: the pinned literals", () => {
    expect(unitSingularLabel("programarea", "Program areas")).toBe("Program Area");
    expect(unitSingularLabel("planarea", "Planning areas")).toBe("Planning Area");
  });

  it("an unrecognized unit: singularized from its own boot label", () => {
    expect(unitSingularLabel("ecoregion", "Ecoregions")).toBe("Ecoregion");
  });
});

describe("speciesHeader", () => {
  it("cell clicked", () => {
    expect(
      speciesHeader({
        selection: { kind: "cell", cellId: 42 },
        unit: "cell",
        unitLabel: null,
        zoneAllKey: "USA",
      }),
    ).toBe("Species for Cell ID: 42");
  });

  it("zone clicked (programarea)", () => {
    expect(
      speciesHeader({
        selection: { kind: "zone", unit: "programarea", key: "GAA" },
        zoneName: "Gulf of America, Eastern",
        unit: "programarea",
        unitLabel: "Program areas",
        zoneAllKey: "USA",
      }),
    ).toBe("Species for Program Area: Gulf of America, Eastern");
  });

  it("nothing selected", () => {
    expect(
      speciesHeader({ selection: null, unit: "cell", unitLabel: null, zoneAllKey: "USA" }),
    ).toBe("Species in Full study area");
  });
});

describe("speciesFilenameStem", () => {
  it("cell: species_cellid-{id}", () => {
    expect(
      speciesFilenameStem({
        selection: { kind: "cell", cellId: 42 },
        unit: "cell",
        unitLabel: null,
        zoneAllKey: "USA",
      }),
    ).toBe("species_cellid-42");
  });

  it("zone: species_{unit}-{lowercased name, first space -> '-'}", () => {
    expect(
      speciesFilenameStem({
        selection: { kind: "zone", unit: "programarea", key: "GAA" },
        zoneName: "Gulf of America",
        unit: "programarea",
        unitLabel: "Program areas",
        zoneAllKey: "USA",
      }),
    ).toBe("species_programarea-gulf-of america");
  });

  it("a single-word name: no space to replace", () => {
    expect(
      speciesFilenameStem({
        selection: { kind: "zone", unit: "programarea", key: "BFT" },
        zoneName: "Beaufort",
        unit: "programarea",
        unitLabel: "Program areas",
        zoneAllKey: "USA",
      }),
    ).toBe("species_programarea-beaufort");
  });

  it("nothing selected: species_{zone_all_key}", () => {
    expect(
      speciesFilenameStem({ selection: null, unit: "cell", unitLabel: null, zoneAllKey: "USA" }),
    ).toBe("species_USA");
  });
});

describe("csvFilename", () => {
  it("stem_YYYY-MM-DD.csv", () => {
    expect(csvFilename("species_USA", new Date("2026-09-22T12:00:00Z"))).toBe(
      "species_USA_2026-09-22.csv",
    );
  });
});

describe("formatPercent0 / formatPercent2 / formatAreaKm2", () => {
  it("er_score: 0dp percent", () => {
    expect(formatPercent0(0.5)).toBe("50%");
    expect(formatPercent0(1)).toBe("100%");
    expect(formatPercent0(null)).toBe("");
  });

  it("avg_suit/pct_cat: 2dp percent", () => {
    expect(formatPercent2(0.12345)).toBe("12.35%");
  });

  it("area_km2: 4 significant figures", () => {
    expect(formatAreaKm2(382002.544334317)).toBe("382,000");
    expect(formatAreaKm2(0)).toBe("0");
    expect(formatAreaKm2(null)).toBe("");
  });
});

describe("taxonUrl", () => {
  it("BOTW authority -> birdsoftheworld.org", () => {
    expect(taxonUrl("botw", "123")).toBe("https://birdsoftheworld.org");
    expect(taxonUrl("BOTW", "123")).toBe("https://birdsoftheworld.org");
  });

  it("anything else -> WoRMS aphia.php", () => {
    expect(taxonUrl("worms", "137209")).toBe(
      "https://www.marinespecies.org/aphia.php?p=taxdetails&id=137209",
    );
  });
});

describe("model link", () => {
  it("modelSelPatch switches lens + sp + in=merged, resets out to the species default", () => {
    expect(modelSelPatch("ms_merge|WORMS:137209")).toEqual({
      lens: "species",
      sp: "ms_merge|WORMS:137209",
      in: "merged",
      out: "none",
    });
  });

  it("modelHref keeps place/camera, resolves to the species lens with the given sp", () => {
    const href = modelHref({ ...DEFAULT_SEL, area: "GA" }, "ms_merge|WORMS:137209");
    // "lens=species" need not appear literally: state/codec.ts's formatSel infers the species lens
    // as the DEFAULT once `sp` is set (defaultLens()) and omits an already-default value.
    const parsed = parseSel({ search: href, hash: "" });
    expect(parsed.lens).toBe("species");
    expect(parsed.sp).toBe("ms_merge|WORMS:137209");
    expect(parsed.area).toBe("GA");
  });
});
