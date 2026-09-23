// places/placesMap.svelte.ts -- the ONE reactive bridge between Places.svelte and the shell's
// single `composeStyle()` call (docs/map.md: "one composed style, applied with ONE
// `setStyle(diff:true)`" -- Shell.svelte, not this module, owns that call). This is a `.svelte.ts`
// module (runes allowed, same convention as `src/lib/state/sel.svelte.ts`) rather than plain state
// inside Places.svelte, because the shell's `$effect` that recomposes the style needs to react to
// it too, and a value can only be `$derived` from a rune the reader can see.
//
// Everything here is DATA the shell folds into its `selection` composeStyle input (atlas-6's scope:
// "src/lib/map/ only through composeStyle inputs and the selection layer group") -- nothing here
// ever calls `addLayer`/`setStyle`/`fitBounds`.
//
// 0.10.21 (the same-class candidate fix 1 flagged, `e2e/places.deeplink-outline.spec.ts`): this
// store ALSO owns a BASELINE restore of a selected drawn place's outline, from `sel.pl`/`sel.sel`
// alone -- `model.ts#selectedGeomPlaceGeometry`. Before this, that restore lived ONLY in
// `Places.svelte`'s own `$effect` ("the selected row's outline persists..."), which runs only
// while the Places panel is mounted (Shell.svelte loads it lazily, keyed on `activeTool ===
// "places"`, never the default tool) -- so a deep link selecting a drawn place
// (`?sel=place:0#pl=...`) with the Places tool never opened showed no outline at all, the SAME
// shape as fix 1's scores-lens bug (map state computed only inside panel-gated UI). Shell.svelte
// already instantiates this store UNCONDITIONALLY, at module scope, regardless of which tool is
// active -- mirroring `createSpeciesLens`/`createScoresLens`, this is now "a lens/place-level store
// the shell instantiates", not panel-only UI.
//
// atlas-8 review round 2, item m3: that baseline restore used to be a SECOND `$effect` writing the
// SAME `outline` state `Places.svelte`'s own "the selected row's outline persists..." effect also
// wrote (gated on `!pickOn && !drawMode`) -- two independent writers of one bucket, ordered only by
// Svelte's own effect-scheduling, the shape GATES.md already flagged for `document.title` (fixed
// there by making Shell.svelte the ONE writer). Fixed the same way: `baseline` is now a pure
// `$derived` (never an effect -- nothing to race), `interaction` is the ONE piece of `$state` a
// caller can set (pick mode's highlight, a draw's live preview -- everything `Places.svelte`'s own
// `mapStore.setOutline(...)` calls already meant), and `outline` composes them ONCE, here:
// `interaction ?? baseline`. `Places.svelte` no longer needs its own baseline-restoring effect at
// all -- clearing the interaction override (pick/draw ending) falls straight back to the baseline
// this module already tracks; see that component's own `setOutline(null)` call sites, unchanged.
// A place/pl selection change drops any STALE interaction override (a pick highlight or a draw
// preview belongs to the selection that was current when it was set): pick/draw re-assert their
// own interaction immediately if still active, through their own callbacks. `tests/places/
// placesMap.test.ts` unit-tests the precedence.
import type { FeatureCollection } from "geojson";
import type { SelStore } from "../lib/state/sel.svelte";
import { densifyGeometry } from "./densify";
import { composeOutline, featureCollectionOf, selectedGeomPlaceGeometry } from "./model";

export interface PlacesMapStore {
  /** `interaction ?? baseline` -- the pick-mode highlight or a draw's live preview (Deliverable
   * 2/3) when one is set, else the selected place's own outline restored from `sel.pl`/`sel.sel`
   * alone (Deliverable 4); `null` when nothing should be highlighted. */
  readonly outline: FeatureCollection | null;
  /** "show analysis cells" (Deliverable 2): the covered cells, each carrying `pct` (1-100) and
   * `opacity` (`pct / 100`) properties for the selection layer's data-driven fill-opacity. */
  readonly cells: FeatureCollection | null;
  /** atlas-8 review round 2, item m4: the "Show analysis cells" toggle's own on/off state, moved
   * out of `Places.svelte`'s local `$state` -- it used to read "off" after a collapse/tool-switch/
   * remount while `cells` (above) stayed painted, so the toggle and the map could disagree. Chrome
   * (never the URL), same lifetime as `outline`/`cells`. */
  readonly showCells: boolean;
  /** sets the INTERACTION override (item m3) -- `null` releases it back to the baseline. */
  setOutline(fc: FeatureCollection | null): void;
  setCells(fc: FeatureCollection | null): void;
  setShowCells(value: boolean): void;
}

export interface PlacesMapDeps {
  selStore: SelStore;
}

export function createPlacesMapStore(deps: PlacesMapDeps): PlacesMapStore {
  let interaction = $state<FeatureCollection | null>(null);
  let cells = $state<FeatureCollection | null>(null);
  let showCells = $state(false);

  // the baseline (this module's own header comment) -- a pure `$derived`, never an effect: it has
  // no side effect to race, so reading it can never disagree with a concurrent writer the way two
  // effects writing the same `$state` could.
  const baseline = $derived.by(() => {
    const geometry = selectedGeomPlaceGeometry(deps.selStore.sel.pl, deps.selStore.sel.sel);
    return geometry ? featureCollectionOf(densifyGeometry(geometry)) : null;
  });

  // a place/pl selection change drops any interaction override left over from a PREVIOUS
  // selection (this module header's own rule) -- `Places.svelte`'s pick/draw callbacks
  // (`refreshOutline()`, `onDrawFinish()`) re-assert a fresh one immediately if still active.
  $effect(() => {
    void deps.selStore.sel.pl;
    void deps.selStore.sel.sel;
    interaction = null;
  });

  // composed ONCE, here (item m3), through the unit-tested `model.ts#composeOutline`.
  const outline = $derived(composeOutline(interaction, baseline));

  return {
    get outline() {
      return outline;
    },
    get cells() {
      return cells;
    },
    get showCells() {
      return showCells;
    },
    setOutline(fc: FeatureCollection | null) {
      interaction = fc;
    },
    setCells(fc: FeatureCollection | null) {
      cells = fc;
    },
    setShowCells(value: boolean) {
      showCells = value;
    },
  };
}
