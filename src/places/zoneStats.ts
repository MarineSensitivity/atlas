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

/**
 * Every zone of `unit` the release publishes at all -- the Places panel's "Add a Program Area"
 * chooser (orchestrator-directed, 2026-09-24: "the Places tool currently has NO Program Area list
 * at all, only Pick mode on the map"), sorted by its own resolved `paLabel` text ("Full Name (KEY)"
 * when published, else the bare key) so the list reads alphabetically by name, not by boot's own
 * publish order. `[]` for a unit the release does not publish (never a throw).
 */
export function allZoneStats(boot: unknown, unit: string): ZoneStat[] {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return [];
  const out: ZoneStat[] = [];
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object" || typeof raw.key !== "string") continue;
    out.push({
      key: raw.key,
      name: typeof raw.name === "string" && raw.name ? raw.name : raw.key,
      areaKm2: num(raw.area_km2),
      coveragePct: num(raw.pct_covered) ?? num(raw.coverage),
      composite: num(raw.composite) ?? num(raw.score),
    });
  }
  return out.sort((a, b) => paLabel(a.key, a.name).localeCompare(paLabel(b.key, b.name)));
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

/**
 * P3 fix (owner-reported, 2026-09-24): "Program area selection should list full names and
 * parenthetical acronyms" -- everywhere a Program Area (or any zone) is presented to the user, it
 * reads "Aleutian Arc (ALA)", never the bare key alone. `name` is whatever the release's app
 * bundle publishes for this key (`ZoneStat.name`, already falls back to `key` when the bundle
 * carries no `name` row -- `zoneStatFromBoot` above) -- when it is missing OR happens to equal the
 * key, this falls back to the bare key rather than printing "ALA (ALA)". URLs/state stay keyed by
 * the acronym; this is display text only.
 */
export function paLabel(key: string, name: string | null | undefined): string {
  if (!name || name === key) return key;
  return `${name} (${key})`;
}

/** the display name for a zone place's row: every resolved "Name (KEY)" label (`paLabel`, above),
 * ", "-joined -- "St. George Basin (GAA), Western Gulf of Alaska (WGA)" once boot has a row for
 * them; falls back to the bare key per zone when the bundle publishes none. */
export function zoneDisplayName(stats: readonly ZoneStat[]): string {
  return stats.map((s) => paLabel(s.key, s.name)).join(", ");
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
