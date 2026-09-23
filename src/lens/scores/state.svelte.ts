// atlas-4/0.10.21 fix 1 — the scores lens' MAP-INPUT ownership, split out of `ScoresLens.svelte`
// (the panel body) so it does not depend on the panel being open. Mirrors the species lens' own
// split (`src/lens/species/state.svelte.ts`): this is the ONE `.svelte.ts` wiring module — plain
// runes, no `.svelte` component imported — that derives `mapExtra` (the `composeStyle()`
// contribution: zones/raster/overlays/selection/legend) from `sel`/`boot`/`manifest`, so
// Shell.svelte can read it whenever `sel.lens === "scores"` REGARDLESS of whether the panel/sheet
// happens to have mounted `ScoresLens.svelte` at all.
//
// The bug this fixes (owner's report, live 0.10.17): `Panel.svelte` renders its children only
// while `!geometry.collapsed` (desktop only — `Sheet.svelte`'s phone body always renders, just
// CSS-hidden at "peek"), and the scores panel's body used to be the ONLY place `scoresMapInputs()`
// ever ran (a `$effect` inside `ScoresLens.svelte` writing a `bind:mapExtra` prop). Collapse the
// desktop panel and that component is never mounted at all, so `mapExtra` stays `{}` forever and
// `composeStyle()` gets `raster: null` — the score raster (and the floating legend) never paints,
// even though the map itself is fully visible.
//
// Shell.svelte loads this module the SAME way it loads `ScoresLens.svelte`/`ScoresLegend.svelte` —
// a dynamic `import()` triggered by `sel.lens === "scores"`, never by the panel/tool — so a
// species-only session still never downloads a byte of this (`tests/shell/lazy-lens-imports.test.ts`'s
// spirit, even though that scan only polices `.svelte` SFCs by name: this module pulls in
// `mapInputs.ts`/`boot.ts`/`raster.ts`/`zoneFill.ts`, which is exactly the weight D13's fix moved
// OUT of the static bundle in the first place).
//
// `ScoresLens.svelte` still owns everything that needs the panel/MapLibre event stream to exist at
// all — the click → selection wiring, the shared themed popup, the clicked cell's flower fetch —
// it just READS this module's `unit`/`lyr`/`selection`/`mapSelection`/`showOutsidePra`/`mapExtra`
// instead of recomputing them, and writes user choices back through `selStore` exactly as before
// (every choice is already in the URL — `showOutsidePra` is the one exception, ephemeral chrome
// same as `Panel.svelte`'s own geometry, so it lives here as plain `$state` rather than round-
// tripping through `sel`).
import type { SelStore } from "../../lib/state/sel.svelte";
import { gridFromBoot } from "../../lib/grid/grid";
import { effectiveLyr, effectiveUnit } from "./fallback";
import { cellRing, parseScoresSelection, type ScoresSelection } from "./selection";
import { scoresMapInputs, type ScoresMapInputs, type ScoresMapState } from "./mapInputs";
import type { ManifestOverlayRow } from "./raster";

/** the map ring's own shape — a cell's centre + half-extents (pure arithmetic on the release's
 * grid) or a zone key to outline; `ScoresMapState["selection"]`'s own type, named here so
 * `ScoresLens.svelte` does not need to import it out of `mapInputs.ts` just for this. */
export type ScoresMapSelection = ScoresMapState["selection"];

export interface ScoresLensDeps {
  selStore: SelStore;
  boot: () => unknown;
  manifest: () => unknown;
}

export interface ScoresLens {
  /** the release's own drawable unit type, or `"cell"` — `sel.unit` already fallen back
   * (`fallback.ts#effectiveUnit`) for an unrecognized/stale value. */
  readonly unit: string;
  /** the resolved `metric_key` — `sel.lyr` already fallen back (`fallback.ts#effectiveLyr`); never
   * `undefined` once a release's `boot` has loaded. */
  readonly lyr: string | null;
  /** `manifest.overlays`, read once here so `ScoresLens.svelte`/`LayersPanel.svelte` never derive
   * it a second time. */
  readonly manifestOverlays: readonly ManifestOverlayRow[] | null;
  /** `sel.sel` parsed (`selection.ts#parseScoresSelection`) — the selection AS THE FLOWER/SPECIES/
   * TABLE panels see it (`cell:<id>` keeps the raw cell id). */
  readonly selection: ScoresSelection;
  /** the SAME selection, reshaped into what `scoresMapInputs` needs for the map ring. */
  readonly mapSelection: ScoresMapSelection;
  /** the "cells outside Program Areas" overlay switch — ephemeral chrome (module header), never
   * written to `sel`. */
  readonly showOutsidePra: boolean;
  setShowOutsidePra(value: boolean): void;
  /** this lens' `composeStyle()` contribution — `scoresMapInputs()` is null-`boot`-safe (an empty
   * `zones`/`raster: null`/an "unavailable" legend, same as `ScoresLens.svelte`'s own effect
   * produced before this fix, before `boot` has ever loaded), so this is never `undefined`. */
  readonly mapExtra: ScoresMapInputs;
}

export function createScoresLens(deps: ScoresLensDeps): ScoresLens {
  let showOutsidePra = $state(false);

  const manifestOverlays = $derived(
    (deps.manifest() as { overlays?: ManifestOverlayRow[] } | null)?.overlays ?? null,
  );

  const unit = $derived(effectiveUnit(deps.selStore.sel.unit, deps.boot()));
  const lyr = $derived(effectiveLyr(deps.selStore.sel.lyr, deps.boot()));

  const selection: ScoresSelection = $derived(parseScoresSelection(deps.selStore.sel.sel));

  const mapSelection: ScoresMapSelection = $derived.by(() => {
    if (!selection) return null;
    if (selection.kind === "zone") return selection;
    try {
      return { kind: "cell" as const, ...cellRing(selection.cellId, gridFromBoot(deps.boot())) };
    } catch {
      return null; // no boot.grid yet (Tier 0 hasn't loaded) — draw no ring rather than throw
    }
  });

  const mapExtra: ScoresMapInputs = $derived.by(() =>
    scoresMapInputs({
      boot: deps.boot(),
      overlays: manifestOverlays,
      unit,
      lyr,
      palette: deps.selStore.sel.pal,
      showOutsidePra,
      selection: mapSelection,
    }),
  );

  return {
    get unit() {
      return unit;
    },
    get lyr() {
      return lyr;
    },
    get manifestOverlays() {
      return manifestOverlays;
    },
    get selection() {
      return selection;
    },
    get mapSelection() {
      return mapSelection;
    },
    get showOutsidePra() {
      return showOutsidePra;
    },
    setShowOutsidePra(value: boolean) {
      showOutsidePra = value;
    },
    get mapExtra() {
      return mapExtra;
    },
  };
}
