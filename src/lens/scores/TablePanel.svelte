<script lang="ts">
  // atlas-4 step 2/3 — the "table" rail tool: the species table + CSV + glossary + composition
  // treemap (parity doc §7.3-§7.6), plus the zones table (the atlas-4 subplan's "New" bullet, the
  // keyboard/screen-reader equivalent of the choropleth). One Segmented switch among the three;
  // species/composition data loads lazily through the engine (`speciesLoad.ts`) only once this
  // panel is actually open.
  import { untrack, type Component } from "svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { manifestCapability, type Manifest } from "../../lib/release/manifest";
  import { componentMetricKeys, type SpeciesRow } from "../../lib/analysis/queries";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import { layerByKey, primaryUnitType, zoneAllKey, zoneRows } from "./boot";
  import { formatZoneToken } from "./selection";
  import type { ScoresSelection } from "./selection";
  import { csvFilename, modelSelPatch, speciesFilenameStem, speciesHeader, toCsv } from "./species";
  import { loadCompositionRows, loadSpeciesRows } from "./speciesLoad";
  import SpeciesTable from "./SpeciesTable.svelte";
  import ZonesTable from "./ZonesTable.svelte";
  import GlossaryModal from "./GlossaryModal.svelte";
  import type { CompositionRow } from "./composition";
  // atlas-7 step 4: "Report on selected" builds the SAME `z.<set>.<keys>` token the Places panel's
  // own zone places use (places/model.ts) -- never a second zone-place encoding.
  import { hashFromPlaces, zoneSetForUnit } from "../../places/model";

  // `Composition.svelte` is loaded via a DYNAMIC `import()`, never a static one, even though it
  // contains no forbidden-marker text itself: it is what dynamically imports `Treemap.svelte`, and
  // that inner import compiles to a reference to `Treemap-<hash>.js` (Vite's own chunk-preload
  // bookkeeping) — a reference `scripts/size-budget.mjs`'s "treemap" marker correctly flags if it
  // ends up inside a file THIS panel reaches by static import. Two hops of dynamic import keep
  // that filename out of the static graph entirely (measured: a static import here failed the
  // budget on `Treemap-<hash>.js` appearing in the entry chunk).
  // see Composition.svelte's own identical note on why this cannot be the real
  // (unimportable-from-plain-.ts) Props type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CompositionComponent = $state<Component<any> | null>(null);
  $effect(() => {
    if (!CompositionComponent) {
      import("./Composition.svelte").then((mod) => {
        CompositionComponent = mod.default;
      });
    }
  });

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifest: unknown;
    ver: string | null;
    unit: string;
    lyr: string | null;
    selection: ScoresSelection;
  }

  let { sel, selStore, boot, manifest, ver, unit, lyr, selection }: Props = $props();

  let subTab = $state<"species" | "zones" | "composition">("species");
  let glossaryOpen = $state(false);

  const allKey = $derived(zoneAllKey(boot));
  const unitLabel = $derived(
    (boot as { units?: Array<{ label?: unknown }> } | null)?.units?.[0]?.label as
      string | undefined,
  );
  const currentZone = $derived(
    selection?.kind === "zone"
      ? zoneRows(boot, selection.unit).find((z) => z.key === selection.key)
      : undefined,
  );
  const header = $derived(
    speciesHeader({
      selection,
      zoneName: currentZone?.name,
      unit: selection?.kind === "zone" ? selection.unit : unit,
      unitLabel: unitLabel ?? null,
      zoneAllKey: allKey,
    }),
  );
  const filenameStem = $derived(
    speciesFilenameStem({
      selection,
      zoneName: currentZone?.name,
      unit: selection?.kind === "zone" ? selection.unit : unit,
      unitLabel: unitLabel ?? null,
      zoneAllKey: allKey,
    }),
  );

  const cellSpeciesAvailable = $derived(
    manifestCapability(manifest as Manifest | null, "cell_species_list"),
  );
  const noSpeciesPublished = $derived(
    selection?.kind === "zone" && currentZone !== undefined && currentZone.n_taxa === 0,
  );
  const unavailable = $derived(selection?.kind === "cell" && !cellSpeciesAvailable);

  let speciesRows = $state<SpeciesRow[] | null | undefined>(undefined);
  let compositionRows = $state<CompositionRow[] | null | undefined>(undefined);

  async function reload() {
    if (!ver || unavailable || noSpeciesPublished) {
      speciesRows = null;
      compositionRows = null;
      return;
    }
    speciesRows = undefined;
    compositionRows = undefined;
    try {
      const rows = await loadSpeciesRows(ver, boot as Record<string, unknown>, {
        selection,
        zoneAllKey: allKey,
      });
      speciesRows = rows;
      compositionRows = await loadCompositionRows(ver, boot as Record<string, unknown>);
    } catch {
      speciesRows = null;
      compositionRows = null;
    }
  }

  $effect(() => {
    // re-run whenever the selection (or the release) changes; `untrack` keeps `subTab` from
    // retriggering a reload merely by switching tabs on data already in hand.
    void selection;
    void ver;
    void boot;
    untrack(() => reload());
  });

  function onExportCsv() {
    if (!speciesRows) return;
    const columns = [
      { key: "sp_cat", value: (r: SpeciesRow) => r.sp_cat },
      { key: "sp_scientific", value: (r: SpeciesRow) => r.sp_scientific },
      { key: "sp_common", value: (r: SpeciesRow) => r.sp_common },
      { key: "taxon_authority", value: (r: SpeciesRow) => r.taxon_authority },
      { key: "taxon_id", value: (r: SpeciesRow) => r.taxon_id },
      { key: "er_code", value: (r: SpeciesRow) => r.er_code },
      { key: "er_score", value: (r: SpeciesRow) => r.er_score },
      { key: "is_mmpa", value: (r: SpeciesRow) => r.is_mmpa },
      { key: "is_mbta", value: (r: SpeciesRow) => r.is_mbta },
      { key: "mdl_key", value: (r: SpeciesRow) => r.mdl_key },
      { key: "area_km2", value: (r: SpeciesRow) => r.area_km2 },
      { key: "avg_suit", value: (r: SpeciesRow) => r.avg_suit },
      { key: "pct_cat", value: (r: SpeciesRow) => r.pct_cat },
    ];
    const csv = toCsv(speciesRows, columns);
    const filename = csvFilename(filenameStem);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onModelClick(mdlKey: string) {
    selStore.set(modelSelPatch(mdlKey));
  }

  function onSelectZone(key: string) {
    selStore.set({ sel: formatZoneToken(zonesUnit, key) });
  }

  // atlas-7 step 4: "Report on selected" -- one zone Place carrying every checked key (model.ts's
  // own multi-key zone shape; `expandPlaces()` on the report side splits it back into one reported
  // area per key, exactly as if each had been added from the Places panel separately).
  // `window.open()` runs SYNCHRONOUSLY in this handler, same rule as Places.svelte's own "Report"
  // (no `await` before it, or the popup blocker treats the tab as not user-initiated).
  function onReportSelected(keys: string[]) {
    if (!keys.length) return;
    const set = zoneSetForUnit(zonesUnit);
    if (!set) return; // an unrecognized unit type: nothing to encode, no broken link to open
    const hash = hashFromPlaces([{ kind: "zone", set, keys }]);
    const query = ver ? `?ver=${encodeURIComponent(ver)}` : "";
    window.open(`./report.html${query}${hash ? `#pl=${hash}` : ""}`, "_blank", "noopener");
  }

  const currentLayer = $derived(layerByKey(boot, lyr));
  const componentKeys = $derived(componentMetricKeys(boot));
  // the zones table always ranks the release's ONE drawable unit (D17) — independent of whether
  // the map is currently in the cell-raster branch or the zone-choropleth branch.
  const zonesUnit = $derived(primaryUnitType(boot) ?? "programarea");
</script>

<div class="table-panel">
  <div class="header-row">
    <h3 class="header-text">{unavailable ? `${header} — unavailable` : header}</h3>
    <button
      type="button"
      class="icon-btn"
      aria-label="Column glossary"
      onclick={() => (glossaryOpen = true)}
    >
      <Icon name="info" size={16} />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label="Download CSV"
      disabled={!speciesRows}
      onclick={onExportCsv}
    >
      <Icon name="download" size={16} />
    </button>
  </div>

  <Segmented
    ariaLabel="Table view"
    value={subTab}
    options={[
      { value: "species", label: "Species" },
      { value: "zones", label: "Zones" },
      { value: "composition", label: "Composition" },
    ]}
    onchange={(v) => (subTab = v as typeof subTab)}
  />

  {#if subTab === "species"}
    {#if unavailable}
      <p class="note">This release does not publish a species list for a clicked cell.</p>
    {:else if noSpeciesPublished}
      <p class="note">No species table published for this zone in {ver}.</p>
    {:else if speciesRows === undefined}
      <p class="note">Loading species…</p>
    {:else if speciesRows === null}
      <p class="note">The species table could not be loaded.</p>
    {:else}
      <SpeciesTable label={header} rows={speciesRows} {sel} {onModelClick} />
    {/if}
  {:else if subTab === "zones"}
    <ZonesTable
      zones={zoneRows(boot, zonesUnit)}
      metricKey={lyr ?? ""}
      metricLabel={currentLayer?.label ?? lyr ?? "Score"}
      {componentKeys}
      {onSelectZone}
      {onReportSelected}
    />
  {:else if CompositionComponent}
    {@const Comp = CompositionComponent}
    <Comp title={header} rows={compositionRows} />
  {:else}
    <p class="note">Loading the composition view…</p>
  {/if}
</div>

<GlossaryModal open={glossaryOpen} onclose={() => (glossaryOpen = false)} />

<style>
  .table-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .header-text {
    flex: 1;
    margin: 0;
    font-size: var(--text-md);
  }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
</style>
