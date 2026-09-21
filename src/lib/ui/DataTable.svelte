<script lang="ts" generics="T">
  // atlas-3 step 2b: a virtualized, sortable, filterable data grid (species/zone tables). All hard
  // rules -- sort stability/null-ordering/numeric compare, filter-on-formatted-value, the
  // virtualization window, keyboard cell navigation -- are pure functions in dataTableCore.ts,
  // unit-tested there; this component only wires them to DOM state.
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import {
    type CellPosition,
    computeVisibleWindow,
    type DataTableColumn,
    filterRows,
    formatRowCountAnnouncement,
    nextCellPosition,
    scrollTopForRow,
    sortRows,
    type SortDirection,
  } from "./dataTableCore";

  interface Props {
    columns: DataTableColumn<T>[];
    rows: T[];
    getRowId?: (row: T) => string | number;
    /** viewport (scroll region) height, CSS px */
    height?: number;
    /** each row's fixed height, CSS px -- required for the virtualization math */
    rowHeight?: number;
    /** CSV export hook: the component EMITS the current filtered+sorted rows; it never writes a
     * file itself (the plan/spec.md: "a CSV export HOOK"). */
    onExport?: (rows: T[]) => void;
  }

  let { columns, rows, getRowId, height = 400, rowHeight = 32, onExport }: Props = $props();

  let sortColumnKey = $state<string | null>(null);
  let sortDirection = $state<SortDirection>(null);
  let filters = $state<Record<string, string>>({});
  let activeCell = $state<CellPosition>({ row: 0, col: 0 });
  let scrollTop = $state(0);
  let containerEl: HTMLDivElement | undefined;

  const sortColumn = $derived(columns.find((c) => c.key === sortColumnKey));
  const filteredRows = $derived(filterRows(rows, columns, filters));
  const sortedRows = $derived(sortRows(filteredRows, sortColumn, sortDirection));
  const windowState = $derived(
    computeVisibleWindow({
      scrollTop,
      viewportHeight: height,
      rowHeight,
      totalRows: sortedRows.length,
    }),
  );
  const visibleRows = $derived(sortedRows.slice(windowState.startIndex, windowState.endIndex));
  const pageSize = $derived(Math.max(1, Math.floor(height / rowHeight)));

  // ONE polite live-region announcement on load AND on filter (spec.md §11): derived off
  // filteredRows.length alone, which is set once on mount (the initial "load") and recomputed
  // whenever rows, columns or filters change -- never merely because of a sort or cell move
  // (sortedRows/activeCell are not read here, so they cannot retrigger it).
  const liveMessage = $derived(formatRowCountAnnouncement(filteredRows.length));

  function ariaSortFor(col: DataTableColumn<T>): "ascending" | "descending" | "none" | undefined {
    if (!col.sortable) return undefined;
    if (sortColumnKey !== col.key || !sortDirection) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  }

  function toggleSort(col: DataTableColumn<T>) {
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
    activeCell = { row: 0, col: 0 };
    scrollTop = 0;
    if (containerEl) containerEl.scrollTop = 0;
  }

  function cellValue(row: T, col: DataTableColumn<T>): string {
    return col.format ? col.format(row) : String(col.value(row) ?? "");
  }

  async function focusCell(pos: CellPosition) {
    await tick();
    containerEl
      ?.querySelector<HTMLElement>(`[data-row="${pos.row}"][data-col="${pos.col}"]`)
      ?.focus();
  }

  function moveTo(pos: CellPosition) {
    activeCell = pos;
    const nextScrollTop = scrollTopForRow(pos.row, scrollTop, height, rowHeight, sortedRows.length);
    if (nextScrollTop !== scrollTop) {
      scrollTop = nextScrollTop;
      if (containerEl) containerEl.scrollTop = nextScrollTop;
    }
    focusCell(pos);
  }

  function onCellClick(pos: CellPosition) {
    moveTo(pos);
  }

  // delegated on <tbody>: roving-tabindex cell navigation (arrow keys, Home/End, PageUp/PageDown).
  function onGridKeydown(event: KeyboardEvent) {
    const next = nextCellPosition(
      activeCell,
      event.key,
      sortedRows.length,
      columns.length,
      pageSize,
    );
    if (!next) return;
    event.preventDefault();
    moveTo(next);
  }

  function onScroll(event: Event) {
    scrollTop = (event.currentTarget as HTMLDivElement).scrollTop;
  }
</script>

<div class="datatable">
  <div class="toolbar">
    <div class="live-region" role="status" aria-live="polite">{liveMessage}</div>
    <button
      type="button"
      class="export-btn"
      onclick={() => onExport?.(sortedRows)}
      aria-label="Export visible rows as CSV"
    >
      <Icon name="download" size={16} />
      Export CSV
    </button>
  </div>

  <div
    class="scroll-region"
    bind:this={containerEl}
    style={`height:${height}px`}
    onscroll={onScroll}
  >
    <table
      class="grid"
      role="grid"
      aria-rowcount={sortedRows.length}
      aria-colcount={columns.length}
    >
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
                <Icon name="filter" size={14} class="filter-icon" />
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
      <!-- roving-tabindex cell navigation is delegated to one keydown listener on <tbody> rather
           than one per <td> (WAI-ARIA APG's own grid pattern does this); svelte-check's a11y rule
           does not have an exception for event delegation on a container that owns focusable
           descendants, hence the ignore. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <tbody onkeydown={onGridKeydown}>
        {#if sortedRows.length === 0}
          <tr>
            <td colspan={columns.length} class="empty">No rows match the current filter.</td>
          </tr>
        {:else}
          <tr aria-hidden="true" class="spacer" style={`height:${windowState.paddingTop}px`}>
            <td colspan={columns.length}></td>
          </tr>
          {#each visibleRows as row, i (getRowId ? getRowId(row) : windowState.startIndex + i)}
            {@const rowIndex = windowState.startIndex + i}
            <tr aria-rowindex={rowIndex + 1} style={`height:${rowHeight}px`}>
              {#each columns as col, colIndex (col.key)}
                {@const isActive = activeCell.row === rowIndex && activeCell.col === colIndex}
                <td
                  role="gridcell"
                  class="cell"
                  class:cell--numeric={col.numeric}
                  class:cell--active={isActive}
                  data-row={rowIndex}
                  data-col={colIndex}
                  tabindex={isActive ? 0 : -1}
                  onclick={() => onCellClick({ row: rowIndex, col: colIndex })}
                >
                  {cellValue(row, col)}
                </td>
              {/each}
            </tr>
          {/each}
          <tr aria-hidden="true" class="spacer" style={`height:${windowState.paddingBottom}px`}>
            <td colspan={columns.length}></td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .datatable {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .live-region {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
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

  .export-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .scroll-region {
    overflow: auto;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
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

  .sort-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  th[aria-sort="ascending"] .sort-btn,
  th[aria-sort="descending"] .sort-btn {
    color: var(--text-accent);
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

  .filter-field :global(.filter-icon) {
    color: var(--icon-muted);
    flex: none;
  }

  .filter-field input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1);
  }

  .filter-field input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .cell {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell--numeric {
    text-align: right;
  }

  .cell:focus-visible,
  .cell--active {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .spacer td {
    padding: 0;
    border: 0;
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
