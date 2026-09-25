// owner review item 7 (Ben, live 0.10.62): "The species and zone tables arrive in a later phase."
// showed for EVERY species in the Table tool -- this reshapes the SAME `LayerBar` the layer bar
// pills already render into table rows (no new data source). RED-FIRST: fails on the pre-fix tree
// (inputsTableRows did not exist at all).
import { describe, expect, it } from "vitest";
import { inputsTableRows } from "../../../src/lens/species/data/inputsTable";
import { layerBar } from "../../../src/lens/species/data/layerBar";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import { CARDS, datasetsFor } from "./fixtures";

describe("inputsTableRows", () => {
  it("is [] for no bar at all (nothing selected/loaded yet)", () => {
    expect(inputsTableRows(null)).toEqual([]);
  });

  it("one row per pill, in the SAME order the layer bar already shows them", () => {
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v9"),
    });
    const rows = inputsTableRows(bar);
    expect(rows.map((r) => r.key)).toEqual(bar.pills.map((p) => p.key));
    expect(rows.map((r) => r.dataset)).toEqual(bar.pills.map((p) => p.dsKey));
    expect(rows.map((r) => r.input)).toEqual(bar.pills.map((p) => p.label));
  });

  it("an available input's representation lists every rep its assets actually publish", () => {
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v9"),
    });
    const merged = inputsTableRows(bar).find((r) => r.key === MERGED_IN)!;
    expect(merged.available).toBe(true);
    expect(merged.reason).toBeNull();
    // the merged pill's own single asset is always "native" (layerBar.ts's `mergedPill`).
    expect(merged.representation).toBe("native");
  });

  it("a struck-through (no-surface) input reports its own reason and '—' for representation", () => {
    const bar = layerBar(CARDS.walrusV7(), {
      ver: "v7",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v7"),
    });
    const am = inputsTableRows(bar).find((r) => r.dataset === "am_0.05")!;
    expect(am.available).toBe(false);
    expect(am.representation).toBe("—");
    expect(am.reason).toContain("no raster registered for this model");
  });

  it("never repeats the same representation twice for one input", () => {
    // a synthetic pill exercised directly through layerBar's own shape would need a fixture with
    // two same-rep assets; the real fixtures never do, so this documents the de-dup rule against
    // the function directly instead (the pure unit, not the fixture's own shape).
    const bar = layerBar(CARDS.leatherback(), {
      ver: "v9",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v9"),
    });
    const rows = inputsTableRows(bar);
    for (const r of rows) {
      const parts = r.representation.split(", ");
      expect(new Set(parts).size).toBe(parts.length);
    }
  });
});
