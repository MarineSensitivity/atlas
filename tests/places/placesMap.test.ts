// atlas-8 review round 2, item m3: `placesMap.outline` used to have TWO effect writers
// (`placesMap.svelte.ts`'s own baseline effect, `Places.svelte`'s "the selected row's outline
// persists" effect) racing over one `$state` bucket. Fixed by splitting into a store-derived
// BASELINE plus an INTERACTION override the caller sets (pick mode's highlight, a draw's live
// preview), composed ONCE as `interaction ?? baseline` (`model.ts#composeOutline`). This is that
// precedence rule's own unit test, independent of Svelte's runtime (vitest here runs plain `ts`,
// no svelte transform -- see `model.ts`'s own doc comment on why the rule is a plain function).
import { describe, expect, it } from "vitest";
import { composeOutline } from "../../src/places/model";
import type { FeatureCollection } from "geojson";

function fc(who: string, lon: number, lat: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { who },
      },
    ],
  };
}

const A = fc("interaction", 1, 2);
const B = fc("baseline", 3, 4);

describe("composeOutline: interaction wins over baseline", () => {
  it("an interaction override, when set, is what is drawn -- not the baseline", () => {
    expect(composeOutline(A, B)).toBe(A);
  });

  it("a null interaction falls straight through to the baseline", () => {
    expect(composeOutline(null, B)).toBe(B);
  });

  it("both null -> null (nothing drawn)", () => {
    expect(composeOutline(null, null)).toBeNull();
  });

  it("an interaction override with no baseline still wins (pick mode with nothing selected yet)", () => {
    expect(composeOutline(A, null)).toBe(A);
  });
});
