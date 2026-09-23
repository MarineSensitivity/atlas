import { describe, expect, it } from "vitest";
import { formatScoresLegendValue, scoresMapInputs } from "../../../src/lens/scores/mapInputs";
import { defaultLayerKey } from "../../../src/lens/scores/boot";
import { BOOT_V7, MANIFEST_OVERLAYS_V7 } from "./fixtures";

describe("scoresMapInputs — cell branch", () => {
  it("raster + overlay populated, zones VISUALLY outline-only (B3: an invisible opacity-0 query fill, not undefined)", () => {
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
    // B3 fix: `zoneUnitsFromBoot` (layers/zones.ts) now attaches `queryFillFor`'s invisible
    // placeholder to every unit, so pick mode can query a polygon's interior even in the "raster
    // cells" spatial-unit branch this test covers. `opacity: 0` keeps it invisible on screen.
    expect(out.zones[0].fill?.opacity).toBe(0);
    expect(out.zones[0].fill?.stops).toEqual([]);
    expect(out.selection).toBeNull();
  });

  // atlas-4 defect fix: the scores lens had no floating legend at all -- this pins the raster
  // branch's contribution (title + `signif(rescale,3)` endpoints), the underlying data the
  // floating `ScoresLegend.svelte` renders.
  it("legend: kind 'raster', title from the layer's label, endpoints signif(rescale, 3)", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.kind).toBe("raster");
    if (out.legend?.kind === "raster") {
      expect(out.legend.title).toBe("Overall score"); // BOOT_V7's composite layer label
      expect(out.legend.stops[0].value).toBe(0); // signif(0, 3)
      expect(out.legend.stops.at(-1)?.value).toBe(96); // signif(96, 3) — BOOT_V7's composite rescale
    }
  });

  // M2 fix (docs/usability.md): the raster legend used to go "unavailable" the moment a palette
  // (today: anything but spectral_r) had no published boot.palettes stops -- even though titiler
  // was already painting the tiles correctly server-side. `rasterLegend` (raster.ts) now falls back
  // to ramps.ts's own fixed ramp, so `scoresMapInputs` carries a real "raster" legend here too.
  it("legend: kind 'raster' (M2 fallback) even when the release has not published this palette's stops", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "viridis",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.kind).toBe("raster");
    if (out.legend?.kind === "raster") {
      expect(out.legend.title).toBe("Overall score");
      expect(out.legend.stops).toHaveLength(11);
    }
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

  // atlas-4 defect fix: the zone-choropleth branch had NO legend at all before this fix (not even
  // in-panel) — `zoneChoropleth`'s own `legend` field was computed and then discarded.
  it("legend: kind 'zone', title from the layer's label, endpoints round(range, 1)", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.kind).toBe("zone");
    if (out.legend?.kind === "zone") {
      expect(out.legend.title).toBe("Overall score");
      expect(out.legend.stops[0].value).toBe(12); // round(12, 1) — GEO
      expect(out.legend.stops.at(-1)?.value).toBe(33.1); // round(33.09, 1) — GAA
    }
  });

  it("legend: kind 'empty' — the Inf/-Inf guard, no zone carries a value for this metric", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: "nope",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend).toEqual({ kind: "empty", title: "nope" });
  });
});

describe("formatScoresLegendValue — the scores legend's own formatValue (defect fix)", () => {
  it("prints an already-rounded value verbatim, never re-rounding it", () => {
    // the exact fault this exists to catch: toLocaleString("en-US")'s implicit 3-fraction-digit
    // cap turns signif(0.0123456, 3) = 0.0123 into "0.012" — a plain stringify does not.
    expect(formatScoresLegendValue(0.0123)).toBe("0.0123");
    expect(formatScoresLegendValue(98.8)).toBe("98.8");
  });
});
