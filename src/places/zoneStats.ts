// places/zoneStats.ts -- a defensive `boot.zones[unit][key]` reader for the places list's area
// km²/coverage %/composite chip (Deliverable 1, "Tier 0": no engine, no fetch -- it's already in
// `boot.json`).
//
// P8 item 2 (P7 handback + Opus docs review finding #27): the ORIGINAL guess here was a flat
// `composite`/`score`/`pct_covered`/`coverage` on each row, and NONE of those exist in a real
// release's `boot.json` -- every Program-Area row was reading undefined fields and falling back to
// "not analysed yet" forever, even though the composite is right there, published. The real shape
// (verified live, `s3://.../marine-atlas/v7/app/boot.json`, `zones.programarea[0]`):
//   { key: "ALA", n_cells: 45790, area_km2: 875225.03, n_taxa: 2503,
//     metrics: { ..., score_extriskspcat_primprod_ecoregionrescaled_equalweights: 28.28, ... },
//     coverage: null }
// The composite lives NESTED under `metrics`, keyed by THIS RELEASE's own composite metric_key --
// `boot.layers.find(l => l.category === "composite").metric_key` is the same rule
// `lens/scores/boot.ts#defaultLayerKey` uses to pick the layer `<select>`'s default (re-derived
// here, not imported, so this stays out of `src/lens/**`; the two can never disagree on WHICH key
// is the composite because both read the identical `boot.layers` contract). `coverage` is
// published EXPLICITLY as `null` on every v7 row -- "not published for this release", a permanent
// fact about the release, never "not analysed yet" (which implies a later step will fill it in;
// there is none for a zone -- its numbers are baked in at release time or they are not).
//
// Still defensive (this file's original rule stands): a boot with no `layers`/`metrics` at all, or
// a future shape that publishes the old flat fields directly, is read without throwing.

import type { Point } from "geojson";
import { zoneLabelsFromBoot } from "../lib/map/layers/zones";

export interface ZoneStat {
  key: string;
  name: string;
  areaKm2: number | null;
  coveragePct: number | null;
  composite: number | null;
  /** `"unpublished"` when this release genuinely carries no composite for the zone (distinct from
   * a `kind: "geom"` row's `"loading"`/`"error"` -- a zone row is read synchronously off `boot`, so
   * a missing number here is never "not yet" -- P8 item 2. */
  status?: "unpublished";
}

interface BootZoneRow {
  key?: unknown;
  name?: unknown;
  area_km2?: unknown;
  pct_covered?: unknown;
  coverage?: unknown;
  composite?: unknown;
  score?: unknown;
  metrics?: unknown;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `boot.layers`' one `category: "composite"` row's `metric_key` -- the key a zone row's `metrics`
 * object publishes the composite under (see the module header). `null` for a boot with no such
 * row. */
function compositeMetricKey(boot: unknown): string | null {
  const layers = (boot as { layers?: unknown } | null | undefined)?.layers;
  if (!Array.isArray(layers)) return null;
  for (const l of layers as { metric_key?: unknown; category?: unknown }[]) {
    if (l && l.category === "composite" && typeof l.metric_key === "string") return l.metric_key;
  }
  return null;
}

/** a zone row's composite: `metrics[compositeMetricKey(boot)]` first (the real shape), falling
 * back to a flat `composite`/`score` field in case a future release ever publishes one there
 * directly (this module's original defensive rule). */
function compositeOf(boot: unknown, raw: BootZoneRow): number | null {
  const key = compositeMetricKey(boot);
  const metrics = raw.metrics;
  if (key && metrics && typeof metrics === "object") {
    const v = num((metrics as Record<string, unknown>)[key]);
    if (v !== null) return v;
  }
  return num(raw.composite) ?? num(raw.score);
}

function statOf(boot: unknown, raw: BootZoneRow, key: string, name: string): ZoneStat {
  const composite = compositeOf(boot, raw);
  return {
    key,
    name,
    areaKm2: num(raw.area_km2),
    coveragePct: num(raw.pct_covered) ?? num(raw.coverage),
    composite,
    ...(composite === null ? { status: "unpublished" as const } : {}),
  };
}

/** one row of `boot.zones[unit]`, by key -- `null` when the release publishes no row for it (a key
 * from an old link that a later release retired, or a shape this reader has not seen yet). */
export function zoneStatFromBoot(boot: unknown, unit: string, key: string): ZoneStat | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object" || String(raw.key) !== key) continue;
    return statOf(boot, raw, key, typeof raw.name === "string" && raw.name ? raw.name : key);
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
        status: "unpublished",
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
    out.push(
      statOf(boot, raw, raw.key, typeof raw.name === "string" && raw.name ? raw.name : raw.key),
    );
  }
  return out.sort((a, b) => paLabel(a.key, a.name).localeCompare(paLabel(b.key, b.name)));
}

/** the list row's summary over several keys (a multi-pick zone place): areas SUM, composite is the
 * plain mean of the ones known. Display only -- the SAME published composite figures the row shows
 * are computed by msens at publish time; this never re-derives or feeds a score.
 *
 * P8 item 2: `status: "unpublished"` when NONE of `stats` carries a composite (every constituent
 * zone's own row says so) -- distinct from the geom-row `"loading"`/`"error"` states `Places.svelte`
 * reads for a drawn place, so the row never claims "not analysed yet" for a number this release
 * simply never published. */
export function summarizeZoneStats(stats: readonly ZoneStat[]): {
  areaKm2: number | null;
  coveragePct: number | null;
  composite: number | null;
  status?: "unpublished";
} {
  const areas = stats.map((s) => s.areaKm2).filter((v): v is number => v !== null);
  const covs = stats.map((s) => s.coveragePct).filter((v): v is number => v !== null);
  const comps = stats.map((s) => s.composite).filter((v): v is number => v !== null);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return {
    areaKm2: areas.length ? areas.reduce((a, b) => a + b, 0) : null,
    coveragePct: mean(covs),
    composite: mean(comps),
    ...(stats.length && !comps.length ? { status: "unpublished" as const } : {}),
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
