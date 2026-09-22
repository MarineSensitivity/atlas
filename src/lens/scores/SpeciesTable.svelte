<script lang="ts">
  // atlas-4 step 2 — the species table (parity doc §7.4/§7.5). A BESPOKE grid rather than
  // src/lib/ui/DataTable.svelte: that component renders every cell as plain text
  // (`String(value)`), and this table needs two REAL `<a>` cells (taxon -> BOTW/WoRMS, model ->
  // the species lens in place) with working modifier-click/new-tab/screen-reader "open link"
  // behaviour, which plain-text cells cannot provide. It still reuses `dataTableCore.ts`'s proven,
  // unit-tested sort/filter functions (CLAUDE.md: "keep core logic in an exported function"), so
  // this component is wiring, not a second implementation of sort/filter semantics. Keyboard CELL
  // navigation (roving tabindex) and row virtualization are NOT re-implemented here — species
  // tables run to the low thousands of rows, not DataTable's 10k design point, and per-column
  // sort/filter plus ordinary Tab order already reach every control; see the atlas-4 report.
  import { announce } from "../../lib/ui/announcer";
  import Icon from "../../lib/ui/Icon.svelte";
  import {
    filterRows,
    sortRows,
    type DataTableColumn,
    type SortDirection,
  } from "../../lib/ui/dataTableCore";
  import type { SpeciesRow } from "../../lib/analysis/queries";
  import type { Sel } from "../../lib/state/types";
  import { formatAreaKm2, formatPercent0, formatPercent2, modelHref, taxonUrl } from "./species";

  interface Props {
    label: string;
    rows: SpeciesRow[];
    sel: Sel;
    onModelClick: (mdlKey: string) => void;
  }

  let { label, rows, sel, onModelClick }: Props = $props();

  function taxonStr(row: SpeciesRow): string {
    return `${row.taxon_authority ?? ""}:${row.taxon_id ?? ""}`;
  }

  const columns: DataTableColumn<SpeciesRow>[] = [
    { key: "cat", label: "Category", value: (r) => r.sp_cat, sortable: true },
    { key: "taxon", label: "Taxon", value: taxonStr, sortable: true },
    { key: "scientific", label: "Scientific name", value: (r) => r.sp_scientific, sortable: true },
    { key: "common", label: "Common name", value: (r) => r.sp_common ?? "", sortable: true },
    { key: "er_code", label: "ER code", value: (r) => r.er_code ?? "", sortable: true },
    {
      key: "er_score",
      label: "ER score",
      value: (r) => r.er_score,
      format: (r) => formatPercent0(r.er_score),
      sortable: true,
      numeric: true,
    },
    { key: "model", label: "Model", value: (r) => r.mdl_key, sortable: true },
    {
      key: "is_mmpa",
      label: "MMPA",
      value: (r) => r.is_mmpa,
      format: (r) => (r.is_mmpa ? "Yes" : "No"),
      sortable: true,
    },
    {
      key: "is_mbta",
      label: "MBTA",
      value: (r) => r.is_mbta,
      format: (r) => (r.is_mbta ? "Yes" : "No"),
      sortable: true,
    },
    {
      key: "area_km2",
      label: "Area (km²)",
      value: (r) => r.area_km2,
      format: (r) => formatAreaKm2(r.area_km2),
      sortable: true,
      numeric: true,
    },
    {
      key: "avg_suit",
      label: "Avg. suitability",
      value: (r) => r.avg_suit,
      format: (r) => formatPercent2(r.avg_suit),
      sortable: true,
      numeric: true,
    },
    {
      key: "pct_cat",
      label: "% of category",
      value: (r) => r.pct_cat,
      format: (r) => formatPercent2(r.pct_cat),
      sortable: true,
      numeric: true,
    },
  ];

  let sortColumnKey = $state<string | null>(null);
  let sortDirection = $state<SortDirection>(null);
  let filters = $state<Record<string, string>>({});

  const sortColumn = $derived(columns.find((c) => c.key === sortColumnKey));
  const filteredRows = $derived(filterRows(rows, columns, filters));
  const sortedRows = $derived(sortRows(filteredRows, sortColumn, sortDirection));

  let isInitialLoad = true;
  $effect(() => {
    const count = filteredRows.length;
    announce(
      isInitialLoad
        ? `${label} loaded, ${count.toLocaleString("en-US")} rows`
        : `Filtered to ${count.toLocaleString("en-US")} rows`,
    );
    isInitialLoad = false;
  });

  function ariaSortFor(col: DataTableColumn<SpeciesRow>) {
    if (!col.sortable) return undefined;
    if (sortColumnKey !== col.key || !sortDirection) return "none" as const;
    return sortDirection === "asc" ? ("ascending" as const) : ("descending" as const);
  }

  function toggleSort(col: DataTableColumn<SpeciesRow>) {
    if (!col.sortable) return;
    if (sortColumnKey !== col.key) {
      sortColumnKey = col.key;
      sortDirection = "asc";
    } else if (sortDirection === "asc") {
      sortDirection = "desc";
    } else {
      sortColumnKey = null;
      sortDirection = null;
    }
  }

  function onFilterInput(key: string, value: string) {
    filters = { ...filters, [key]: value };
  }

  function cellText(row: SpeciesRow, col: DataTableColumn<SpeciesRow>): string {
    return col.format ? col.format(row) : String(col.value(row) ?? "");
  }

  /** the model link's ordinary click: switch lens IN PLACE (no reload); a modifier-click or
   * middle-click falls through to the browser's own new-tab default action untouched. */
  function handleModelClick(event: MouseEvent, mdlKey: string) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onModelClick(mdlKey);
  }
</script>

<div class="species-table">
  <div class="scroll-region">
    <table class="grid" aria-label={label}>
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th scope="col" aria-sort={ariaSortFor(col)}>
              {#if col.sortable}
                <button type="button" class="sort-btn" onclick={() => toggleSort(col)}>
                  <span>{col.label}</span>
                  {#if sortColumnKey === col.key && sortDirection}
                    <Icon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} size={14} />
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
        <tr class="filter-row">
          {#each columns as col (col.key)}
            <th scope="col">
              <label class="filter-field">
                <span class="sr-only">Filter {col.label}</span>
                <Icon name="filter" size={12} class="filter-icon" />
                <input
                  type="text"
                  value={filters[col.key] ?? ""}
                  placeholder={col.label}
                  oninput={(e) =>
                    onFilterInput(col.key, (e.currentTarget as HTMLInputElement).value)}
                />
              </label>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if sortedRows.length === 0}
          <tr>
            <td colspan={columns.length} class="empty">No rows match the current filter.</td>
          </tr>
        {:else}
          {#each sortedRows as row (row.mdl_key + "|" + row.sp_scientific)}
            <tr>
              {#each columns as col (col.key)}
                <td class:num={col.numeric}>
                  {#if col.key === "taxon"}
                    <a
                      href={taxonUrl(row.taxon_authority, row.taxon_id)}
                      target="_blank"
                      rel="noopener"
                    >
                      {cellText(row, col)}
                    </a>
                  {:else if col.key === "model"}
                    <a
                      href={modelHref(sel, row.mdl_key)}
                      onclick={(e) => handleModelClick(e, row.mdl_key)}
                    >
                      {cellText(row, col)}
                    </a>
                  {:else}
                    {cellText(row, col)}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .species-table {
    font-size: var(--text-sm);
  }

  .scroll-region {
    overflow: auto;
    max-height: 50vh;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-sunken);
    text-align: left;
    padding: 0;
  }

  .sort-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-2);
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .filter-row th {
    padding: var(--space-1) var(--space-2) var(--space-2);
    font-weight: 400;
  }

  .filter-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    padding: 0 var(--space-1);
    background: var(--surface-sunken);
  }

  .filter-field input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    padding: var(--space-1);
    width: 80px;
  }

  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
    white-space: nowrap;
  }

  td.num {
    text-align: right;
  }

  .empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--text-secondary);
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
</style>
