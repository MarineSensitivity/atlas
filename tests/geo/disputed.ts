// The one case where this repo and msens do NOT agree — and it is not about arithmetic.
//
// Both antimeridian fixtures carry the ring `179.9 -> -179.9`, i.e. longitudes written WRAPPED, and
// expect the four cells either side of 180 deg. Read literally — which is what RFC 7946 says to do,
// every edge being a Cartesian line in lon/lat, and what plan D8 guarantees by storing place
// longitudes UNWRAPPED ("a Bering polygon runs 170...190, so decoding needs no antimeridian guess")
// — that same ring is the 359.8-degree-wide COMPLEMENT of the intended box, and geo/coverage.ts
// covers exactly that: 7,196 cells on global05, 2,323 on usa05 (whose window is only 155.15 deg
// wide).
//
// Writing the very same box unwrapped (179.9 -> 180.1) makes the two sides agree exactly, cell for
// cell — asserted in adoptedFixtures.test.ts. So the fix is one of convention, in the fixture or in
// whatever hands coverage a wrapped ring (atlas-6's upload normalizer is where a wrapped upload is
// unwrapped), and NOT in coverage.ts. Neither side has been adjusted.
//
// This list lives in a plain module rather than a test file so that the loader can import it
// without pulling a second copy of another suite in with it.
export const DISPUTED = new Set(["antimeridian_global05.json", "antimeridian_usa05.json"]);

export function isDisputed(name: string): boolean {
  return DISPUTED.has(name);
}
