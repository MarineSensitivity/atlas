import { describe, expect, it } from "vitest";
import { zoneRows } from "../../../src/lens/scores/boot";
import {
  cellFlowerComponents,
  componentLabel,
  defaultFlowerComponents,
  flowerTitle,
  zoneFlowerComponents,
} from "../../../src/lens/scores/flower";
import { BOOT_V7, BOOT_V1_PLANAREA } from "./fixtures";

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
    expect(flower).toEqual(
      expect.arrayContaining([
        { key: "bird", score: 59.09 },
        { key: "other", score: 25.54 },
      ]),
    );
  });

  it("an unknown zone key: null", () => {
    expect(zoneFlowerComponents(zoneRows(BOOT_V7, "programarea"), "NOPE")).toBeNull();
  });
});

describe("defaultFlowerComponents", () => {
  it("reads boot.flower_default[zoneAllKey]", () => {
    expect(defaultFlowerComponents(BOOT_V7, "FULL")).toEqual([
      { key: "bird", score: 45.67 },
      { key: "other", score: 15.18 },
      { key: "primprod", score: 10.38 },
    ]);
  });

  it("v1 (no flower_default published at all): null, never an empty flower masquerading as data", () => {
    expect(defaultFlowerComponents(BOOT_V1_PLANAREA, "USA")).toBeNull();
  });
});

describe("cellFlowerComponents", () => {
  it("drops component=all and passes val through as score", () => {
    const rows = [
      { metric_key: "extrisk_bird_ecoregion_rescaled", val: 10, component: "bird" },
      { metric_key: "extrisk_all_ecoregion_rescaled", val: 99, component: "all" },
      { metric_key: "extrisk_fish_ecoregion_rescaled", val: null, component: "fish" },
    ];
    expect(cellFlowerComponents(rows)).toEqual([
      { key: "bird", score: 10 },
      { key: "fish", score: null },
    ]);
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
