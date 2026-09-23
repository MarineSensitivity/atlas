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
// the shell instantiates", not panel-only UI. `Places.svelte`'s own effect stays, for the part this
// baseline cannot do without its local `pickOn`/`drawMode` state: honouring an in-progress
// pick/draw interaction rather than restoring the selection outline out from under it the instant
// either ends (see that effect's own comment for why the two do not fight over `outline`).
import type { FeatureCollection } from "geojson";
import type { SelStore } from "../lib/state/sel.svelte";
import { densifyGeometry } from "./densify";
import { featureCollectionOf, selectedGeomPlaceGeometry } from "./model";

export interface PlacesMapStore {
  /** the pick-mode highlight (Deliverable 2) or a selected place's outline (Deliverable 4) --
   * whichever is current; `null` when nothing should be highlighted. */
  readonly outline: FeatureCollection | null;
  /** "show analysis cells" (Deliverable 2): the covered cells, each carrying `pct` (1-100) and
   * `opacity` (`pct / 100`) properties for the selection layer's data-driven fill-opacity. */
  readonly cells: FeatureCollection | null;
  setOutline(fc: FeatureCollection | null): void;
  setCells(fc: FeatureCollection | null): void;
}

export interface PlacesMapDeps {
  selStore: SelStore;
}

export function createPlacesMapStore(deps: PlacesMapDeps): PlacesMapStore {
  let outline = $state<FeatureCollection | null>(null);
  let cells = $state<FeatureCollection | null>(null);

  // the baseline restore (this module's own header comment). Depends ONLY on `sel.pl`/`sel.sel`,
  // so it stays quiet for the whole duration of an interactive pick/draw session (neither changes
  // `sel` until the session commits a place) and never fights `Places.svelte`'s own effect over
  // that window -- it only re-asserts the baseline at the moments `sel` itself changes, which is
  // exactly when the two agree on what the outline should be anyway.
  $effect(() => {
    const geometry = selectedGeomPlaceGeometry(deps.selStore.sel.pl, deps.selStore.sel.sel);
    outline = geometry ? featureCollectionOf(densifyGeometry(geometry)) : null;
  });

  return {
    get outline() {
      return outline;
    },
    get cells() {
      return cells;
    },
    setOutline(fc: FeatureCollection | null) {
      outline = fc;
    },
    setCells(fc: FeatureCollection | null) {
      cells = fc;
    },
  };
}
