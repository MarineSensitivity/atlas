// places/drawFeatures.ts -- a terra-draw feature id -> place-index mapping, pulled out as pure
// functions so the rule has a real unit test independent of Svelte's runtime (the same reasoning
// `model.ts`'s own header gives for its functions).
//
// THE BUG THIS EXISTS TO FIX (P9, Opus docs re-check appendix finding A1, live-verified on 0.10.48):
// terra-draw's `finish` event fires once for a FRESH draw ("action: draw") and ALSO once for every
// EDIT of a feature that already exists -- dragging a corner, resizing a rectangle, dragging the
// whole feature, adding/removing a midpoint (`draw.ts`'s own `OnFinishContext.action`). Before this
// module, `Places.svelte#onDrawFinish` treated every finish as a new shape: draw a rectangle, drag
// one of its corners, and the list went from "Drawn place 1" to a SECOND row ("Drawn place 2") that
// duplicated the (now-stale) original instead of updating it.
//
// Scoped to ONE draw session's lifetime: `Places.svelte` starts a fresh map when a terra-draw
// session starts and drops it when the session stops (`ensureDrawSession`/`stopDraw`) -- terra-draw
// hands out fresh ids per `TerraDraw` instance, so nothing here needs to survive past one session,
// only across the several `finish` events ONE session's draw-then-edit produces.
export type DrawFeatureId = string | number;
export type DrawFeatureIndex = ReadonlyMap<DrawFeatureId, number>;

export function emptyDrawFeatureIndex(): DrawFeatureIndex {
  return new Map();
}

/** record that `featureId` created (a fresh draw) or now refers to (an edit) the place at `index`. */
export function withDrawFeature(
  map: DrawFeatureIndex,
  featureId: DrawFeatureId,
  index: number,
): DrawFeatureIndex {
  return new Map(map).set(featureId, index);
}

/** the place index `featureId` names in THIS session, or `undefined` if this session never drew it
 * (a fresh draw, or an id from a previous/discarded session -- either way, the caller's job is to
 * treat that as a NEW place, never guess at a row). */
export function drawFeaturePlaceIndex(
  map: DrawFeatureIndex,
  featureId: DrawFeatureId,
): number | undefined {
  return map.get(featureId);
}

/** a place was removed at `removedIndex` (`Places.svelte#remove`): drop whichever feature pointed
 * at it (that row no longer exists -- a later finish for it must fall back to "new place", not
 * silently overwrite whatever now sits at that index) and shift every LATER index down by one, so
 * an edit after a mid-list delete still lands on the row it actually drew. */
export function withoutDrawPlace(map: DrawFeatureIndex, removedIndex: number): DrawFeatureIndex {
  const next = new Map<DrawFeatureId, number>();
  for (const [id, index] of map) {
    if (index === removedIndex) continue;
    next.set(id, index > removedIndex ? index - 1 : index);
  }
  return next;
}
