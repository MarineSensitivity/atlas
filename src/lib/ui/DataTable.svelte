<script lang="ts" generics="T">
  // atlas-3 step 2b: a virtualized, sortable, filterable data grid (species/zone tables). All hard
  // rules -- sort stability/null-ordering/numeric compare, filter-on-formatted-value, the
  // virtualization window, keyboard cell navigation -- are pure functions in dataTableCore.ts,
  // unit-tested there; this component only wires them to DOM state.
  import { tick } from "svelte";
  import { announce } from "./announcer";
  import Icon from "./Icon.svelte";
  import {
    type CellPosition,
    columnWidthPx,
    computeVisibleWindow,
    type DataTableColumn,
    filterRows,
    formatRowCountAnnouncement,
    gridRowCount,
    gridRowIndex,
    nextCellPosition,
    scrollTopForRow,
    sortRows,
    type SortDirection,
    totalTableWidthPx,
  } from "./dataTableCore";

  interface Props {
    /** the grid's accessible name (SC 1.3.1/4.1.2: a grid must have one) AND the subject named in
     * its "loaded" announcement, e.g. "Species table" -> "Species table loaded, 1,234 rows". */
    label: string;
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

  let { label, columns, rows, getRowId, height = 400, rowHeight = 32, onExport }: Props = $props();

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
  // dataTableCore.ts's own header: `table-layout: fixed` only honours a `<colgroup>`'s widths once
  // the `<table>` has an explicit (summed) pixel width -- `width: max-content`/`auto` do not
  // qualify (measured on real Chromium: every column ignored its `<col>` width and sized itself
  // from its own content instead).
  const tableWidthPx = $derived(totalTableWidthPx(columns));

  // announces through the ONE shared live region (spec.md §11 / SC 4.1.3 -- this component
  // renders no role="status" of its own) on load AND on every filter change: tracks
  // filteredRows.length alone, so a sort or a cell move (sortedRows/activeCell are not read here)
  // never retriggers it. The FIRST run (isInitialLoad still true) names the subject ("Species
  // table loaded, …"); every run after that is a plain "Filtered to …" -- see
  // formatRowCountAnnouncement's own header for why.
  let isInitialLoad = true;
  $effect(() => {
    const count = filteredRows.length;
    announce(formatRowCountAnnouncement(count, isInitialLoad ? "loaded" : "filtered", label));
    isInitialLoad = false;
  });

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
      style={`width:${tableWidthPx}px`}
      role="grid"
      aria-label={label}
      aria-rowcount={gridRowCount(sortedRows.length)}
      aria-colcount={columns.length}
    >
      <!-- P3 fix (owner-reported, 2026-09-24): an explicit per-column width (dataTableCore.ts#
           columnWidthPx -- a readable minimum for text, narrower for numeric), PLUS an explicit
           summed `width` on the table itself (`tableWidthPx`, above) -- `table-layout: fixed` only
           honours a `<colgroup>` once the table has a definite width (dataTableCore.ts's own
           header) -- so a wide column set scrolls the table horizontally instead of squeezing
           every column to fit. -->
      <colgroup>
        {#each columns as col (col.key)}
          <col style={`width:${columnWidthPx(col)}px`} />
        {/each}
      </colgroup>
      <thead>
        <tr aria-rowindex="1">
          {#each columns as col, colIndex (col.key)}
            <th scope="col" class:sticky-col={colIndex === 0} aria-sort={ariaSortFor(col)}>
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
        <tr class="filter-row" aria-rowindex="2">
          {#each columns as col, colIndex (col.key)}
            <th scope="col" class:sticky-col={colIndex === 0}>
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
          <tr aria-rowindex={gridRowIndex(0)}>
            <td colspan={columns.length} class="empty">No rows match the current filter.</td>
          </tr>
        {:else}
          <tr aria-hidden="true" class="spacer" style={`height:${windowState.paddingTop}px`}>
            <td colspan={columns.length}></td>
          </tr>
          {#each visibleRows as row, i (getRowId ? getRowId(row) : windowState.startIndex + i)}
            {@const rowIndex = windowState.startIndex + i}
            <tr aria-rowindex={gridRowIndex(rowIndex)} style={`height:${rowHeight}px`}>
              {#each columns as col, colIndex (col.key)}
                {@const isActive = activeCell.row === rowIndex && activeCell.col === colIndex}
                <td
                  role="gridcell"
                  class="cell"
                  class:cell--numeric={col.numeric}
                  class:cell--active={isActive}
                  class:sticky-col={colIndex === 0}
                  data-row={rowIndex}
                  data-col={colIndex}
                  tabindex={isActive ? 0 : -1}
                  title={cellValue(row, col)}
                  onclick={() => onCellClick({ row: rowIndex, col: colIndex })}
                >
                  <span class="cell-text">{cellValue(row, col)}</span>
                  {#if isActive}
                    <!-- SC 1.4.4/1.4.12: the cell text stays single-line + ellipsized so the
                         virtualization's fixed rowHeight math holds at 10k rows, but a
                         keyboard-focused (or hovered) cell reveals its FULL, un-clipped value --
                         nothing longer than the column width is ever unrecoverable, at any zoom
                         or text-spacing setting. -->
                    <span class="cell-expand">{cellValue(row, col)}</span>
                  {/if}
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
    justify-content: flex-end;
    gap: var(--space-2);
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

  /* P3 fix (owner-reported, 2026-09-24): each column gets an explicit width from `<colgroup>`
     (dataTableCore.ts#columnWidthPx); `width` (the SUM of those widths, `tableWidthPx`) is set
     inline above, per dataTableCore.ts's own header -- `table-layout: fixed` only honours a
     `<colgroup>` once the table has a DEFINITE width, never `max-content`/`auto`. `min-width: 100%`
     still stretches it (proportionally) to fill a panel wide enough to hold every column without
     scrolling; a narrower panel scrolls `.scroll-region` (below) horizontally instead of squeezing
     every column evenly. */
  .grid {
    min-width: 100%;
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

  /* the first (identifying) column: sticky on the LEFT too, so it survives a horizontal scroll the
     same way the header row survives a vertical one. A header cell that is both column- and
     row-sticky needs the higher z-index so it stacks above a plain top-sticky header cell
     scrolling underneath it. */
  .sticky-col {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--surface-sunken);
  }

  /* `.cell` (below) also sets `position: relative` for `.cell-expand`'s own absolute positioning
     -- `.cell.sticky-col` (two classes, higher specificity than either alone) makes sure
     `position: sticky` always wins on a body cell that carries both, regardless of declaration
     order. */
  .cell.sticky-col {
    position: sticky;
    left: 0;
    z-index: 1;
    /* opaque -- must fully cover whatever column scrolled out from underneath it, not blend with
       the panel's own translucent glass background. */
    background: var(--surface-raised);
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

  /* atlas-8 fix (spec.md §11): touch-targets.css already gives the WRAPPING `.filter-field` label
     44px on a coarse pointer, but the raw `<input>` inside it stayed ~27x28px (its own intrinsic
     size) -- a coarse pointer landing anywhere on the label still hits the 44px hit target, but
     the visible, tappable INPUT itself did not read as 44px tall, which is what spec §11 (unlike
     SC 2.5.8, which only requires the target/hit-area) actually asks for. */
  @media (pointer: coarse) {
    .filter-field input {
      min-height: var(--size-touch);
    }
  }

  .cell {
    position: relative;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
  }

  .cell-text {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell--numeric {
    text-align: right;
  }

  /* a REAL focus (the browser's own indicator) is a distinct, stronger ring from "this is the
     cell roving tabindex would land on if you tabbed into the grid" -- .cell--active alone used
     to paint the SAME strong ring even while the grid itself had no focus at all, which read as
     "the table has focus" when it did not (SC 4.1.2: the visual state must match what a screen
     reader would report -- the cell is not, in fact, focused). */
  .cell:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .cell--active:not(:focus-visible) {
    outline: 1px dashed var(--border-control);
    outline-offset: -2px;
  }

  /* SC 1.4.4/1.4.12: reveals the cell's full, un-clipped value on hover or focus -- a child of
     .cell, so it counts toward :hover for as long as the pointer is over EITHER the cell or the
     overlay itself (SC 1.4.13's "hoverable"), with no separate JS needed for that. */
  .cell-expand {
    display: none;
  }

  .cell:hover .cell-expand,
  .cell:focus .cell-expand {
    display: block;
    position: absolute;
    left: 0;
    top: 100%;
    z-index: 20;
    max-width: 320px;
    white-space: normal;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: var(--elev-2);
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
