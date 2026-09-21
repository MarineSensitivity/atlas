// atlas-0 S4 spike, part (a) — shpjs: zipped shapefile in, GeoJSON out, reads the .prj itself.
import shp from "shpjs";
import { normalizeGeoJSON, type NormalizedResult } from "./normalize";

export async function parseShp(zipUrl: string): Promise<NormalizedResult & { parseMs: number; bytesFetched: number }> {
  const resp = await fetch(zipUrl);
  const buf = await resp.arrayBuffer();
  const t0 = performance.now();
  const geojson = await shp(buf);
  const parseMs = performance.now() - t0;
  return { ...normalizeGeoJSON(geojson), parseMs, bytesFetched: buf.byteLength };
}
