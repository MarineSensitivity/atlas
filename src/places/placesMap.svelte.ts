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
import type { FeatureCollection } from "geojson";

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

export function createPlacesMapStore(): PlacesMapStore {
  let outline = $state<FeatureCollection | null>(null);
  let cells = $state<FeatureCollection | null>(null);
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
