import { describe, expect, it } from "vitest";
import { zoneRows } from "../../../src/lens/scores/boot";
import {
  cellFlowerComponents,
  componentLabel,
  dedupeFlowerComponents,
  defaultFlowerComponents,
  flowerTitle,
  zoneFlowerComponents,
} from "../../../src/lens/scores/flower";
import { computeFlowerGeometry } from "../../../src/lib/ui/flowerGeometry";
import { BOOT_V7, BOOT_V1_PLANAREA, BOOT_V9 } from "./fixtures";

describe("componentLabel", () => {
  it("strips extrisk_ and _ecoregion_rescaled, underscores to spaces", () => {
    expect(componentLabel("extrisk_bird_ecoregion_rescaled")).toBe("bird");
    expect(componentLabel("extrisk_primary_producer_ecoregion_rescaled")).toBe("primary producer");
    expect(componentLabel("primprod_ecoregion_rescaled")).toBe("primprod");
  });
});

describe("zoneFlowerComponents", () => {
  it("reads the zone's own ecoregion-rescaled metrics", () => {
    const rows = zoneRows(BOOT_V7, "programarea");
    const flower = zoneFlowerComponents(rows, "GAA")!;
    expect(flower.components).toEqual(
      expect.arrayContaining([
        { key: "bird", score: 59.09 },
        { key: "other", score: 25.54 },
      ]),
    );
    expect(flower.droppedLabels).toEqual([]);
  });

  it("an unknown zone key: null", () => {
    expect(zoneFlowerComponents(zoneRows(BOOT_V7, "programarea"), "NOPE")).toBeNull();
  });

  // atlas-4 fix round 2: v9's GAA zone publishes BOTH `extrisk_primary_producer_ecoregion_rescaled`
  // (the ER-weighted species-category term) and `primprod_ecoregion_rescaled` (the bare
  // environmental twin) -- both fold onto the SAME "primprod" category (categories.ts SYNONYMS),
  // so `computeFlowerGeometry` would throw on the raw 8-entry list (tests/ui/flowerGeometry.test.ts
  // pins that throw for exactly this pair). `zoneFlowerComponents` must have already resolved it to
  // 7, keeping the species-category ("primary producer") term and dropping the bare "primprod" one.
  describe("v9's GAA zone (real 8-key collision)", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V9, "programarea"), "GAA")!;

    it("de-duplicates to exactly 7 components, keeping the extrisk_* (species-category) term", () => {
      expect(flower.components).toHaveLength(7);
      expect(flower.components.map((c) => c.key)).toContain("primary producer");
      expect(flower.components.map((c) => c.key)).not.toContain("primprod");
      expect(flower.droppedLabels).toEqual(["primprod"]);
    });

    it("computeFlowerGeometry does not throw on the de-duplicated 7 and draws 7 petals", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(7);
      const mean =
        flower.components.reduce((sum, c) => sum + (c.score ?? 0), 0) / flower.components.length;
      expect(Math.round(g.centerValue!)).toBe(Math.round(mean));
    });

    it("SEEDED FAULT (manual gate, not committed): the raw un-deduplicated 8 still throws", () => {
      // proves the fix is load-bearing -- `dedupeFlowerComponents` is what stands between this
      // zone's real data and computeFlowerGeometry's collision guard.
      const rawEight = zoneRows(BOOT_V9, "programarea").find((z) => z.key === "GAA")!.metrics;
      const undeduped = Object.entries(rawEight)
        .filter(([k]) => /_ecoregion_rescaled$/.test(k))
        .map(([k, score]) => ({ key: componentLabel(k), score }));
      expect(undeduped).toHaveLength(8);
      expect(() => computeFlowerGeometry(undeduped)).toThrow(/both resolve to category/);
    });
  });
});

describe("defaultFlowerComponents", () => {
  it("reads boot.flower_default[zoneAllKey]", () => {
    expect(defaultFlowerComponents(BOOT_V7, "FULL")!.components).toEqual([
      { key: "bird", score: 45.67 },
      { key: "other", score: 15.18 },
      { key: "primprod", score: 10.38 },
    ]);
  });

  it("v1 (no flower_default published at all): null, never an empty flower masquerading as data", () => {
    expect(defaultFlowerComponents(BOOT_V1_PLANAREA, "USA")).toBeNull();
  });

  // the exact live shape (curl'd from v9/app/boot.json, orchestrator-verified 2026-09-22):
  // flower_default.AK has 8 rows, "primary producer" and "primprod" both present.
  describe("v9's flower_default.AK (real 8-key collision)", () => {
    const flower = defaultFlowerComponents(BOOT_V9, "AK")!;

    it("de-duplicates to exactly 7 components, dropping the bare primprod twin", () => {
      expect(flower.components).toHaveLength(7);
      expect(flower.components.map((c) => c.key)).toEqual([
        "bird",
        "coral",
        "fish",
        "invertebrate",
        "mammal",
        "primary producer",
        "turtle",
      ]);
      expect(flower.droppedLabels).toEqual(["primprod"]);
    });

    it("computeFlowerGeometry draws 7 petals with centre = round(mean of those 7)", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(7);
      const mean =
        flower.components.reduce((sum, c) => sum + (c.score ?? 0), 0) / flower.components.length;
      expect(Math.round(g.centerValue!)).toBe(Math.round(mean));
      expect(Math.round(g.centerValue!)).toBe(22); // (31.58+16.73+18.97+22.84+27.91+15.51+18.39)/7 = 21.705...
    });

    it("SEEDED FAULT (manual gate, not committed): the raw un-deduplicated 8 rows still throw", () => {
      const raw = (BOOT_V9.flower_default.AK as { component: string; score: number }[]).map(
        (r) => ({ key: r.component, score: r.score }),
      );
      expect(raw).toHaveLength(8);
      expect(() => computeFlowerGeometry(raw)).toThrow(/both resolve to category/);
    });
  });
});

describe("dedupeFlowerComponents", () => {
  it("keeps the `preferred` candidate on a category collision, in original input order", () => {
    const result = dedupeFlowerComponents([
      { key: "primary producer", score: 15.5, preferred: true },
      { key: "primprod", score: 5.6, preferred: false },
    ]);
    expect(result.components).toEqual([{ key: "primary producer", score: 15.5 }]);
    expect(result.droppedLabels).toEqual(["primprod"]);
  });

  it("never drops a component whose category is unrecognized (several nodata labels is ordinary data)", () => {
    const result = dedupeFlowerComponents([
      { key: "unknown-a", score: 1, preferred: false },
      { key: "unknown-b", score: 2, preferred: false },
    ]);
    expect(result.components).toHaveLength(2);
    expect(result.droppedLabels).toEqual([]);
  });

  it("passes through a normal, collision-free set unchanged", () => {
    const result = dedupeFlowerComponents([
      { key: "bird", score: 10, preferred: true },
      { key: "fish", score: 20, preferred: false },
    ]);
    expect(result.components).toEqual([
      { key: "bird", score: 10 },
      { key: "fish", score: 20 },
    ]);
    expect(result.droppedLabels).toEqual([]);
  });
});

describe("cellFlowerComponents", () => {
  it("drops component=all and passes val through as score", () => {
    const rows = [
      { metric_key: "extrisk_bird_ecoregion_rescaled", val: 10, component: "bird" },
      { metric_key: "extrisk_all_ecoregion_rescaled", val: 99, component: "all" },
      { metric_key: "extrisk_fish_ecoregion_rescaled", val: null, component: "fish" },
    ];
    const result = cellFlowerComponents(rows);
    expect(result.components).toEqual([
      { key: "bird", score: 10 },
      { key: "fish", score: null },
    ]);
    expect(result.droppedLabels).toEqual([]);
  });

  it("v8/v9 cell click: de-duplicates the extrisk_primary_producer/primprod pair the same way", () => {
    const rows = [
      { metric_key: "extrisk_bird_ecoregion_rescaled", val: 40, component: "bird" },
      {
        metric_key: "extrisk_primary_producer_ecoregion_rescaled",
        val: 17.5,
        component: "primary producer",
      },
      { metric_key: "primprod_ecoregion_rescaled", val: 10.8, component: "primprod" },
    ];
    const result = cellFlowerComponents(rows);
    expect(result.components).toEqual([
      { key: "bird", score: 40 },
      { key: "primary producer", score: 17.5 },
    ]);
    expect(result.droppedLabels).toEqual(["primprod"]);
  });
});

describe("flowerTitle", () => {
  it("cell: id + coords to 3 dp", () => {
    expect(flowerTitle({ kind: "cell", cellId: 42, lon: -90.12345, lat: 27.6789 })).toBe(
      "Cell ID: 42 (x: -90.123, y: 27.679)",
    );
  });

  it("zone: its own name", () => {
    expect(flowerTitle({ kind: "zone", name: "Gulf of America, Eastern" })).toBe(
      "Gulf of America, Eastern",
    );
  });

  it("nothing selected: Full study area", () => {
    expect(flowerTitle(null)).toBe("Full study area");
  });
});
