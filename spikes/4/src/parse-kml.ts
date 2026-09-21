// atlas-0 S4 spike, part (a) — @tmcw/togeojson: KML in (via the browser's native DOMParser), GeoJSON out.
import { kml } from "@tmcw/togeojson";
import { normalizeGeoJSON, type NormalizedResult } from "./normalize";

export async function parseKml(kmlUrl: string): Promise<NormalizedResult & { parseMs: number; bytesFetched: number }> {
  const resp = await fetch(kmlUrl);
  const text = await resp.text();
  const t0 = performance.now();
  const dom = new DOMParser().parseFromString(text, "text/xml");
  const geojson = kml(dom);
  const parseMs = performance.now() - t0;
  return { ...normalizeGeoJSON(geojson), parseMs, bytesFetched: new TextEncoder().encode(text).length };
}
