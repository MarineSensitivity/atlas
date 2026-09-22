// atlas-4 step 1 — pure readers over `boot.json`'s scores-relevant shape: the drawable unit (D17:
// exactly one per release), the layer picker's groups/default, the study-area note and the
// "everything this release scored" zone key. No DOM, no map, no engine — every function here takes
// a plain `boot` and returns plain data, so a component only calls it (CLAUDE.md).
//
// `boot.units[]` carries exactly ONE row (master plan D17: programarea on v2-v9, planarea on v1;
// no subregion/ecoregion unit is ever published, whatever the geometry would support), so
// "the ONE `boot.units` row" is read positionally (`units[0]`), never by filtering for a type —
// there is nothing to filter among.
import { unitFromFld } from "../../lib/map/layers/zones";

export interface BootLayerRow {
  metric_key: string;
  label?: string;
  category: string;
  order: number;
  colormap?: string;
  by_subregion?: Record<string, { cog?: string; rescale?: [number, number] }>;
}

interface RawUnitRow {
  fld?: unknown;
  label?: unknown;
}

/** the release's one drawable unit's label (`boot.units[0].label`), or `null` when unpublished
 * (a boot with no units at all — e.g. before atlas-1 has published `boot.json`). */
export function primaryUnitLabel(boot: unknown): string | null {
  const units = (boot as { units?: unknown } | null | undefined)?.units;
  const row = Array.isArray(units) ? (units[0] as RawUnitRow | undefined) : undefined;
  return row && typeof row.label === "string" ? row.label : null;
}

/** the release's one drawable unit's TYPE (`fld` minus `_key`) — `"programarea"` everywhere except
 * v1, which is `"planarea"` (D17). `null` when unpublished. */
export function primaryUnitType(boot: unknown): string | null {
  const units = (boot as { units?: unknown } | null | undefined)?.units;
  const row = Array.isArray(units) ? (units[0] as RawUnitRow | undefined) : undefined;
  return row && typeof row.fld === "string" ? unitFromFld(row.fld) : null;
}

/** the Spatial units `<select>`'s options: `Raster cells (0.05°)` always first, then the release's
 * one drawable unit (derived from `boot.units[0]`, never hardcoded) when it publishes one. */
export function unitOptions(boot: unknown): { value: string; label: string }[] {
  const options = [{ value: "cell", label: "Raster cells (0.05°)" }];
  const type = primaryUnitType(boot);
  const label = primaryUnitLabel(boot);
  if (type && label) options.push({ value: type, label });
  return options;
}

/**
 * The sidebar note (atlas-4 §5.3 / parity doc §5.3): shown only when the release's one unit is NOT
 * `programarea` — today that is v1 alone, reporting on Planning Areas. `null` means "no note" (the
 * unit IS `programarea`, or the release publishes no unit at all — nothing to caveat).
 */
export function primaryUnitNote(boot: unknown, ver: string | null): string | null {
  const type = primaryUnitType(boot);
  const label = primaryUnitLabel(boot);
  if (!type || !label || type === "programarea") return null;
  return `${ver ?? "This release"} predates the BOEM Program Areas — it reports on ${label}.`;
}

/** the fixed display order of the layer picker's groups: the overall score first (matching the
 * ported app's "order 1 = Overall" convention — see boot.ts's module test for why this is NOT
 * `boot.layers[].order`, which the publisher numbers the other way, composite last), then the
 * ecoregion-rescaled components, then the raw metrics. */
const CATEGORY_GROUP_ORDER = ["composite", "component", "raw"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  composite: "Overall score",
  component: "Rescaled by ecoregion",
  raw: "Raw",
};

export interface LayerGroup {
  category: string;
  label: string;
  layers: BootLayerRow[];
}

function isLayerRow(raw: unknown): raw is BootLayerRow {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as BootLayerRow).metric_key === "string" &&
    typeof (raw as BootLayerRow).category === "string" &&
    typeof (raw as BootLayerRow).order === "number"
  );
}

/** every `boot.layers` row, validated, in the release's own order. */
export function layerRows(boot: unknown): BootLayerRow[] {
  const rows = (boot as { layers?: unknown } | null | undefined)?.layers;
  return Array.isArray(rows) ? rows.filter(isLayerRow) : [];
}

/**
 * The layer `<select>`'s groups: composite first (there is exactly one — the "overall score"),
 * then component, then raw, each sorted by the row's own `order` ascending. A category the release
 * does not publish is simply absent, never an empty group.
 */
export function layerGroups(boot: unknown): LayerGroup[] {
  const rows = layerRows(boot);
  const groups: LayerGroup[] = [];
  for (const category of CATEGORY_GROUP_ORDER) {
    const layers = rows.filter((r) => r.category === category).sort((a, b) => a.order - b.order);
    if (layers.length) groups.push({ category, label: CATEGORY_LABEL[category], layers });
  }
  // an unrecognized category (a future release) still gets a group, appended last, rather than
  // silently dropping those layers from the picker.
  const known = new Set<string>(CATEGORY_GROUP_ORDER);
  const otherCategories = [...new Set(rows.map((r) => r.category).filter((c) => !known.has(c)))];
  for (const category of otherCategories) {
    groups.push({
      category,
      label: category,
      layers: rows.filter((r) => r.category === category).sort((a, b) => a.order - b.order),
    });
  }
  return groups;
}

/**
 * The default layer: the release's one `category === "composite"` row (the overall score) —
 * derived, never `boot.layers[0]` or a hardcoded metric_key. `null` for a boot with no composite
 * row at all (should not happen on a published release, but this module never assumes it).
 */
export function defaultLayerKey(boot: unknown): string | null {
  const composite = layerRows(boot).find((r) => r.category === "composite");
  return composite?.metric_key ?? null;
}

export function layerByKey(boot: unknown, key: string | undefined | null): BootLayerRow | null {
  if (!key) return null;
  return layerRows(boot).find((r) => r.metric_key === key) ?? null;
}

/** `layer.by_subregion.FULL` — the raster is ALWAYS the FULL COG (D7: "the study area is a camera,
 * never a filter"); `subregionKey` is only ever overridden by a test. */
export function fullSubregion(
  layer: BootLayerRow,
  subregionKey = "FULL",
): { cog?: string; rescale?: [number, number] } | null {
  return layer.by_subregion?.[subregionKey] ?? null;
}

/**
 * `zone_all_key` (parity doc §2.4): the zone meaning "everything this release scored" — first of
 * `FULL`, `USA` present among the release's `subregion` zone keys, else the first available key,
 * else the literal fallback `"USA"`.
 */
export function zoneAllKey(boot: unknown): string {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const subregion = zones && typeof zones === "object" ? zones.subregion : undefined;
  if (!Array.isArray(subregion)) return "USA";
  const keys = subregion
    .map((z) => (z && typeof z === "object" ? (z as { key?: unknown }).key : undefined))
    .filter((k): k is string => typeof k === "string");
  return keys.find((k) => k === "FULL") ?? keys.find((k) => k === "USA") ?? keys[0] ?? "USA";
}

interface RawZoneRow {
  key?: unknown;
  name?: unknown;
  n_taxa?: unknown;
  metrics?: unknown;
}

export interface ZoneRow {
  key: string;
  name?: string;
  n_taxa: number | null;
  metrics: Record<string, number>;
}

/** every zone of `unit` (`boot.zones[unit]`), validated — the zones table and the choropleth's raw
 * material. `[]` for a unit the release does not publish (never a throw: an unknown `?unit=` must
 * fall back, not crash — CLAUDE.md). */
export function zoneRows(boot: unknown, unit: string): ZoneRow[] {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return [];
  const out: ZoneRow[] = [];
  for (const raw of rows as RawZoneRow[]) {
    if (!raw || typeof raw !== "object" || typeof raw.key !== "string") continue;
    const metrics: Record<string, number> = {};
    if (raw.metrics && typeof raw.metrics === "object") {
      for (const [k, v] of Object.entries(raw.metrics as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
      }
    }
    out.push({
      key: raw.key,
      name: typeof raw.name === "string" ? raw.name : undefined,
      n_taxa: typeof raw.n_taxa === "number" ? raw.n_taxa : null,
      metrics,
    });
  }
  return out;
}
