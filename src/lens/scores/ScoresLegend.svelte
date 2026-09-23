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
