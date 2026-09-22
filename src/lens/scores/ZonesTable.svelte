<script lang="ts">
  // atlas-4 step 3 — the zones table: every zone of the unit, ranked by the current layer, with
  // every component alongside. The keyboard/screen-reader equivalent of the choropleth (atlas-4
  // subplan's "New" bullet): a sighted user reads colour-by-value on the map; this table is the
  // SAME ranking as text, and clicking a row selects that zone exactly as clicking its polygon
  // would (`sel=zone:<unit>:<key>`).
  import { zonesTableRows, type ZonesTableRow } from "./zonesTable";
  import type { ZoneRow } from "./boot";

  interface Props {
    zones: ZoneRow[];
    metricKey: string;
    metricLabel: string;
    componentKeys: string[];
    onSelectZone: (key: string) => void;
  }

  let { zones, metricKey, metricLabel, componentKeys, onSelectZone }: Props = $props();

  const rows = $derived(zonesTableRows(zones, metricKey, componentKeys));

  function formatValue(v: number | null): string {
    return v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
</script>

<div class="zones-table">
  <table class="grid" aria-label="Zones ranked by {metricLabel}">
    <thead>
      <tr>
        <th scope="col">Rank</th>
        <th scope="col">Zone</th>
        <th scope="col">{metricLabel}</th>
        {#if rows[0]}
          {#each rows[0].components as c (c.label)}
            <th scope="col">{c.label}</th>
          {/each}
        {/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, i (row.key)}
        {@const r = row as ZonesTableRow}
        <tr>
          <td class="num">{i + 1}</td>
          <td>
            <button type="button" class="zone-link" onclick={() => onSelectZone(r.key)}>
              {r.name}
            </button>
          </td>
          <td class="num">{formatValue(r.value)}</td>
          {#each r.components as c (c.label)}
            <td class="num">{formatValue(c.score)}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .zones-table {
    overflow: auto;
    max-height: 50vh;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  th {
    position: sticky;
    top: 0;
    background: var(--surface-sunken);
    text-align: left;
    padding: var(--space-1) var(--space-2);
  }

  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
    white-space: nowrap;
  }

  .num {
    text-align: right;
  }

  .zone-link {
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }

  .zone-link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
