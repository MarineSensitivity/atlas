// atlas-0 S3 spike: the three fixed test geometries, all inside the 2x2 tile block built by
// scripts/make_tiles.sql (tiles 3492, 3493, 3636, 3637 -- lon [-90,-85] x lat [25,30], Gulf of
// America / GA subregion). See spikes/3/RESULTS.md for why this block was picked (all 4 quadrants
// have scored cells for the 8 rescaled metrics; an adjacent block did not).
export type CaseName = "click" | "poly2" | "polypra";

export interface Case {
  name: CaseName;
  // lonMin===lonMax && latMin===latMax means a single clicked point, not a polygon
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  label: string;
}

export const CASES: Record<CaseName, Case> = {
  click: { name: "click", lonMin: -88.75, lonMax: -88.75, latMin: 28.75, latMax: 28.75, label: "one clicked cell" },
  poly2: { name: "poly2", lonMin: -89, lonMax: -87, latMin: 27, latMax: 29, label: "2x2 degree polygon" },
  // ~5x5deg (~273,000 km^2 at this latitude) -- same order of magnitude as a BOEM Program Area
  // (10^5-10^6 km^2); bounded to the 4 committed tiles rather than a real Program Area geometry.
  polypra: { name: "polypra", lonMin: -90, lonMax: -85, latMin: 25, latMax: 30, label: "Program-Area-sized polygon" },
};
