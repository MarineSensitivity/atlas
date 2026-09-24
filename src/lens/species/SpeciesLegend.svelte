<script lang="ts">
  // §6.2's legend, positioned bottom-right over the map (the same corner `add_legend(position =
  // "bottom-right")` used): the continuous 1-100 (or an AquaX Delivered 0-1000) ramp for a COG
  // layer, reusing the shared `Legend.svelte`; a single swatch + "range (presence)" for a PMTiles
  // range — `Legend.svelte` itself only knows how to draw a continuous ramp, so the categorical case
  // gets its own small markup here rather than forcing a one-stop ramp through it.
  import Legend from "../../lib/ui/Legend.svelte";
  import { uid } from "../../lib/ui/uid";
  import { formatSpeciesLegendValue, type SpeciesLegend } from "./mapInputs";

  interface Props {
    legend: SpeciesLegend;
  }

  let { legend }: Props = $props();
  // fix list #11 (SC 1.3.1): the categorical branch below renders its OWN h2, never through the
  // shared Legend.svelte -- same local region/aria-labelledby fix, per instance.
  const catTitleId = uid("species-legend-cat-title");
</script>

{#if legend?.kind === "continuous"}
  <div class="species-legend" data-testid="species-legend">
    <Legend
      title={legend.title}
      stops={legend.stops}
      unit={legend.unit}
      formatValue={formatSpeciesLegendValue}
    />
  </div>
{:else if legend?.kind === "categorical"}
  <div
    class="species-legend species-legend--categorical"
    role="region"
    aria-labelledby={catTitleId}
    data-testid="species-legend"
  >
    <h2 id={catTitleId}>{legend.title}</h2>
    <div class="row">
      <span class="swatch" style="background:{legend.color}"></span>
      <span>{legend.label}</span>
    </div>
  </div>
{/if}

<style>
  .species-legend {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-3);
    z-index: 5;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--elev-2);
  }

  /* P1 fix (Ben's phone report, 2026-09-24): a `display:none` used to live HERE for "no room
     beside the sheet" below 900px -- but Shell.svelte reuses this exact component's markup inside
     LegendChip.svelte's phone modal (the SAME `<Comp {legend} />`), so this rule also blanked the
     modal's body on the phone. The desktop floating placement's "no room on the phone" hiding
     (originally added to dodge an axe `bgOverlap` against the rail, e2e/shell.a11y.spec.ts) now
     lives in shell.css's `.lens-legend-region` instead, a wrapper class Shell.svelte itself owns
     around the desktop-only branch -- this component no longer decides by viewport at all, only by
     `isPhone` (via which slot Shell.svelte mounts it into). See ScoresLegend.svelte's identical
     fix, same reason. */

  .species-legend--categorical h2 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-1);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }

  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    flex: none;
  }
</style>
