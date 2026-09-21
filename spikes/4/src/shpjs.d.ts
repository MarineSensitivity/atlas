// no @types/shpjs added (keeping spikes/4/package.json to exactly the named spike-only deps) —
// shpjs's real return shape is "a GeoJSON FeatureCollection, or an array of them for a multi-layer
// zip"; normalize.ts already handles both, so `any` here costs nothing.
declare module "shpjs" {
  export default function shp(source: ArrayBuffer | string): Promise<any>;
}
