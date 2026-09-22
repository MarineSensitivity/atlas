// atlas-4 step 2 — the flower's title and its three data paths (cell / zone / default), as pure
// transforms into `FlowerComponentInput[]` (src/lib/ui/flowerGeometry.ts). The component-name rule
// (`extrisk_` / `_ecoregion_rescaled` stripped, `_` -> space, `all` dropped) is shared with
// `sql/cell_components.sql`'s own `regexp_replace` chain and `boot.ts`'s zone metrics — this module
// is the ONE place both paths turn a raw key into a component label, so they cannot drift apart.
import type { FlowerComponentInput } from "../../lib/ui/flowerGeometry";
import type { ZoneRow } from "./boot";

/** `metric_key` -> component label: `extrisk_bird_ecoregion_rescaled` -> `"bird"`,
 * `primprod_ecoregion_rescaled` -> `"primprod"` (parity doc §7.2 / §13.11, verbatim). */
export function componentLabel(metricKey: string): string {
  return metricKey
    .replace(/^extrisk_/, "")
    .replace(/_ecoregion_rescaled$/, "")
    .replace(/_/g, " ");
}

/** every `*_ecoregion_rescaled` metric key present in `metrics`, turned into flower inputs, with
 * `component == "all"` dropped (parity doc §7.2: "all dropping `component == 'all'`"). */
function fromMetrics(metrics: Record<string, number>): FlowerComponentInput[] {
  const out: FlowerComponentInput[] = [];
  for (const [key, score] of Object.entries(metrics)) {
    if (!/_ecoregion_rescaled$/.test(key)) continue;
    const label = componentLabel(key);
    if (label === "all") continue;
    out.push({ key: label, score: Number.isFinite(score) ? score : null });
  }
  return out;
}

/** the clicked zone's flower (`boot.zones[unit]`'s row for `key`). `null` when the zone or its
 * metrics are missing — the caller falls back to "no data" rather than an empty flower. */
export function zoneFlowerComponents(
  zones: readonly ZoneRow[],
  key: string,
): FlowerComponentInput[] | null {
  const zone = zones.find((z) => z.key === key);
  return zone ? fromMetrics(zone.metrics) : null;
}

interface FlowerDefaultRow {
  component?: unknown;
  score?: unknown;
}

/** `boot.flower_default[zoneAllKey]` — already `{component, score}` rows (not `metric_key`-shaped
 * like `boot.zones[*].metrics`), so this reads the label directly rather than through
 * `componentLabel()`. `null` when the release publishes none (e.g. v1, which predates the cache —
 * parity doc §11 gotcha 3/§13.12: this file's fallback is the caller's, never invented data). */
export function defaultFlowerComponents(
  boot: unknown,
  zoneAllKey: string,
): FlowerComponentInput[] | null {
  const flowerDefault = (boot as { flower_default?: Record<string, unknown> } | null | undefined)
    ?.flower_default;
  const rows =
    flowerDefault && typeof flowerDefault === "object" ? flowerDefault[zoneAllKey] : undefined;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out: FlowerComponentInput[] = [];
  for (const r of rows as FlowerDefaultRow[]) {
    if (!r || typeof r.component !== "string" || r.component === "all") continue;
    const score = typeof r.score === "number" ? r.score : null;
    out.push({ key: r.component, score });
  }
  return out;
}

/** one `sql/cell_components.sql` row, as returned by the engine. */
export interface CellComponentRow {
  metric_key: string;
  val: unknown;
  component: string;
}

/** the clicked cell's flower — `sql/cell_components.sql`'s rows already carry `component` computed
 * server-side (DuckDB's own `regexp_replace` chain, kept byte-identical to `componentLabel()`
 * above), so this only reshapes them; it does not re-derive the label. */
export function cellFlowerComponents(rows: readonly CellComponentRow[]): FlowerComponentInput[] {
  return rows
    .filter((r) => r.component !== "all")
    .map((r) => ({
      key: r.component,
      score: typeof r.val === "number" && Number.isFinite(r.val) ? r.val : null,
    }));
}

/** `flower_panel_title` (parity doc §7.1), verbatim: a clicked cell names its id + coords; a
 * clicked zone names itself; nothing selected says "Full study area". */
export function flowerTitle(
  selection:
    | { kind: "cell"; cellId: number; lon: number; lat: number }
    | { kind: "zone"; name: string }
    | null,
): string {
  if (!selection) return "Full study area";
  if (selection.kind === "cell") {
    return `Cell ID: ${selection.cellId} (x: ${selection.lon.toFixed(3)}, y: ${selection.lat.toFixed(3)})`;
  }
  return selection.name;
}
