// atlas-4 step 3 — the zones table: every zone of the unit, ranked by the current layer, with
// every component alongside. "The keyboard and screen-reader equivalent of the choropleth"
// (atlas-4 subplan's "New" bullet) — pure, so the ranking/formatting is provable without a DOM.
// Values are `boot.zones[unit][*].metrics` read verbatim (never recomputed), which is what makes
// the atlas-4 gate "the zone flower and zones table equal `zone_metric` exactly" trivially true.
import { componentLabel } from "./flower";
import type { ZoneRow } from "./boot";

export interface ZonesTableRow {
  key: string;
  name: string;
  /** the current layer's value for this zone, or `null` when unpublished. */
  value: number | null;
  /** component label (`flower.ts`'s `componentLabel`) -> score, in `componentKeys`' order. */
  components: ReadonlyArray<{ label: string; score: number | null }>;
}

function metricOf(z: ZoneRow, key: string): number | null {
  const v = z.metrics[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * `zones` ranked by `metricKey` descending (unpublished/non-finite values sort LAST, in either
 * direction — the same "nulls always last" rule `dataTableCore.ts`'s `sortRows` uses), each row
 * carrying every `componentKeys` value alongside.
 */
export function zonesTableRows(
  zones: readonly ZoneRow[],
  metricKey: string,
  componentKeys: readonly string[],
): ZonesTableRow[] {
  const rows: ZonesTableRow[] = zones.map((z) => ({
    key: z.key,
    name: z.name ?? z.key,
    value: metricOf(z, metricKey),
    components: componentKeys.map((k) => ({ label: componentLabel(k), score: metricOf(z, k) })),
  }));
  return rows.sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value;
  });
}
