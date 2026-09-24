<script lang="ts">
  // atlas-4 step 1 — the Layers panel: study area, spatial unit, layer (grouped), palette,
  // globe/mercator, and the "cells outside Program Areas" overlay switch. Every control writes
  // through `selStore.set()` (URL-is-the-view) except the overlay switch, which is ephemeral
  // chrome (never a shared-link concern — parity doc §6.2 leaves it unchecked by default on every
  // load, so there is nothing for a link to reproduce). The legend used to render IN this panel
  // (only visible while the Layers tool was open, and never for the zone-choropleth branch) --
  // atlas-4 defect fix moved it to the shell's floating "lens legend" region (ScoresLegend.svelte),
  // the same slot the species lens' legend already used, per spec.md's "one legend on screen at a
  // time".
  import Select from "../../lib/ui/Select.svelte";
  import Switch from "../../lib/ui/Switch.svelte";
  import { studyAreasFromBoot, type StudyArea } from "../../lib/map/interaction";
  import type { MapHandle } from "../../lib/map/map";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import { layerGroups, primaryUnitNote, unitOptions } from "./boot";
  import type { ManifestOverlayRow } from "./raster";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifestOverlays: readonly ManifestOverlayRow[] | null;
    ver: string | null;
    mapHandle: MapHandle | undefined;
    showOutsidePra: boolean;
    onShowOutsidePraChange: (v: boolean) => void;
    /** the release's own unit type (`fallback.ts`'s `effectiveUnit`) — an unrecognized `sel.unit`
     * has already fallen back to `"cell"` by the time it reaches here. */
    unit: string;
    /** the resolved layer key (`fallback.ts`'s `effectiveLyr`) — NOT `sel.lyr` directly: on first
     * paint (no `?lyr=` yet) `sel.lyr` is `undefined`, and the panel must still show/legend the
     * release's own composite default, exactly what the map already renders. */
    lyr: string | null;
  }

  let {
    sel,
    selStore,
    boot,
    manifestOverlays,
    ver,
    mapHandle,
    showOutsidePra,
    onShowOutsidePraChange,
    unit,
    lyr,
  }: Props = $props();

  const studyAreas = $derived(studyAreasFromBoot(boot));
  const unitChoices = $derived(unitOptions(boot));
  const note = $derived(primaryUnitNote(boot, ver));
  const groups = $derived(layerGroups(boot));

  const PALETTE_OPTIONS = [
    { value: "spectral_r", label: "Spectral" },
    { value: "viridis", label: "Viridis" },
    { value: "cividis", label: "Cividis" },
    { value: "magma", label: "Magma" },
  ];

  function onAreaChange(value: string) {
    // atlas-8 defect fix (owner report, 2026-09-24): the camera used to fly from HERE, the panel
    // BODY — which never runs for a `sel.area` arriving from the URL on load (a collapsed/unmounted
    // panel means it never runs at all). `Shell.svelte`'s own `$effect` (camera.ts's
    // `shouldFlyToArea`) now owns the fly, for both load and change; clearing `map` here is what
    // lets it (its own guard skips while an explicit `sel.map` camera is set).
    selStore.set({ area: value, map: undefined });
  }

  function onUnitChange(value: string) {
    selStore.set({ unit: value, sel: undefined });
  }

  function onLyrChange(event: Event) {
    selStore.set({ lyr: (event.currentTarget as HTMLSelectElement).value });
  }

  function onPalChange(value: string) {
    selStore.set({ pal: value as Sel["pal"] });
  }

  function onProjChange(checked: boolean) {
    const proj = checked ? "globe" : "mercator";
    selStore.set({ proj });
    mapHandle?.setProjection(proj);
  }

  const hasOutsidePra = $derived(
    !!(manifestOverlays ?? []).find(
      (o) => o.overlay_key === "_outside_pra" && o.subregion_key === "FULL",
    ),
  );
</script>

<div class="layers-panel">
  <label class="field">
    <span class="field-label">Study area</span>
    <Select
      label="Study area"
      value={sel.area}
      options={studyAreas.map((a: StudyArea) => ({ value: a.key, label: a.label ?? a.key }))}
      onchange={onAreaChange}
    />
  </label>

  <label class="field">
    <span class="field-label">Spatial units</span>
    <Select label="Spatial units" value={unit} options={unitChoices} onchange={onUnitChange} />
  </label>

  {#if note}
    <p class="note">{note}</p>
  {/if}

  <label class="field">
    <span class="field-label" id="scores-lyr-label">Layer</span>
    <span class="select-wrap">
      <select
        class="select"
        aria-labelledby="scores-lyr-label"
        value={lyr ?? ""}
        onchange={onLyrChange}
      >
        {#each groups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.layers as l (l.metric_key)}
              <option value={l.metric_key}>{l.label ?? l.metric_key}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </span>
  </label>

  <label class="field">
    <span class="field-label">Color palette</span>
    <Select
      label="Color palette"
      value={sel.pal}
      options={PALETTE_OPTIONS}
      onchange={onPalChange}
    />
  </label>

  <div class="switch-row">
    <Switch
      label="Sphere (globe projection)"
      checked={sel.proj === "globe"}
      onchange={onProjChange}
    />
    <span>Sphere</span>
  </div>

  {#if unit === "cell" && hasOutsidePra}
    <div class="switch-row">
      <Switch
        label="Cells outside Program Areas"
        checked={showOutsidePra}
        onchange={onShowOutsidePraChange}
      />
      <span>Cells outside Program Areas</span>
    </div>
  {/if}

  <!-- fix list #10 (SC 1.3.1): this used to be a `<section aria-label="Layers on the map">` -- a
       SECOND `region` landmark nested directly inside Panel.svelte's own `<section
       aria-labelledby>` (already named "Layers"), plus an `h3` that just repeated the panel's own
       `h2` title. A plain `div` (never a landmark) with a heading that says something the panel's
       own title does not fixes both: landmark navigation offers "Layers" once, not twice, and the
       outline no longer reads two adjacent "Layers" entries. -->
  <div class="layers-control">
    <h3>Layers on the map</h3>
    <ul>
      {#if unit === "cell"}
        <li>Raster cell values</li>
        {#if hasOutsidePra}
          <li>Cells outside Program Areas{showOutsidePra ? "" : " (off)"}</li>
        {/if}
      {:else}
        <li>{unitChoices.find((u) => u.value === unit)?.label ?? unit} values</li>
      {/if}
    </ul>
  </div>
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

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .switch-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .layers-control h3 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-1);
  }

  .layers-control ul {
    margin: 0;
    padding-left: var(--space-4);
    font-size: var(--text-sm);
  }

  .select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .select {
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }

  .select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
