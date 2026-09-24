// atlas-8 review round 2, item m3: `placesMap.outline` used to have TWO effect writers
// (`placesMap.svelte.ts`'s own baseline effect, `Places.svelte`'s "the selected row's outline
// persists" effect) racing over one `$state` bucket. Fixed by splitting into a store-derived
// BASELINE plus an INTERACTION override the caller sets (pick mode's highlight, a draw's live
// preview). This is that composition rule's own unit test, independent of Svelte's runtime (vitest
// here runs plain `ts`, no svelte transform -- see `model.ts`'s own doc comment on why the rule is
// a plain function).
//
// P7 fix (0.10.46, "drawn places vanish from the map after the second draw"): `composeOutline`
// used to be `interaction ?? baseline` -- an override, so a pick-mode preview or a draw's live
// outline hid every OTHER already-listed place while it was active. `baseline` is now EVERY place
// in the list (`model.ts#allGeomPlacesOutline`), so an override that REPLACED it would make this
// exact bug reappear the moment pick mode or a draw session started. It is now a UNION: the
// interaction override is layered ON TOP of the baseline, never in place of it.
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

describe("composeOutline: a union, interaction layered on top of the baseline", () => {
  it("an interaction override, when set, is ADDED to the baseline -- not swapped in for it", () => {
    expect(composeOutline(A, B)).toEqual({
      type: "FeatureCollection",
      features: [...B.features, ...A.features],
    });
  });

  it("a null interaction falls straight through to the baseline", () => {
    expect(composeOutline(null, B)).toBe(B);
  });

  it("both null -> null (nothing drawn)", () => {
    expect(composeOutline(null, null)).toBeNull();
  });

  it("an interaction override with no baseline still shows (pick mode with nothing else drawn yet)", () => {
    expect(composeOutline(A, null)).toBe(A);
  });
});
