<script lang="ts">
  // atlas-4 step 3 — the zones table: every zone of the unit, ranked by the current layer, with
  // every component alongside. The keyboard/screen-reader equivalent of the choropleth (atlas-4
  // subplan's "New" bullet): a sighted user reads colour-by-value on the map; this table is the
  // SAME ranking as text, and clicking a row selects that zone exactly as clicking its polygon
  // would (`sel=zone:<unit>:<key>`).
  import { SvelteSet } from "svelte/reactivity";
  import { zonesTableRows, type ZonesTableRow } from "./zonesTable";
  import type { ZoneRow } from "./boot";

  interface Props {
    zones: ZoneRow[];
    metricKey: string;
    metricLabel: string;
    componentKeys: string[];
    onSelectZone: (key: string) => void;
    /** atlas-7 step 4: "Report on selected" -- omit to hide the checkbox column/button entirely
     * (a caller with no report entry point wired up yet, e.g. a gallery/mockup usage). */
    onReportSelected?: (keys: string[]) => void;
  }

  let { zones, metricKey, metricLabel, componentKeys, onSelectZone, onReportSelected }: Props =
    $props();

  const rows = $derived(zonesTableRows(zones, metricKey, componentKeys));

  // a plain Set, not derived from `rows`: the selection is the user's OWN choice and must survive
  // a re-sort/re-rank when the ranked metric changes underneath it (atlas-4's layer picker can
  // change `metricKey` while this panel stays open).
  const selected = new SvelteSet<string>();

  function toggle(key: string, checked: boolean) {
    if (checked) selected.add(key);
    else selected.delete(key);
  }

  // rank order (the table's own current order), not selection order -- a report's Table of Scores
  // is submission order, and this table's rank order is the closest thing to "the order the user
  // was looking at" for a multi-select made here.
  const selectedInRankOrder = $derived(rows.map((r) => r.key).filter((k) => selected.has(k)));

  function formatValue(v: number | null): string {
    return v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
</script>

<div class="zones-table-wrap">
  {#if onReportSelected}
    <div class="zones-table-toolbar">
      <button
        type="button"
        disabled={selectedInRankOrder.length === 0}
        onclick={() => onReportSelected?.(selectedInRankOrder)}
      >
        Report on selected ({selectedInRankOrder.length})
      </button>
    </div>
  {/if}
  <div class="zones-table">
    <table class="grid" aria-label="Zones ranked by {metricLabel}">
      <thead>
        <tr>
          {#if onReportSelected}
            <th scope="col"><span class="sr-only">Select</span></th>
          {/if}
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
            {#if onReportSelected}
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name} for report`}
                  checked={selected.has(r.key)}
                  onchange={(e) => toggle(r.key, (e.currentTarget as HTMLInputElement).checked)}
                />
              </td>
            {/if}
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
</div>

<style>
  .zones-table-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-2);
  }

  .zones-table-toolbar button {
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .zones-table-toolbar button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

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
