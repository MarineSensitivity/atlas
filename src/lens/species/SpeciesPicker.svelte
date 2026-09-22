<script lang="ts">
  // §5.4's species picker: client-side search over ~22k rows, grouped by sp_cat, "Only species in
  // US waters" (default on, keeping the selection across the swap — §13.1's trap), a virtualized
  // list (reusing `dataTableCore.ts`'s window math — the same tested code the species/zone tables
  // use, rather than a second virtualization implementation). Mounted into the shell's topbar
  // search field (the shared "Search species and places" input) when the species lens is active.
  import { onDestroy } from "svelte";
  import { computeVisibleWindow } from "../../lib/ui/dataTableCore";
  import {
    createSearchLogger,
    groupByCat,
    keepSelection,
    searchTaxa,
    visibleRows,
    type PickerRow,
    type TaxaIndex,
  } from "./data/picker";

  interface Props {
    index: TaxaIndex | null;
    selected: string | undefined;
    usOnly: boolean;
    onSelect: (key: string) => void;
    onSetUsOnly: (enabled: boolean) => void;
    /** `createSearchLogger` (data/picker.ts) already owns the 900 ms debounce, the >= 3 char
     * gate and the no-repeats rule — this fires only once all three have already passed. */
    onSearchLogged: (query: string) => void;
    onFocusIndex: () => void;
  }

  let { index, selected, usOnly, onSelect, onSetUsOnly, onSearchLogged, onFocusIndex }: Props =
    $props();

  let query = $state("");
  let open = $state(false);
  let scrollTop = $state(0);
  const searchLogger = createSearchLogger({ onLog: (q) => onSearchLogged(q) });
  onDestroy(() => searchLogger.destroy());

  const ROW_HEIGHT = 28;
  const VIEWPORT_HEIGHT = 320;

  type Row = { kind: "header"; cat: string } | { kind: "row"; row: PickerRow };

  function flatten(): Row[] {
    if (!index) return [];
    if (query.trim().length === 0) {
      const groups = groupByCat(visibleRows(index, usOnly));
      const out: Row[] = [];
      for (const g of groups) {
        out.push({ kind: "header", cat: g.cat });
        for (const r of g.rows) out.push({ kind: "row", row: r });
      }
      return out;
    }
    return searchTaxa(index, query, { usOnly }).map((m) => ({ kind: "row", row: m.row }) as Row);
  }

  const rows = $derived(flatten());
  const windowState = $derived(
    computeVisibleWindow({
      scrollTop,
      viewportHeight: VIEWPORT_HEIGHT,
      rowHeight: ROW_HEIGHT,
      totalRows: rows.length,
    }),
  );
  const visible = $derived(rows.slice(windowState.startIndex, windowState.endIndex));

  function onInput(value: string) {
    query = value;
    open = true;
    searchLogger.onInput(query);
  }

  function pick(row: PickerRow) {
    open = false;
    query = "";
    onSelect(row.key);
  }

  function onScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  }

  function toggleUsOnly(next: boolean) {
    if (!index) {
      onSetUsOnly(next);
      return;
    }
    const kept = keepSelection(index, selected, next);
    onSetUsOnly(next);
    if (kept && kept !== selected) onSelect(kept);
  }
</script>

<div class="species-picker">
  <input
    type="search"
    class="picker-input"
    aria-label="Search species"
    placeholder="Search species"
    value={query}
    onfocus={() => {
      open = true;
      onFocusIndex();
    }}
    oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
  />
  <label class="us-only">
    <input
      type="checkbox"
      checked={usOnly}
      onchange={(e) => toggleUsOnly(e.currentTarget.checked)}
    />
    Only species in US waters
  </label>

  {#if open && index}
    <div
      class="picker-list"
      role="listbox"
      aria-label="Species results"
      style={`height:${VIEWPORT_HEIGHT}px`}
      onscroll={onScroll}
    >
      <div style={`height:${windowState.paddingTop}px`}></div>
      {#each visible as r, i (r.kind === "row" ? r.row.key : `hdr-${windowState.startIndex + i}`)}
        {#if r.kind === "header"}
          <div class="picker-group" role="presentation">{r.cat}</div>
        {:else}
          <button
            type="button"
            role="option"
            aria-selected={r.row.key === selected}
            class="picker-option"
            class:selected={r.row.key === selected}
            onclick={() => pick(r.row)}
          >
            {r.row.label}
          </button>
        {/if}
      {/each}
      <div style={`height:${windowState.paddingBottom}px`}></div>
    </div>
  {/if}
</div>

<style>
  .species-picker {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .picker-input {
    height: var(--size-touch);
    width: 100%;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
  }

  .us-only {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .picker-list {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: 30;
    overflow: auto;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--elev-3);
  }

  .picker-group {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
    background: var(--surface-sunken);
  }

  .picker-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-1) var(--space-3);
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .picker-option:hover,
  .picker-option.selected {
    background: var(--fill-control);
  }
</style>
