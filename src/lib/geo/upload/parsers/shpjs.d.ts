// `shpjs@6.2.0` publishes no types and there is no `@types/shpjs`. Its documented return is "a
// GeoJSON FeatureCollection, or an array of them for a multi-layer zip" — parsers/shapefile.ts
// handles both — so this declaration says exactly that and no more, rather than pulling in a types
// package that would then need its own pin.
declare module "shpjs" {
  export interface ShpGeoJsonFeature {
    type?: string;
    geometry?: { type: string; coordinates?: unknown } | null;
    properties?: Record<string, unknown> | null;
  }
  export interface ShpGeoJsonCollection {
    type?: string;
    features?: ShpGeoJsonFeature[];
    fileName?: string;
  }
  export default function shp(
    source: ArrayBuffer | string,
  ): Promise<ShpGeoJsonCollection | ShpGeoJsonCollection[]>;
}

// `flatgeobuf@4.4.0` ships `.d.ts` files beside its ESM build but publishes no `exports` map, so
// TypeScript's bundler resolution does not find the deep path the lazy import uses.
declare module "flatgeobuf/lib/mjs/geojson.js" {
  export function deserialize(
    bytes: Uint8Array,
    rect?: unknown,
    headerMetaFn?: (header: unknown) => void,
  ): AsyncIterable<{
    geometry?: { type: string; coordinates?: unknown } | null;
    properties?: Record<string, unknown> | null;
  }>;
}
