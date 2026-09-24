<script lang="ts">
  // atlas-4 defect fix: the scores lens' floating legend, positioned bottom-right over the map --
  // the SAME slot the species lens' SpeciesLegend.svelte already uses (Shell.svelte's one "lens
  // legend" region, keyed on `sel.lens`, per spec.md's "one legend on screen at a time"). Reuses
  // the shared `Legend.svelte`; the raster (cell) branch shows `signif(rescale,3)` endpoints, the
  // zone-choropleth branch shows `round(range,1)` endpoints -- both already pre-rounded upstream
  // by `./mapInputs.ts`'s `scoresMapInputs`, so `formatScoresLegendValue` is a plain stringify,
  // never a second round (see that function's own header). Replaces the legend that used to render
  // INSIDE `LayersPanel.svelte` -- only ever visible when the Layers panel/tool was open, and never
  // shown at all for the zone-choropleth branch.
  import Legend from "../../lib/ui/Legend.svelte";
  import { uid } from "../../lib/ui/uid";
  import { formatScoresLegendValue, type ScoresLegend } from "./mapInputs";

  interface Props {
    legend: ScoresLegend;
  }

  let { legend }: Props = $props();
  // fix list #11 (SC 1.3.1): the "not published yet"/"no zones" notes below render their OWN h2,
  // never through the shared Legend.svelte -- so they need the same region/aria-labelledby fix
  // applied locally, per instance (not a shared literal).
  const noteTitleId = uid("scores-legend-note-title");
</script>

{#if legend?.kind === "raster" || legend?.kind === "zone"}
  <div class="scores-legend" data-testid="scores-legend">
    <Legend
      title={legend.title}
      stops={legend.stops}
      unit="score"
      formatValue={formatScoresLegendValue}
    />
  </div>
{:else if legend?.kind === "unavailable"}
  <div
    class="scores-legend scores-legend--note"
    role="region"
    aria-labelledby={noteTitleId}
    data-testid="scores-legend"
  >
    <h2 id={noteTitleId}>{legend.title}</h2>
    <p>This release has not published a legend ramp for this palette yet.</p>
  </div>
{:else if legend?.kind === "empty"}
  <div
    class="scores-legend scores-legend--note"
    role="region"
    aria-labelledby={noteTitleId}
    data-testid="scores-legend"
  >
    <h2 id={noteTitleId}>{legend.title}</h2>
    <p>No zones carry a value for this layer.</p>
  </div>
{/if}

<style>
  .scores-legend {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-3);
    z-index: 5;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--elev-2);
  }

  /* D1 (Opus eyes-on assessment, 2026-09-24): the default bottom-right position above is exactly
     the corner the default RIGHT-docked panel (`.panel-region`, z-index 16) fills top-to-bottom --
     the legend rendered UNDER the panel's glass, a blurred smudge with no key visible on every
     desktop map. Shell.svelte mirrors the panel's live dock/maximized state onto `.stage` (this
     element's own positioned ancestor, `main#stage`) as `data-panel-dock`/`data-panel-maximized` --
     read here so the legend always floats over FREE map, never under the panel, at any dock side.
     Dock=left is left alone (the default bottom-right corner above is already clear of a
     left-docked panel, and of the rail, which is always top-left on desktop). */
  :global(.stage[data-panel-dock="right"]) .scores-legend {
    /* the panel takes the whole right-side strip top-to-bottom; the rail sits top-LEFT
       (shell.css's `.rail-region`), so bottom-left is the one corner nothing else claims --
       EXCEPT the map-attribution chip (shell.css's `.map-attribution`: `left: var(--space-2)`,
       `bottom: var(--space-2)`, ~18px tall), which already sits in that same corner. Red-first
       caught the two overlapping (measured 14px of shared height) once this moved the legend
       here -- `bottom` clears the chip's own height plus a matching gap, on top of its offset. */
    right: auto;
    left: var(--space-3);
    bottom: calc(var(--space-2) + 22px + var(--space-2));
  }
  :global(.stage[data-panel-dock="bottom"]) .scores-legend {
    /* the panel spans the full width at the bottom -- stay bottom-right, but clear ITS height
       (plus a gutter) instead of the stage's own bottom edge. `--panel-size` is inherited from
       `.stage` (Shell.svelte's own inline style, same value `.panel-region`'s height reads). */
    bottom: calc(var(--panel-size, var(--size-panel)) + var(--space-3) * 2);
  }
  :global(.stage[data-panel-maximized="true"]) .scores-legend {
    /* maximized: the panel covers the WHOLE stage (shell.css's own `[data-maximized]` rule) --
       there is no free map left to float a legend over. */
    display: none;
  }

  /* the phone viewport has no room for this beside the bottom rail (centered, also anchored at
     `bottom: var(--space-3)`) and the bottom sheet -- the SAME "no room" trade-off Shell.svelte's
     on-map About card already makes at this breakpoint (shell.css's own `.about-region { display:
     none }`, cited there as an open item, not blocking, docs/design/spec.md §14); the species
     lens' own floating legend takes the identical exception, for the identical reason (see its own
     header comment). */
  @media (max-width: 899px) {
    .scores-legend {
      display: none;
    }
  }

  .scores-legend--note {
    max-width: 240px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .scores-legend--note h2 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-1);
  }

  .scores-legend--note p {
    margin: 0;
  }
</style>
