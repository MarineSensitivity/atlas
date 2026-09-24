// layerBar.ts: pill order, the no-surface pill, the merged label's n (the section 11.5 crash), the
// representation toggle's four tooltips, and the verbatim rescale.
import { describe, expect, it } from "vitest";
import {
  MERGED_LABEL,
  REPRESENTATION_LABELS,
  datasetLabel,
  layerBar,
  noSurfaceTooltip,
} from "../../../src/lens/species/data/layerBar";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import { CARDS, datasetsFor } from "./fixtures";

const v9 = () => datasetsFor("v9");

describe("pills", () => {
  it("are the merged model plus one per input, in dataset.sort_order", () => {
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: v9(),
    });
    expect(bar.pills.map((p) => p.dsKey)).toEqual([
      "ms_merge", // sort_order 1
      "ax", // 2
      "am", // 3
      "ch_nmfs", // 5
      "ch_fws", // 6
      "rng_fws", // 7
      "rng_iucn", // 9
      "rng_turtle_swot_dps", // 10
    ]);
    expect(bar.mobileToggleLabel).toBe("8 layers");
  });

  it("a dataset with no sort_order sorts last, and an unnamed dataset falls back to its key", () => {
    const bar = layerBar(CARDS.walrusV7(), {
      ver: "v7",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v1"),
    });
    // v1's registry names nothing and orders nothing: ds_key labels, alphabetical, merged first
    expect(bar.pills.map((p) => p.label)).toEqual([MERGED_LABEL, "am_0.05", "rng_iucn"]);
    expect(datasetLabel(datasetsFor("v1"), "rng_iucn")).toBe("rng_iucn");
  });

  it("an input with no published surface is struck through, with the title that says why", () => {
    const bar = layerBar(CARDS.walrusV7(), {
      ver: "v7",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v7"),
    });
    const am = bar.pills.find((p) => p.dsKey === "am_0.05")!;
    expect(am.hasSurface).toBe(false);
    // V4 fix (owner phone report, 2026-09-24, docs fact-check item 1): "publishes no surface" was
    // the wrong explanation -- a struck pill means no model-asset REGISTRY ROW for this model
    // key, the same lookup the Species Shiny app makes, not a release choosing to omit one.
    expect(am.tooltip).toBe(
      "AquaMaps SDM feeds the merged model, but v7 has no raster registered for this model " +
        "(the Species app shows it the same way)",
    );
    expect(am.tooltip).toBe(noSurfaceTooltip("AquaMaps SDM", "v7"));
    // the merged model itself IS drawable on v7
    expect(bar.pills.find((p) => p.dsKey === "ms_merge")?.hasSurface).toBe(true);
  });

  it("a drawable pill has no tooltip", () => {
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: v9(),
    });
    expect(bar.pills.every((p) => (p.hasSurface ? p.tooltip === null : p.tooltip !== null))).toBe(
      true,
    );
  });
});

describe("the merged label's n (section 11.5)", () => {
  it("a SINGLE-input taxon yields n = 1, never undefined", () => {
    const bar = layerBar(CARDS.auklet(), { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    expect(bar.nInputs).toBe(1);
    expect(Number.isInteger(bar.nInputs)).toBe(true);
    // with one input there is no "maximum of" note (section 7.2)
    expect(bar.mergedLabel).toBe("Merged Model");
    expect(bar.title).toBe("Merged Model");
  });

  it("a taxon with NO inputs at all yields n = 0, never undefined", () => {
    const bar = layerBar(CARDS.whelk(), {
      ver: "v1",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v1"),
    });
    expect(bar.nInputs).toBe(0);
    expect(bar.pills).toHaveLength(1);
  });

  it("counts the shard's edges, not a dataset count", () => {
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: v9(),
    });
    expect(bar.nInputs).toBe(7);
    expect(bar.mergedLabel).toBe("Merged Model (maximum of 7 inputs)");
  });
});

describe("the bar's variant and title", () => {
  it("is merged (green) for the merged model", () => {
    const bar = layerBar(CARDS.walrus(), { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    expect(bar.variant).toBe("merged");
    expect(bar.showMergedLink).toBe(false);
  });

  it("is input (orange) with 'Viewing input: {name}' and a way back", () => {
    const bar = layerBar(CARDS.walrus(), { ver: "v9", selectedInput: "ax", datasets: v9() });
    expect(bar.variant).toBe("input");
    expect(bar.title).toBe("Viewing input: AquaX");
    expect(bar.showMergedLink).toBe(true);
    expect(bar.pills.find((p) => p.dsKey === "ax")?.active).toBe(true);
  });
});

describe("the representation toggle", () => {
  it("is available only when the input publishes both representations", () => {
    const walrus = CARDS.walrus();
    expect(
      layerBar(walrus, { ver: "v9", selectedInput: "ax", datasets: v9() }).representation.available,
    ).toBe(true);
    expect(
      layerBar(walrus, { ver: "v9", selectedInput: "rng_iucn", datasets: v9() }).representation
        .available,
    ).toBe(false);
    expect(
      layerBar(walrus, { ver: "v9", selectedInput: MERGED_IN, datasets: v9() }).representation
        .available,
    ).toBe(false);
  });

  it("is relabelled Delivered / As ingested when dataset.on_grid (AquaX, v9)", () => {
    const bar = layerBar(CARDS.walrus(), { ver: "v9", selectedInput: "ax", datasets: v9() });
    expect(bar.representation.options.map((o) => o.label)).toEqual(["Delivered", "As ingested"]);
  });

  it("is Original / Interpolated otherwise (AquaMaps)", () => {
    const bar = layerBar(CARDS.walrus(), { ver: "v9", selectedInput: "am", datasets: v9() });
    expect(bar.representation.options.map((o) => o.label)).toEqual(["Original", "Interpolated"]);
  });

  it("carries the four tooltips of section 7.2, verbatim", () => {
    expect(REPRESENTATION_LABELS.offGrid.map((o) => o.tooltip)).toEqual([
      "the source SDM at its native resolution",
      "resampled to the 0.05° scoring grid",
    ]);
    expect(REPRESENTATION_LABELS.onGrid.map((o) => o.tooltip)).toEqual([
      "the band exactly as delivered (already on the 0.05° grid)",
      "as ingested: rescaled to 1–100 with the ingest threshold applied — what the merge uses",
    ]);
  });
});

describe("rescale is data, passed through verbatim", () => {
  it("AquaX delivered is 0-1000 and its ingested twin is 1-100", () => {
    const bar = layerBar(CARDS.leatherback(), { ver: "v9", selectedInput: "ax", datasets: v9() });
    const ax = bar.pills.find((p) => p.dsKey === "ax")!;
    expect(ax.assets.find((a) => a.rep === "native")?.rescale).toEqual([0, 1000]);
    expect(ax.assets.find((a) => a.rep === "model")?.rescale).toEqual([1, 100]);
  });

  it("everything else is 1-100, and a pmtiles range carries its source layer instead", () => {
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: v9(),
    });
    expect(bar.pills.find((p) => p.dsKey === "am")?.assets.map((a) => a.rescale)).toEqual([
      [1, 100],
      [1, 100],
    ]);
    const iucn = bar.pills.find((p) => p.dsKey === "rng_iucn")!.assets[0];
    expect([iucn.type, iucn.rescale, iucn.sourceLayer]).toEqual(["pmtiles", null, "rng_iucn"]);
    const merged = bar.pills.find((p) => p.dsKey === "ms_merge")!.assets[0];
    expect([merged.type, merged.rescale, merged.colormap]).toEqual(["cog", [1, 100], "spectral_r"]);
  });
});
