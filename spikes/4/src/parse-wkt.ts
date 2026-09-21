// atlas-0 S4 spike, part (a) — the hand-rolled WKT-paste parser (see wkt.ts for why it is not a
// dependency). Fetches the fixture's .wkt text the same way a paste box would receive pasted text.
import { wktToGeoJSON } from "./wkt";
import { normalizeGeoJSON, type NormalizedResult } from "./normalize";

export async function parseWkt(wktUrl: string): Promise<NormalizedResult & { parseMs: number; bytesFetched: number }> {
  const resp = await fetch(wktUrl);
  const text = await resp.text();
  const t0 = performance.now();
  const geojson = wktToGeoJSON(text);
  const parseMs = performance.now() - t0;
  return { ...normalizeGeoJSON(geojson), parseMs, bytesFetched: new TextEncoder().encode(text).length };
}
