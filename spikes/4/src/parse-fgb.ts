// atlas-0 S4 spike, part (a) — flatgeobuf: reads its own binary format, including an optional
// embedded CRS in the header. The JS reader does NOT reproject to WGS84 even when a non-4326 CRS
// is present in that header — it just hands back the raw stored coordinates — so this also
// captures header.crs for RESULTS.md to record what "no reprojection" looks like for utm_zone.fgb.
//
// deep import (not the `flatgeobuf` barrel) on purpose: the barrel's `export * as ol from
// './ol.js'` eagerly resolves an `ol` import that is not one of this spike's dependencies.
import { deserialize } from "flatgeobuf/lib/mjs/geojson.js";
import { normalizeGeoJSON, type NormalizedResult } from "./normalize";

export async function parseFgb(
  fgbUrl: string,
): Promise<NormalizedResult & { parseMs: number; bytesFetched: number; headerCrs: unknown }> {
  const resp = await fetch(fgbUrl);
  const buf = new Uint8Array(await resp.arrayBuffer());
  let headerCrs: unknown = null;
  const t0 = performance.now();
  const features: any[] = [];
  // deserialize(bytes, rect?, headerMetaFn?) is an ASYNC generator even for a Uint8Array input
  // (confirmed empirically: a plain `for...of` throws "not iterable" — the .d.ts's
  // `AsyncGenerator<IFeature>` return type was right, a first `for...of` guess here was not).
  for await (const f of deserialize(buf, undefined, (header: any) => {
    headerCrs = header?.crs ?? null;
  }) as AsyncGenerator<any>) {
    features.push(f);
  }
  const parseMs = performance.now() - t0;
  const geojson = { type: "FeatureCollection", features };
  return { ...normalizeGeoJSON(geojson), parseMs, bytesFetched: buf.byteLength, headerCrs };
}
