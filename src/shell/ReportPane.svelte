<script lang="ts">
  // R3-W8 item 5 (Ben, 2026-09-25): "Places folds into the Report tool as its first tab." A small,
  // dedicated two-tab wrapper -- same shape as the Layers pane's own "Layers"/info tabs
  // (`src/lib/ui/LayersPanel.svelte`'s `infoTab` prop), but its own file rather than a second
  // caller of that component: neither of THESE two tabs is lens-specific (Places/Report both
  // render identically on either lens), so there is no shared-across-lenses concern to reuse that
  // component for. Kept as its OWN component (not inlined into Shell.svelte) so this pane's own
  // `data-control`/`data-tour` anchors do NOT need a matching stub in index.html's static skeleton
  // -- `tests/shell/shell-invariants.test.ts`'s "skeleton vs hydrated anchors agree" gate only
  // scans Shell.svelte + TopBarActions.svelte, the same reason `LayersPanel.svelte`'s own
  // `panel-tabs` control (item 4) already lives outside that scan.
  import Segmented from "../lib/ui/Segmented.svelte";
  import type { Snippet } from "svelte";
  import type { UiReportTab } from "./uiState";

  interface Props {
    activeReportTab: UiReportTab;
    onActiveReportTabChange: (tab: UiReportTab) => void;
    places: Snippet;
    report: Snippet;
  }

  let { activeReportTab, onActiveReportTabChange, places, report }: Props = $props();

  function selectTab(next: string) {
    onActiveReportTabChange(next === "report" ? "report" : "places");
  }
</script>

<div class="panel-tabs" data-control="report-panel-tabs" data-tour="report-tabs">
  <Segmented
    options={[
      { value: "places", label: "Places" },
      { value: "report", label: "Report" },
    ]}
    value={activeReportTab}
    ariaLabel="Report pane section"
    onchange={selectTab}
  />
</div>

{#if activeReportTab === "places"}
  {@render places()}
{:else}
  {@render report()}
{/if}

<style>
  .panel-tabs {
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--divider);
    margin-bottom: var(--space-2);
  }
</style>
