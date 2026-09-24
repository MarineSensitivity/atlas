<script lang="ts">
  // R3 (round-2 plan §5 U4, `docs/usability.md` §7 R3, Ben's decision 2026-09-24): "one Layers panel
  // that IS the stack, the data row expanding into today's controls — PLUS the ability to change
  // the stacking of data layers (Program Areas, the score raster) relative to map layers (place
  // names, bathymetry)." Lens-independent (both `ScoresLens.svelte` and `SpeciesLens.svelte` mount
  // this the same way, per this task's own Deliverable 3): it owns the STACK rows (name, eye toggle,
  // opacity, ▲▼ move) and hands the lens's own controls to the `dataControls` snippet, unmodified.
  //
  // This component never touches MapLibre or `composeStyle` — it only reads/writes
  // `LayerStackEntry[]` (`../map/layerStack.ts`, the pure model `style.ts#composeStyle` consumes via
  // its `layerStack` input). `Shell.svelte` owns turning a change here into `selStore.set({layers})`
  // (URL-is-the-view, CLAUDE.md) — this component only calls `onChange`.
  import { tick, type Snippet } from "svelte";
  import Switch from "./Switch.svelte";
  import Icon from "./Icon.svelte";
  import {
    LAYER_GROUP_ENABLED,
    LAYER_GROUP_LABEL,
    defaultLayerStackEntries,
    isDefaultLayerStack,
    moveLayerStackEntry,
    type LayerGroupId,
    type LayerStackEntry,
  } from "../map/layerStack";

  interface Props {
    stack: readonly LayerStackEntry[];
    onChange: (next: readonly LayerStackEntry[]) => void;
    /** the lens's own controls (today's scores `LayersPanel.svelte` content / species'
     * title+layer-bar+card), rendered inside the "Data" row once it is expanded. Optional so a
     * lens that has not resolved yet (boot still loading) can omit it and the row just shows
     * nothing below its header — never a placeholder that looks like a bug. */
    dataControls?: Snippet;
  }

  let { stack, onChange, dataControls }: Props = $props();

  /** the ONE row this panel expands — "Data", the lens's own layer (round-2 plan: "the data row
   * expanding into today's controls"). Every other group is visible/opacity/reorder only. */
  const DATA_ROW_ID: LayerGroupId = "data-raster";

  /** m6 (review round 1): `aria-controls` target for the Data row's expander button — only one
   * `LayersPanel` is ever mounted at a time (the active lens owns the rail), so a static id is
   * safe. */
  const DATA_ROW_BODY_ID = "layers-data-row-body";

  // "the stack in draw order (top of the list = top of the map)" (Deliverable 3) -- the MODEL's own
  // array is bottom-to-top (style.ts#LAYER_ORDER's convention: index 0 paints first, i.e. lowest),
  // so the panel reverses it for DISPLAY only. `arrIndex` is kept alongside each row so a move
  // button can call `moveLayerStackEntry` against the model's own indexing without the caller
  // re-deriving it from the reversed position.
  const rows = $derived(
    stack
      .map((entry, arrIndex) => ({ entry, arrIndex }))
      .slice()
      .reverse(),
  );

  let expandedId = $state<LayerGroupId | null>(DATA_ROW_ID);
  // a single, transient status line for the panel's ONE `aria-live` region (never one per row --
  // the region announces whichever move/reset just happened; a screen-reader user hears it exactly
  // once per action, matching how `Announcer.svelte`'s shell-wide region is already used elsewhere
  // in this app for a non-visual confirmation of a state change).
  let announce = $state("");

  function toggleExpanded(id: LayerGroupId) {
    expandedId = expandedId === id ? null : id;
  }

  function setVisible(id: LayerGroupId, visible: boolean) {
    onChange(stack.map((e) => (e.id === id ? { ...e, visible } : e)));
  }

  function setOpacity(id: LayerGroupId, opacity: number) {
    onChange(stack.map((e) => (e.id === id ? { ...e, opacity } : e)));
  }

  // m4 (review round 1): a move that lands its row at the very top/bottom of the stack disables
  // the button just clicked (it reached the end it moves toward) -- a keyboard/screen-reader user
  // who just pressed it then has a DISABLED element under focus, which browsers cannot keep
  // focused, so focus silently reverts to `<body>` and the next Tab press restarts from the top of
  // the page instead of continuing from this row. `panelEl` + a stable `data-move-id`/
  // `data-move-dir` pair on each button (not a `bind:this` array -- rows are reordered, not
  // recreated, but keeping a ref array in sync with THAT is more moving parts than one DOM query)
  // let the handler refocus something real in the SAME row after Svelte re-renders it.
  let panelEl = $state<HTMLDivElement | undefined>();

  function refocusRow(id: LayerGroupId, preferredDir: "up" | "down") {
    if (!panelEl) return;
    const preferred = panelEl.querySelector<HTMLButtonElement>(
      `[data-move-id="${id}"][data-move-dir="${preferredDir}"]`,
    );
    if (preferred && !preferred.disabled) return preferred.focus();
    const otherDir = preferredDir === "up" ? "down" : "up";
    const other = panelEl.querySelector<HTMLButtonElement>(
      `[data-move-id="${id}"][data-move-dir="${otherDir}"]`,
    );
    if (other && !other.disabled) return other.focus();
    // both move buttons are disabled (a one-entry stack, never true today, but not this
    // function's assumption to make) -- the row's own switch (or, for the Data row, its expander
    // button) is always focusable, scoped by the row's own data-row-id.
    panelEl.querySelector<HTMLButtonElement>(`[data-row-id="${id}"] button`)?.focus();
  }

  /** ▲ (toward the top of the LIST) moves toward the END of the model array (toward the top of the
   * MAP); ▼ is the reverse. `label` is only for the `aria-live` announcement's wording. */
  function move(arrIndex: number, toArrIndex: number, label: string, dir: "up" | "down") {
    const id = stack[arrIndex].id;
    const next = moveLayerStackEntry(stack, arrIndex, toArrIndex);
    onChange(next);
    const newArrIndex = next.findIndex((e) => e.id === id);
    const displayPosition = next.length - newArrIndex; // 1 = top of the list
    announce = `${label} moved to position ${displayPosition} of ${next.length}`;
    tick().then(() => refocusRow(id, dir));
  }

  function reset() {
    onChange(defaultLayerStackEntries());
    announce = "Layers reset to the default stack";
  }
</script>

<div class="layers-stack" bind:this={panelEl}>
  <!-- fix list #10 (SC 1.3.1, e2e/keyboard-walk.spec.ts): a plain `div` (never a landmark) so this
       never becomes a SECOND `region` nested inside Panel.svelte's own "Layers" region — the same
       fix the pre-R3 non-interactive bullet list carried, kept here now that this IS "what's on the
       map" (interactive, not a summary of it). -->
  <div class="layers-control">
    <h3>Layers on the map</h3>
  </div>
  <ul class="stack-list">
    {#each rows as { entry, arrIndex } (entry.id)}
      {@const enabled = LAYER_GROUP_ENABLED[entry.id]}
      {@const label = LAYER_GROUP_LABEL[entry.id]}
      {@const isData = entry.id === DATA_ROW_ID}
      <li class="stack-row" class:stack-row--disabled={!enabled} data-row-id={entry.id}>
        <div class="row-head">
          {#if isData}
            <button
              type="button"
              class="row-name row-name--button"
              aria-expanded={expandedId === DATA_ROW_ID}
              aria-controls={DATA_ROW_BODY_ID}
              onclick={() => toggleExpanded(DATA_ROW_ID)}
            >
              <Icon name={expandedId === DATA_ROW_ID ? "chevronUp" : "chevronDown"} size={16} />
              {label}
            </button>
          {:else}
            <span class="row-name">
              {label}
              {#if !enabled}<span class="hint">— coming soon</span>{/if}
            </span>
          {/if}

          <Switch
            label={`${label} visible on the map`}
            checked={entry.visible}
            disabled={!enabled}
            onchange={(v) => setVisible(entry.id, v)}
          />

          <label class="opacity-control">
            <span class="sr-only">{label} opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={entry.opacity}
              disabled={!enabled}
              aria-valuetext={`${Math.round(entry.opacity * 100)}%`}
              onchange={(e) => setOpacity(entry.id, Number(e.currentTarget.value))}
            />
          </label>

          <span class="move-buttons">
            <button
              type="button"
              class="move-btn"
              aria-label={`Move ${label} up (toward the top of the map)`}
              disabled={!enabled || arrIndex === stack.length - 1}
              data-move-id={entry.id}
              data-move-dir="up"
              onclick={() => move(arrIndex, arrIndex + 1, label, "up")}
            >
              <Icon name="chevronUp" size={18} />
            </button>
            <button
              type="button"
              class="move-btn"
              aria-label={`Move ${label} down (toward the bottom of the map)`}
              disabled={!enabled || arrIndex === 0}
              data-move-id={entry.id}
              data-move-dir="down"
              onclick={() => move(arrIndex, arrIndex - 1, label, "down")}
            >
              <Icon name="chevronDown" size={18} />
            </button>
          </span>
        </div>

        {#if isData && expandedId === DATA_ROW_ID && dataControls}
          <div class="row-body" id={DATA_ROW_BODY_ID}>
            {@render dataControls()}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="stack-footer">
    <button type="button" class="reset-btn" disabled={isDefaultLayerStack(stack)} onclick={reset}>
      Reset layers
    </button>
  </div>

  <p aria-live="polite" class="sr-only">{announce}</p>
</div>

<style>
  .layers-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .layers-control h3 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-1);
  }

  .stack-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stack-row {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
  }

  .stack-row--disabled {
    opacity: 0.55;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    min-height: var(--size-touch);
  }

  .row-name {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-name--button {
    background: none;
    border: 0;
    padding: 0;
    min-height: var(--size-touch);
    cursor: pointer;
    color: inherit;
    font: inherit;
    font-weight: 600;
  }

  .row-name--button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .hint {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .opacity-control {
    display: inline-flex;
    align-items: center;
    min-height: var(--size-touch);
  }

  .opacity-control input[type="range"] {
    width: 64px;
  }

  .move-buttons {
    display: inline-flex;
  }

  .move-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 0;
    background: none;
    color: var(--text-primary);
    cursor: pointer;
  }

  .move-btn:disabled {
    color: var(--text-secondary);
    opacity: 0.4;
    cursor: default;
  }

  .move-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .row-body {
    padding: 0 var(--space-2) var(--space-2);
    border-top: 1px solid var(--border-control);
    padding-top: var(--space-2);
  }

  .stack-footer {
    display: flex;
    justify-content: flex-end;
  }

  .reset-btn {
    min-height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .reset-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
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
