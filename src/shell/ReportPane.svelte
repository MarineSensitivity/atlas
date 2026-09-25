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
  import { reportSubjectSentence, type ReportSubject } from "../lib/state/subjects";
  import type { UiReportTab } from "./uiState";

  interface Props {
    activeReportTab: UiReportTab;
    onActiveReportTabChange: (tab: UiReportTab) => void;
    places: Snippet;
    report: Snippet;
    /** R3-W8 item 5 fix round (Ben, verbatim): the SAME `reportSubjects()` result the Table's
     * subject line reads -- drives (a) the Places tab's own "Last clicked" row and (b) the Report
     * tab's one-sentence explanation, so neither can ever disagree with the other or with the
     * Table. */
    subject: ReportSubject;
    /** the Places tab's own "Last clicked" row label (`lastClicked.ts#lastClickedLabel`) --
     * `null` hides the row entirely ("Hide the row when nothing is clicked"). Independent of
     * `subject.kind`: the row still shows the Last-clicked selection even once an explicit list
     * exists (`subject.kind === "places"`), so a viewer can keep adding without losing sight of
     * the last thing they clicked. */
    lastClickedLabel: string | null;
    onAddLastClicked: () => void;
  }

  let {
    activeReportTab,
    onActiveReportTabChange,
    places,
    report,
    subject,
    lastClickedLabel,
    onAddLastClicked,
  }: Props = $props();

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
  {#if lastClickedLabel}
    <!-- R3-W8 item 5 fix round: "At the top of the Places tab, add a 'Last clicked' row... an
         'Add to places' button that appends it to the explicit list through whatever function
         Places already uses to add a pick." -->
    <div class="last-clicked-row" data-testid="last-clicked-row">
      <span class="last-clicked-label">Last clicked: {lastClickedLabel}</span>
      <button type="button" class="last-clicked-add" onclick={onAddLastClicked}>
        Add to places
      </button>
    </div>
  {/if}
  {@render places()}
{:else}
  <p class="report-subject-sentence" data-testid="report-subject-sentence">
    {reportSubjectSentence(subject)}
  </p>
  {@render report()}
{/if}

<style>
  .panel-tabs {
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--divider);
    margin-bottom: var(--space-2);
  }

  .last-clicked-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
  }

  .last-clicked-label {
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .last-clicked-add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: 0 0 auto;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .last-clicked-add:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .report-subject-sentence {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
  }
</style>
