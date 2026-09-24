<script lang="ts">
  // U6 (round 2): the "report" rail tool's real panel body, replacing the TOOL_BODY.report
  // placeholder (docs/usability.md M1). Shown for EITHER lens (Shell.svelte intercepts
  // `activeTool === "report"` before the lens-specific branches, the same way "places" already
  // does) so a species-lens user reaches the same chooser a scores-lens user does.
  //
  // Three things on screen, per the round-2 plan's U6 goal ("The Report rail tool shows the same
  // chooser + the last reports opened this session"):
  //   1. a shortcut to open a report for whatever `reportAction()` says is already selected;
  //   2. the chooser itself -- pick a Program Area from the release's own zone list, or hand off
  //      to the Places tool for drawing/coordinates/upload;
  //   3. reports opened THIS session (sessionStorage, chrome -- report.ts's own contract).
  import Icon from "../lib/ui/Icon.svelte";
  import Select from "../lib/ui/Select.svelte";
  import { primaryUnitLabel, primaryUnitType, zoneRows } from "../lens/scores/boot";
  import {
    loadRecentReports,
    recordRecentReport,
    reportAction,
    zoneReportHref,
    type RecentReport,
  } from "./report";
  import type { Sel } from "../lib/state/types";

  interface Props {
    sel: Sel;
    boot: unknown;
    ver: string | null;
    /** switches the rail to the Places tool -- the chooser's "draw or upload" hand-off. */
    onOpenPlaces?: () => void;
  }

  let { sel, boot, ver, onOpenPlaces }: Props = $props();

  function storage(): Storage | null {
    try {
      return window.sessionStorage;
    } catch {
      return null; // private mode / storage disabled -- chrome, not correctness
    }
  }

  let recents = $state<RecentReport[]>(loadRecentReports(storage()));

  const action = $derived(reportAction(sel, ver));
  const unit = $derived(primaryUnitType(boot) ?? "programarea");
  const unitLabel = $derived(primaryUnitLabel(boot) ?? "Program Area");
  const zones = $derived(zoneRows(boot, unit));

  let pickedKey = $state("");

  function open(href: string, label: string) {
    // window.open() runs SYNCHRONOUSLY in the click handler, no `await` before it, or the popup
    // blocker treats the tab as not user-initiated -- the same rule Places.svelte/TablePanel.svelte
    // already follow for their own "Report" actions (report-model.md, windowOpenSync.wiring.test.ts).
    window.open(href, "_blank", "noopener");
    recents = recordRecentReport(storage(), { href, label });
  }

  function openCurrent() {
    if (action.kind !== "open") return;
    open(action.href, action.label);
  }

  function openPicked() {
    if (!pickedKey) return;
    const href = zoneReportHref(unit, pickedKey, ver);
    if (!href) return;
    const zone = zones.find((z) => z.key === pickedKey);
    open(href, zone?.name ?? pickedKey);
  }
</script>

<div class="report-tool">
  {#if action.kind === "open"}
    <section class="report-current">
      <p>Report on {action.label}.</p>
      <button type="button" class="report-primary" onclick={openCurrent}>
        <Icon name="report" size={16} />Open report
      </button>
    </section>
  {/if}

  <section class="report-chooser">
    <h3>{action.kind === "open" ? "Or choose another area" : "Pick an area to report on"}</h3>
    {#if zones.length}
      <div class="report-pick-row">
        <Select
          label={`Pick a ${unitLabel}`}
          value={pickedKey}
          onchange={(v) => (pickedKey = v)}
          options={[
            { value: "", label: `Pick a ${unitLabel}…` },
            ...zones.map((z) => ({ value: z.key, label: z.name ?? z.key })),
          ]}
        />
        <button type="button" onclick={openPicked} disabled={!pickedKey}>
          Report on this {unitLabel}
        </button>
      </div>
    {/if}
    <button type="button" class="report-places-link" onclick={() => onOpenPlaces?.()}>
      <Icon name="draw" size={16} />Draw, enter coordinates or upload a file
    </button>
  </section>

  {#if recents.length}
    <section class="report-recent">
      <h3>Reports opened this session</h3>
      <ul>
        {#each recents as r (r.href)}
          <li><a href={r.href} target="_blank" rel="noopener">{r.label}</a></li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .report-tool {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .report-current {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .report-primary,
  .report-pick-row button,
  .report-places-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .report-primary {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    border-color: transparent;
    align-self: flex-start;
  }

  .report-pick-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .report-primary:focus-visible,
  .report-pick-row button:focus-visible,
  .report-places-link:focus-visible,
  .report-recent a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .report-chooser {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .report-pick-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .report-recent ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .report-recent a {
    color: var(--text-link);
    font-size: var(--text-sm);
  }
</style>
