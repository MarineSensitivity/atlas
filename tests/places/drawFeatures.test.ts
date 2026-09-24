// P9: the pure id -> place-index mapping `Places.svelte#onDrawFinish` uses to tell a fresh draw
// from an edit of an already-drawn feature (terra-draw's own `finish` event fires on both -- see
// `src/places/draw.ts`'s `onFinish` comment and `src/places/drawFeatures.ts`'s own header for the
// bug this fixes: dragging a drawn shape's corner used to add a SECOND place).
import { describe, expect, it } from "vitest";
import {
  drawFeaturePlaceIndex,
  emptyDrawFeatureIndex,
  withDrawFeature,
  withoutDrawPlace,
} from "../../src/places/drawFeatures";

describe("drawFeaturePlaceIndex / withDrawFeature", () => {
  it("an id never recorded resolves to undefined -- the caller must treat it as a NEW place", () => {
    const map = emptyDrawFeatureIndex();
    expect(drawFeaturePlaceIndex(map, "feature-1")).toBeUndefined();
  });

  it("a recorded id resolves to the place index it was given", () => {
    const map = withDrawFeature(emptyDrawFeatureIndex(), "feature-1", 0);
    expect(drawFeaturePlaceIndex(map, "feature-1")).toBe(0);
  });

  it("recording a second id does not disturb the first (two shapes drawn in one session)", () => {
    let map = emptyDrawFeatureIndex();
    map = withDrawFeature(map, "feature-1", 0);
    map = withDrawFeature(map, "feature-2", 1);
    expect(drawFeaturePlaceIndex(map, "feature-1")).toBe(0);
    expect(drawFeaturePlaceIndex(map, "feature-2")).toBe(1);
  });

  it("re-recording the SAME id (a later edit of the same feature) overwrites its own index, never adds a second entry", () => {
    let map = emptyDrawFeatureIndex();
    map = withDrawFeature(map, "feature-1", 0);
    map = withDrawFeature(map, "feature-1", 0); // an edit re-asserts the same index
    expect(map.size).toBe(1);
    expect(drawFeaturePlaceIndex(map, "feature-1")).toBe(0);
  });

  it("does not mutate the map handed in (Svelte reactivity needs a new reference to notice a change)", () => {
    const before = emptyDrawFeatureIndex();
    const after = withDrawFeature(before, "feature-1", 0);
    expect(before.size).toBe(0);
    expect(after).not.toBe(before);
  });

  it("numeric and string ids are both keyable (terra-draw's FeatureId is string | number)", () => {
    const map = withDrawFeature(emptyDrawFeatureIndex(), 42, 3);
    expect(drawFeaturePlaceIndex(map, 42)).toBe(3);
  });
});

describe("withoutDrawPlace: a place removal (Places.svelte#remove) reconciles the map", () => {
  it("drops the feature that pointed at the removed index", () => {
    const map = withDrawFeature(emptyDrawFeatureIndex(), "feature-1", 0);
    const next = withoutDrawPlace(map, 0);
    expect(drawFeaturePlaceIndex(next, "feature-1")).toBeUndefined();
  });

  it("shifts every LATER index down by one, so an edit after a mid-list delete lands on the right row", () => {
    let map = emptyDrawFeatureIndex();
    map = withDrawFeature(map, "feature-1", 0);
    map = withDrawFeature(map, "feature-2", 1);
    map = withDrawFeature(map, "feature-3", 2);
    const next = withoutDrawPlace(map, 1); // place 1 (feature-2's row) removed
    expect(drawFeaturePlaceIndex(next, "feature-1")).toBe(0); // before the removal: unchanged
    expect(drawFeaturePlaceIndex(next, "feature-2")).toBeUndefined(); // that row is gone
    expect(drawFeaturePlaceIndex(next, "feature-3")).toBe(1); // after the removal: shifted down
  });

  it("leaves an EARLIER index untouched", () => {
    let map = emptyDrawFeatureIndex();
    map = withDrawFeature(map, "feature-1", 0);
    map = withDrawFeature(map, "feature-2", 2);
    const next = withoutDrawPlace(map, 2);
    expect(drawFeaturePlaceIndex(next, "feature-1")).toBe(0);
  });
});
