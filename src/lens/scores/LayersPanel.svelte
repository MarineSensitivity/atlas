<script lang="ts">
  // atlas-4 step 1 — the scores lens' DATA-row content: study area, spatial unit, layer (grouped),
  // palette, globe/mercator, and the "cells outside Program Areas" overlay switch. Every control
  // writes through `selStore.set()` (URL-is-the-view) except the overlay switch, which is ephemeral
  // chrome (never a shared-link concern — parity doc §6.2 leaves it unchecked by default on every
  // load, so there is nothing for a link to reproduce). The legend used to render IN this panel
  // (only visible while the Layers tool was open, and never for the zone-choropleth branch) --
  // atlas-4 defect fix moved it to the shell's floating "lens legend" region (ScoresLegend.svelte),
  // the same slot the species lens' legend already used, per spec.md's "one legend on screen at a
  // time".
  //
  // R3 (round-2 plan §5 U4): this component is no longer the WHOLE "Layers" tool body — it renders
  // inside the shared `src/lib/ui/LayersPanel.svelte`'s "Data" row, as that row's `dataControls`
  // snippet (`ScoresLens.svelte` wires the two together). The old non-interactive "Layers on the
  // map" bullet list is GONE from here: the shared stack component now IS that list, made real and
  // interactive, so summarizing it a second time here would just repeat it less usefully.
  //
  // P round deliverable 1 (Ben, live-review 2026-09-24): the "Spatial units" `<Select>` that used
  // to live in this file is GONE — promoted to the shared panel's own top-of-panel "Raster cells |
  // Program Areas" `Segmented` toggle (`LibLayersPanel`'s `unitToggle` prop, wired by
  // `ScoresLens.svelte`). Two controls setting the SAME `unit` would just be confusing, not
  // additive, so this is a replacement, not a second control.
  import Select from "../../lib/ui/Select.svelte";
  import Switch from "../../lib/ui/Switch.svelte";
  import { studyAreasFromBoot, type StudyArea } from "../../lib/map/interaction";
  import type { MapHandle } from "../../lib/map/map";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import { layerByKey, layerGroups, primaryUnitNote } from "./boot";
  import type { ManifestOverlayRow } from "./raster";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifestOverlays: readonly ManifestOverlayRow[] | null;
    /** R3 orchestrator audit item 3: `metric_key` -> the manifest's own SHORT label
     * (`boot.ts#metricLabelsFromManifest`, `ScoresLens#metricLabels`) — the ported Shiny app's
     * short names ("bird: ext. risk"), not `boot.layers[].label`'s long description text. */
    metricLabels: Record<string, string>;
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
    metricLabels,
    ver,
    mapHandle,
    showOutsidePra,
    onShowOutsidePraChange,
    unit,
    lyr,
  }: Props = $props();

  const studyAreas = $derived(studyAreasFromBoot(boot));
  const note = $derived(primaryUnitNote(boot, ver));
  const groups = $derived(layerGroups(boot));

  function layerOptionLabel(l: { metric_key: string; label?: string }): string {
    return metricLabels[l.metric_key] ?? l.label ?? l.metric_key;
  }

  /** the CURRENT layer's long description (`boot.layers[].label`) — "What is this layer?"
   * (docs/usability.md §7 R3's own recommendation for the expanded Data row). `null` before a
   * layer has resolved, for a `metric_key` the release does not publish, OR (M6, review round 1)
   * when the manifest publishes no SHORT label of its own — `layerOptionLabel()` then falls back
   * to this SAME `label` text for the option, and repeating it verbatim as a description under
   * the dropdown is redundant, not informative (e.g. a release with no `manifest.metrics` row for
   * a layer at all: both texts are `boot.layers[].label`). */
  const currentLayerDescription = $derived.by(() => {
    const l = layerByKey(boot, lyr);
    const desc = l?.label ?? null;
    if (desc === null) return null;
    return desc === layerOptionLabel({ metric_key: l!.metric_key, label: l!.label }) ? null : desc;
  });

  // D2 fix round 2 (CI: [webkit] gate, three-engine run 35971206753): a native <select>'s own
  // CLOSED-box value text is UA-internal rendering that CSS cannot reliably style everywhere --
  // measured directly (a real WebKit build, both locally and on CI's linux runner): the computed
  // `text-overflow`/`overflow` values differ BETWEEN THE TWO WEBKIT BUILDS THEMSELVES (hidden
  // locally, visible on CI), and even where the computed style claims "ellipsis", the control
  // visually hard-clips mid-word with no "…" glyph either way -- text-overflow simply never
  // reaches a <select>'s internal text layout on this engine, so no CSS fix "closes" it there (a
  // custom combobox would, at the cost of reimplementing native keyboard/ARIA select behaviour --
  // out of this round's scope). `title` is the portable fallback the original eyes-on assessment's
  // own "what right looks like" named alongside the ellipsis ("...plus the full name as `title`"):
  // works via native tooltip on every engine regardless of whether the visual ellipsis does, so
  // the full text is never SILENTLY lost, only visually clipped where the platform allows nothing
  // else. `layerOptionLabel`, not `currentLayerDescription`, above -- the ellipsis clips the
  // OPTION text you'd read in the closed box, not the description note.
  const currentLayerLabel = $derived.by(() => {
    const l = layerByKey(boot, lyr);
    return l ? layerOptionLabel({ metric_key: l.metric_key, label: l.label }) : null;
  });

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

  {#if note}
    <p class="note">{note}</p>
  {/if}

  <label class="field">
    <span class="field-label" id="scores-lyr-label">Layer</span>
    <span class="select-wrap">
      <select
        class="select"
        aria-labelledby="scores-lyr-label"
        title={currentLayerLabel ?? undefined}
        value={lyr ?? ""}
        onchange={onLyrChange}
      >
        {#each groups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.layers as l (l.metric_key)}
              <option value={l.metric_key}>{layerOptionLabel(l)}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </span>
  </label>

  {#if currentLayerDescription}
    <p class="note" data-testid="layer-description">{currentLayerDescription}</p>
  {/if}

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
    /* D2 (Opus eyes-on assessment, 2026-09-24): this native <select> was already full-width, but
       its own rendered value text was CLIPPED mid-word ("...category and primar") with no
       ellipsis -- the one control in the first panel every visitor sees. Chromium (the one engine
       this app's own gate tests, and the only one with reliable support) honors text-overflow on
       a closed <select>'s value once it is forced single-line/non-overflowing like this. */
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
