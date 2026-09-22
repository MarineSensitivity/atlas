import { describe, expect, it } from "vitest";
import { scoresMapInputs } from "../../../src/lens/scores/mapInputs";
import { defaultLayerKey } from "../../../src/lens/scores/boot";
import { BOOT_V7, MANIFEST_OVERLAYS_V7 } from "./fixtures";

describe("scoresMapInputs — cell branch", () => {
  it("raster + overlay populated, zones outline-only (no fill)", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.raster?.id).toBe("r_lyr");
    expect(out.overlays).toHaveLength(1);
    expect(out.zones[0].fill).toBeUndefined();
    expect(out.selection).toBeNull();
  });

  it("a cell selection draws a ring polygon at the given colour", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: { kind: "cell", lon: -90, lat: 27, halfW: 0.025, halfH: 0.025 },
    });
    expect(out.selection?.color).toBe("#ff00aa");
    expect(out.selection?.features.features[0].geometry.type).toBe("Polygon");
  });
});

describe("scoresMapInputs — zone-choropleth branch", () => {
  it("raster/overlay cleared, the current unit gets a fill, others stay outline-only", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.raster).toBeNull();
    expect(out.overlays).toEqual([]);
    const pra = out.zones.find((z) => z.unit === "programarea")!;
    expect(pra.fill).toBeDefined();
    expect(pra.fill!.stops).toHaveLength(2);
  });

  it("a zone selection sets highlightKey on the matching unit only", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: { kind: "zone", unit: "programarea", key: "GAA" },
    });
    const pra = out.zones.find((z) => z.unit === "programarea")!;
    expect(pra.highlightKey).toBe("GAA");
  });
});
