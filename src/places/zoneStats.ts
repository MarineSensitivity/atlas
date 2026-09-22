// places/zoneStats.ts -- a defensive `boot.zones[unit][key]` reader for the places list's area
// km²/coverage %/composite chip (Deliverable 1, "Tier 0": no engine, no fetch -- it's already in
// `boot.json`). atlas-1 has not published `boot.json`'s schema yet
// (`src/lib/release/boot.ts`'s own TODO), so this follows that file's rule: read defensively, never
// assume a key exists, and answer `null`/omit a field rather than throw or fabricate a number. Once
// atlas-1's schema lands, tighten the field names here against it (currently a tolerant guess at
// `area_km2`/`pct_covered`/`composite`, matching the vocabulary `analysis/queries.ts` already uses
// for the SAME numbers on a custom place).

import type { Point } from "geojson";
import { zoneLabelsFromBoot } from "../lib/map/layers/zones";

export interface ZoneStat {
  key: string;
  name: string;
  areaKm2: number | null;
  coveragePct: number | null;
  composite: number | null;
}

interface BootZoneRow {
  key?: unknown;
  name?: unknown;
  area_km2?: unknown;
  pct_covered?: unknown;
  coverage?: unknown;
  composite?: unknown;
  score?: unknown;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** one row of `boot.zones[unit]`, by key -- `null` when the release publishes no row for it (a key
 * from an old link that a later release retired, or a shape this reader has not seen yet). */
export function zoneStatFromBoot(boot: unknown, unit: string, key: string): ZoneStat | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object" || String(raw.key) !== key) continue;
    return {
      key,
      name: typeof raw.name === "string" && raw.name ? raw.name : key,
      areaKm2: num(raw.area_km2),
      coveragePct: num(raw.pct_covered) ?? num(raw.coverage),
      composite: num(raw.composite) ?? num(raw.score),
    };
  }
  return null;
}

/** every key of a zone place resolved against boot, in the place's own key order; a key with no
 * boot row still gets an entry (name = key, every number `null`) so the list never drops a row the
 * person picked -- it just cannot show its numbers yet. */
export function zoneStatsFor(boot: unknown, unit: string, keys: readonly string[]): ZoneStat[] {
  return keys.map(
    (k) =>
      zoneStatFromBoot(boot, unit, k) ?? {
        key: k,
        name: k,
        areaKm2: null,
        coveragePct: null,
        composite: null,
      },
  );
}

/** the list row's summary over several keys (a multi-pick zone place): areas SUM, composite is the
 * plain mean of the ones known. Display only -- the SAME published composite figures the row shows
 * are computed by msens at publish time; this never re-derives or feeds a score. */
export function summarizeZoneStats(stats: readonly ZoneStat[]): {
  areaKm2: number | null;
  coveragePct: number | null;
  composite: number | null;
} {
  const areas = stats.map((s) => s.areaKm2).filter((v): v is number => v !== null);
  const covs = stats.map((s) => s.coveragePct).filter((v): v is number => v !== null);
  const comps = stats.map((s) => s.composite).filter((v): v is number => v !== null);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return {
    areaKm2: areas.length ? areas.reduce((a, b) => a + b, 0) : null,
    coveragePct: mean(covs),
    composite: mean(comps),
  };
}

/** the display name for a zone place's row: every resolved name, ", "-joined -- "St. George
 * Basin, Western Gulf of Alaska" rather than raw keys once boot has a row for them. */
export function zoneDisplayName(stats: readonly ZoneStat[]): string {
  return stats.map((s) => s.name).join(", ");
}

/**
 * "Zoom to place" for a zone place (Deliverable 1): the mean of the picked keys' own label points
 * (`boot.zones[unit][*].label_pt`, the same points `map/layers/zones.ts` renders labels from) --
 * `null` when boot carries no labels for this unit, or none of `keys` has one, so the caller can
 * leave the camera alone rather than jump somewhere wrong.
 */
export function zoneCenterFromBoot(
  boot: unknown,
  unit: string,
  keys: readonly string[],
): { lon: number; lat: number } | null {
  const spec = zoneLabelsFromBoot(boot, unit);
  if (!spec) return null;
  const wanted = new Set(keys.map(String));
  const pts = spec.points.features.filter((f) => wanted.has(String(f.properties?.key)));
  if (!pts.length) return null;
  let lon = 0;
  let lat = 0;
  for (const f of pts) {
    const [x, y] = (f.geometry as Point).coordinates;
    lon += x;
    lat += y;
  }
  return { lon: lon / pts.length, lat: lat / pts.length };
}
