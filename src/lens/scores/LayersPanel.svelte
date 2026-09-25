<script lang="ts">
  // atlas-4 step 1 — the scores lens' DATA-row content. R3 (Ben's Layers-pane redesign,
  // 2026-09-25) shrank this down to what only the SCORES lens has: the color-palette ramp picker
  // and the "Cells outside Program Areas" overlay switch. Everything else that used to live here
  // (Study area, the Layer <select>, Sphere) moved to the shared `lib/ui/LayersPanel.svelte`'s own
  // panel-level fields/rows -- `ScoresLens.svelte` now builds those from the SAME pure boot readers
  // this file used to call directly (`studyAreasFromBoot`, `layerGroups`, `layerByKey`), so nothing
  // here duplicates them.
  //
  // The overlay switch writes through a plain callback (never `selStore.set()`): ephemeral chrome
  // (parity doc §6.2 leaves it unchecked by default on every load, so there is nothing for a shared
  // link to reproduce).
  import { tick } from "svelte";
  import Popover from "../../lib/ui/Popover.svelte";
  import Switch from "../../lib/ui/Switch.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { paletteStopsWithFallback, rampCss } from "../../lib/raster/ramps";
  import type { PaletteName } from "../../lib/raster/ramps";
  import { nextRovingIndex } from "../../lib/ui/roving";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { ManifestOverlayRow } from "./raster";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifestOverlays: readonly ManifestOverlayRow[] | null;
    showOutsidePra: boolean;
    onShowOutsidePraChange: (v: boolean) => void;
    /** the release's own unit type (`fallback.ts`'s `effectiveUnit`) -- the outside-PRA switch is
     * only meaningful (and only shown) on the raster/cell branch. */
    unit: string;
  }

  let {
    sel,
    selStore,
    boot,
    manifestOverlays,
    showOutsidePra,
    onShowOutsidePraChange,
    unit,
  }: Props = $props();

  // R3 (Ben, 2026-09-25): "actual color ramps visualized for given options (see CalCOFI explore
  // for ideas)" -- a button showing the CURRENT palette's own gradient strip + name, opening a
  // Popover `role="listbox"` with one `role="option"` per palette (strip + name, `aria-selected`).
  const PALETTE_OPTIONS: { value: PaletteName; label: string }[] = [
    { value: "spectral_r", label: "Spectral" },
    { value: "viridis", label: "Viridis" },
    { value: "cividis", label: "Cividis" },
    { value: "magma", label: "Magma" },
  ];

  function paletteRampCss(name: PaletteName): string {
    const stops = paletteStopsWithFallback(boot as { palettes?: unknown } | null | undefined, name);
    return stops ? rampCss(stops) : "none";
  }

  function paletteLabel(name: string): string {
    return PALETTE_OPTIONS.find((o) => o.value === name)?.label ?? name;
  }

  let paletteOpen = $state(false);
  let focusIdx = $state(0);
  let optionEls: (HTMLButtonElement | undefined)[] = [];

  // Popover's `open` is `$bindable` (R3 fix, `ui/Popover.svelte`'s own header) -- watched here
  // rather than a prop callback so opening resets the roving-focus index to the CURRENT palette and
  // moves real DOM focus onto it (spec: "arrow keys + Enter/Esc").
  $effect(() => {
    if (!paletteOpen) return;
    focusIdx = Math.max(
      0,
      PALETTE_OPTIONS.findIndex((o) => o.value === sel.pal),
    );
    tick().then(() => optionEls[focusIdx]?.focus());
  });

  // the listbox's own arrow-key roving -- reuses the SAME pure `nextRovingIndex` (`ui/roving.ts`)
  // the tool rail already uses (vertical orientation: ArrowUp/ArrowDown, Home/End), rather than a
  // second hand-rolled index walk.
  function onListboxKeydown(event: KeyboardEvent) {
    const next = nextRovingIndex(focusIdx, PALETTE_OPTIONS.length, event.key, "vertical");
    if (next === null) return;
    event.preventDefault();
    focusIdx = next;
    optionEls[next]?.focus();
  }

  function selectPalette(value: string) {
    selStore.set({ pal: value as Sel["pal"] });
    paletteOpen = false; // Popover's own bindable `open` -- refocuses the trigger (see its header)
  }

  function onShowOutsidePraSwitch(checked: boolean) {
    onShowOutsidePraChange(checked);
  }

  const hasOutsidePra = $derived(
    !!(manifestOverlays ?? []).find(
      (o) => o.overlay_key === "_outside_pra" && o.subregion_key === "FULL",
    ),
  );
</script>

<div class="layers-panel">
  <label class="field">
    <span class="field-label">Color palette</span>
    <Popover
      label={`Color palette: ${paletteLabel(sel.pal)}`}
      triggerClass="ramp-trigger"
      bind:open={paletteOpen}
    >
      {#snippet trigger()}
        <span class="ramp-strip" style="background: {paletteRampCss(sel.pal)}"></span>
        <span class="ramp-trigger-name">{paletteLabel(sel.pal)}</span>
        <Icon name="chevronDown" size={14} />
      {/snippet}
      <div
        class="ramp-listbox"
        role="listbox"
        aria-label="Color palette"
        tabindex="-1"
        onkeydown={onListboxKeydown}
      >
        {#each PALETTE_OPTIONS as opt, i (opt.value)}
          <button
            type="button"
            role="option"
            aria-selected={sel.pal === opt.value}
            tabindex={i === focusIdx ? 0 : -1}
            class="ramp-option"
            bind:this={optionEls[i]}
            onclick={() => selectPalette(opt.value)}
          >
            <span class="ramp-strip" style="background: {paletteRampCss(opt.value)}"></span>
            <span class="ramp-option-name">{opt.label}</span>
            {#if sel.pal === opt.value}<Icon name="check" size={14} />{/if}
          </button>
        {/each}
      </div>
    </Popover>
  </label>

  {#if unit === "cell" && hasOutsidePra}
    <div class="switch-row">
      <Switch
        label="Cells outside Program Areas"
        checked={showOutsidePra}
        variant="quiet"
        onchange={onShowOutsidePraSwitch}
      />
      <span>Cells outside Program Areas</span>
    </div>
  {/if}
</div>

<style>
  .layers-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .switch-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  :global(.ramp-trigger) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .ramp-trigger-name {
    flex: 1 1 auto;
    text-align: left;
  }

  .ramp-strip {
    display: inline-block;
    width: 40px;
    height: 10px;
    border-radius: var(--radius-pill);
    flex: none;
  }

  .ramp-listbox {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 220px;
  }

  .ramp-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .ramp-option:hover,
  .ramp-option[aria-selected="true"] {
    background: var(--fill-control);
  }

  .ramp-option:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .ramp-option-name {
    flex: 1 1 auto;
  }
</style>
