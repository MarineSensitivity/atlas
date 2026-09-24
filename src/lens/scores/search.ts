// atlas-8 P-round Q1 (owner-reported defect, live 0.10.50, 390px phone/v7): the top-bar search box
// did nothing in the Scores lens -- a stub `<input>` with a placeholder and no handler at all
// (`ScoresLens.svelte`'s own note: "The Nominatim geocoder was never attempted"). This module is the
// pure matching/parsing logic behind its replacement, `ScoresSearch.svelte` -- deliberately NOT a
// geocoder: no third-party service, no network call, no API key. It only searches what the release
// already published in `boot.json` (zones) plus arithmetic on the release's own grid (coordinates),
// so it works exactly as well offline as online (CHANGELOG.md).
//
// Two match kinds, ONE combined, capped result list (`scoresSearch`):
//  - a zone (Program Area, and any subregion/ecoregion archive the release happens to also
//    publish in `boot.zones`) by key or by name;
//  - a typed "lon, lat" coordinate pair, jumped to and resolved into a cell selection.
import { paLabel } from "../../places/zoneStats";
import { primaryUnitType, zoneRows } from "./boot";

export interface ZoneSearchMatch {
  kind: "zone";
  unit: string;
  key: string;
  /** `paLabel`-style "Name (KEY)" -- falls back to the bare key when the bundle publishes no name
   * for it (or the name equals the key), same rule every other zone-facing label in this lens
   * follows (`zonesTable.ts`, `places/zoneStats.ts`). */
  label: string;
}

export interface CoordSearchMatch {
  kind: "coord";
  lon: number;
  lat: number;
  label: string;
}

export type ScoresSearchMatch = ZoneSearchMatch | CoordSearchMatch;

export const MAX_RESULTS = 8;

/** the zone unit TYPES this search matches against, in listing order: the release's own SELECTABLE
 * unit (Program Areas -- `primaryUnitType`) first, then `subregion`/`ecoregion` when the release
 * ALSO happens to publish either archive under `boot.zones` (D17: neither is ever the selectable
 * spatial unit -- `fallback.ts#effectiveUnit` still clamps a `unit=subregion` URL back to "cell" --
 * but `boot.zones` is a plain object keyed by whatever the release published, and a person may
 * still know a place by its subregion/ecoregion name). Deduped so v1's `planarea` (which IS
 * `primaryUnitType`) is never listed twice.
 */
function searchableZoneUnits(boot: unknown): string[] {
  const units = [primaryUnitType(boot), "subregion", "ecoregion"].filter((u): u is string => !!u);
  return [...new Set(units)];
}

function fold(s: string): string {
  return s.trim().toLowerCase();
}

/** lower is a better match; `null` = no match at all. Exact key beats a key prefix beats a key
 * substring beats a name prefix beats a name substring -- so a query that is itself an exact key
 * (the common case: typing a Program Area's own acronym) always sorts first, even when the SAME
 * text also happens to substring-match some other zone's name (e.g. "ALA" inside "Alaska"). */
function matchRank(query: string, key: string, name: string | undefined): number | null {
  const k = fold(key);
  const n = name ? fold(name) : "";
  if (k === query) return 0;
  if (k.startsWith(query)) return 1;
  if (k.includes(query)) return 2;
  if (n && n.startsWith(query)) return 3;
  if (n && n.includes(query)) return 4;
  return null;
}

/**
 * Every zone (across `searchableZoneUnits`) whose key or name matches `query`, ranked and capped —
 * a `query` that folds to the empty string (blank/whitespace) matches nothing, never "everything".
 */
export function matchZones(boot: unknown, query: string, limit = MAX_RESULTS): ZoneSearchMatch[] {
  const q = fold(query);
  if (!q) return [];
  const ranked: Array<{ m: ZoneSearchMatch; rank: number; order: number }> = [];
  let order = 0;
  for (const unit of searchableZoneUnits(boot)) {
    for (const z of zoneRows(boot, unit)) {
      const rank = matchRank(q, z.key, z.name);
      if (rank === null) continue;
      ranked.push({
        m: { kind: "zone", unit, key: z.key, label: paLabel(z.key, z.name) },
        rank,
        order: order++,
      });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, limit).map((r) => r.m);
}

// --- coordinates ---------------------------------------------------------------------------------

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const LAT_LABEL_RE = /\blat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;
const LON_LABEL_RE = /\blon(?:g|gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;

function labeledNumber(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function inRange(lon: number, lat: number): boolean {
  return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

export interface CoordParseResult {
  lon: number;
  lat: number;
  /** true when the pair was read as "lat, lon" rather than the default "lon, lat" -- either an
   * explicit `lat`/`lon` label in the text, or the default reading's latitude falling outside
   * +-90 deg while the swapped reading is valid. Surfaced so the result label can show the user how
   * their text was read (item 2's "with a hint"). */
  swapped: boolean;
}

/**
 * Parse a typed coordinate pair. "lon, lat" is the default order (the SAME convention
 * `places/coords.ts`'s own "lon,lat" line rule and `grid.ts#cellLonLat` use) — NOT re-imported from
 * there: that module belongs to the upload pipeline (a heavier, async, geometry-validating parser
 * for shapes) and this is a much smaller, synchronous "jump to a point" parse with no geometry
 * involved at all.
 *
 * "lat, lon" is also accepted, two ways:
 *  - an explicit `lat`/`lon` label anywhere in the text ("lat 57, lon -140", "lat: 57 lon: -140");
 *  - inferred when the default "lon, lat" reading would put the SECOND number outside latitude's
 *    +-90 deg range but the SWAPPED reading is valid both ways ("57, -140" -> lon -140, lat 57).
 *
 * `null` for anything that is not exactly two numbers (comma and/or whitespace separated), or is
 * out of range under BOTH readings.
 */
export function parseCoordinateQuery(text: string): CoordParseResult | null {
  const t = text.trim();
  if (!t) return null;

  const latLabeled = labeledNumber(t, LAT_LABEL_RE);
  const lonLabeled = labeledNumber(t, LON_LABEL_RE);
  if (latLabeled !== null && lonLabeled !== null) {
    return inRange(lonLabeled, latLabeled)
      ? { lon: lonLabeled, lat: latLabeled, swapped: true }
      : null;
  }

  const parts = t.split(/[,\s]+/).filter((s) => s.length > 0);
  if (parts.length !== 2) return null;
  if (!NUMBER_RE.test(parts[0]) || !NUMBER_RE.test(parts[1])) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (inRange(a, b)) return { lon: a, lat: b, swapped: false }; // default: "lon, lat"
  if (inRange(b, a)) return { lon: b, lat: a, swapped: true }; // the default reading was out of range
  return null;
}

export function formatCoordLabel(r: CoordParseResult): string {
  const lon = r.lon.toFixed(2);
  const lat = r.lat.toFixed(2);
  return r.swapped ? `Fly to lat ${lat}, lon ${lon}` : `Fly to lon ${lon}, lat ${lat}`;
}

/**
 * The combined, capped result list the search field renders: a parsed coordinate (at most one)
 * first, then zone matches filling whatever room is left.
 */
export function scoresSearch(
  boot: unknown,
  query: string,
  limit = MAX_RESULTS,
): ScoresSearchMatch[] {
  const out: ScoresSearchMatch[] = [];
  const coord = parseCoordinateQuery(query);
  if (coord)
    out.push({ kind: "coord", lon: coord.lon, lat: coord.lat, label: formatCoordLabel(coord) });
  const remaining = limit - out.length;
  if (remaining > 0) out.push(...matchZones(boot, query, remaining));
  return out;
}
