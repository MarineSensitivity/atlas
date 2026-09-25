// atlas-5 step 1/2: mapInputs.ts turns a LayerBar + representation into composeStyle() data — the
// COG branch (with the asset's OWN colormap/rescale, AquaX 0-1000 vs everything else 1-100), the
// PMTiles ranges branch, and the two render-time notices (§7.4).
import { describe, expect, it } from "vitest";
import { layerBar } from "../../../src/lens/species/data/layerBar";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import {
  DEFAULT_SPECIES_COLORMAP,
  SPECIES_RANGE_ID,
  SPECIES_RASTER_ID,
  SPECIES_RASTER_OPACITY,
  activePill,
  formatSpeciesLegendValue,
  noNativeSurfaceNotice,
  pickAsset,
  speciesMapInputs,
} from "../../../src/lens/species/mapInputs";
import { RANGE_FILL_COLOR, RANGE_FILL_OPACITY } from "../../../src/lib/map/layers/ranges";
import { CARDS, datasetsFor } from "./fixtures";

const v9 = () => datasetsFor("v9");
const v7 = () => datasetsFor("v7");

describe("pickAsset", () => {
  it("prefers the exact rep match", () => {
    const assets = [
      {
        rep: "native",
        type: "cog" as const,
        url: "a",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        bbox: null,
      },
      {
        rep: "model",
        type: "cog" as const,
        url: "b",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        bbox: null,
      },
    ];
    expect(pickAsset(assets, "model")?.url).toBe("b");
    expect(pickAsset(assets, "native")?.url).toBe("a");
  });

  it("falls back to native, then to the first, when the exact rep is missing", () => {
    const nativeOnly = [
      {
        rep: "native",
        type: "cog" as const,
        url: "a",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        bbox: null,
      },
    ];
    expect(pickAsset(nativeOnly, "model")?.url).toBe("a");
    const neither = [
      {
        rep: "foo",
        type: "cog" as const,
        url: "z",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        bbox: null,
      },
    ];
    expect(pickAsset(neither, "model")?.url).toBe("z");
  });

  it("null for no assets at all", () => {
    expect(pickAsset([], "native")).toBeNull();
  });
});

describe("speciesMapInputs — COG branch", () => {
  it("the merged model: titiler tile with its own colormap/rescale, opacity 0.8", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBeNull();
    expect(out.raster?.id).toBe(SPECIES_RASTER_ID);
    expect(out.raster?.opacity).toBe(SPECIES_RASTER_OPACITY);
    expect(out.raster?.tiles[0]).toContain("colormap_name=spectral_r");
    expect(out.raster?.tiles[0]).toContain("rescale=1,100");
    expect(out.range).toBeNull();
  });

  it("AquaX 'Delivered' (native) representation carries rescale=0,1000 — the AquaX gate", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: "ax", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.raster?.tiles[0]).toContain("rescale=0,1000");
    expect(out.asset?.rep).toBe("native");
  });

  it("AquaX 'As ingested' (model) representation carries rescale=1,100", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: "ax", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "model",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.raster?.tiles[0]).toContain("rescale=1,100");
  });

  it("a null asset.colormap falls back to the app's default ramp name, never guessed elsewhere", () => {
    expect(DEFAULT_SPECIES_COLORMAP).toBe("spectral_r");
  });

  it("legend stops come from boot.palettes at the asset's own [min,max], or null without boot", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    const withBoot = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: "x",
      boot: {
        palettes: { spectral_r: Array.from({ length: 11 }, (_, i) => `#${i}${i}${i}${i}${i}${i}`) },
      },
    });
    expect(withBoot.legend?.kind).toBe("continuous");
    if (withBoot.legend?.kind === "continuous") {
      expect(withBoot.legend.stops[0].value).toBe(1);
      expect(withBoot.legend.stops.at(-1)?.value).toBe(100);
    }
    const withoutBoot = speciesMapInputs(bar, { rep: "native", ver: "v9", scientificName: "x" });
    expect(withoutBoot.legend).toBeNull();
    // the raster STILL draws even with no legend — titiler colors it server-side regardless
    expect(withoutBoot.raster).not.toBeNull();
  });

  it("merged: null -> the notice, no raster, no range (the ~192 residual taxa)", () => {
    const card = CARDS.whelk(); // v1: merged null, zero inputs
    const bar = layerBar(card, {
      ver: "v1",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v1"),
    });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v1",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBe("No surface published for this taxon in v1");
    expect(out.raster).toBeNull();
    expect(out.range).toBeNull();
  });
});

describe("speciesMapInputs — PMTiles ranges branch", () => {
  it("fill #3388ff at 0.5, source-layer + mdl_key filter from the asset, categorical legend", () => {
    const card = CARDS.walrus();
    const bar = layerBar(card, { ver: "v9", selectedInput: "rng_iucn", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBeNull();
    expect(out.raster).toBeNull();
    expect(out.range?.id).toBe(SPECIES_RANGE_ID);
    expect(out.range?.fillColor).toBe(RANGE_FILL_COLOR);
    expect(out.range?.opacity).toBe(RANGE_FILL_OPACITY);
    expect(out.range?.keyProperty).toBe("mdl_key");
    expect(out.range?.key).toBe(activePill(bar)?.mdlKey);
    // UI-L2 (Ben's "Legend names the layer" ask): title is "{common} ({sci})", subtitle is
    // "{input label} · presence" (the brief's own "FWS Range · presence" form) -- built by the
    // SAME `lib/map/legendTitle.ts#legendTitle()` the scores lens' legend uses, never a second,
    // species-only title format.
    expect(out.legend).toEqual({
      kind: "categorical",
      title: "Walrus (Odobenus rosmarus)",
      subtitle: "IUCN Range · presence",
      label: "range (presence)",
      color: RANGE_FILL_COLOR,
    });
  });

  // the "{common} ({sci})" title's fallback to the bare scientific name (no common name published)
  // is `legendTitle()`'s own concern, asserted directly in tests/lib/map/legendTitle.test.ts --
  // not re-asserted here with a synthetic fixture.
});

describe("formatSpeciesLegendValue — the species legend's own formatValue (defect fix)", () => {
  it("prints integers, never Legend.svelte's default 2 dp (the fault: '1.00'/'100.00')", () => {
    expect(formatSpeciesLegendValue(1)).toBe("1");
    expect(formatSpeciesLegendValue(100)).toBe("100");
  });

  it("rounds a fractional value (never truncates)", () => {
    expect(formatSpeciesLegendValue(53.6)).toBe("54");
    expect(formatSpeciesLegendValue(0)).toBe("0");
  });
});

describe("speciesMapInputs — the struck-through-pill state", () => {
  it("an input with no published assets: the notice, nothing drawn", () => {
    const card = CARDS.walrusV7();
    const bar = layerBar(card, { ver: "v7", selectedInput: "am_0.05", datasets: v7() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v7",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBe(noNativeSurfaceNotice());
    expect(out.raster).toBeNull();
    expect(out.range).toBeNull();
  });
});
