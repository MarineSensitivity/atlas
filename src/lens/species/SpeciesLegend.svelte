<script lang="ts">
  // §6.2's legend, positioned bottom-right over the map (the same corner `add_legend(position =
  // "bottom-right")` used): the continuous 1-100 (or an AquaX Delivered 0-1000) ramp for a COG
  // layer, reusing the shared `Legend.svelte`; a single swatch + "range (presence)" for a PMTiles
  // range — `Legend.svelte` itself only knows how to draw a continuous ramp, so the categorical case
  // gets its own small markup here rather than forcing a one-stop ramp through it.
  import Legend from "../../lib/ui/Legend.svelte";
  import type { SpeciesLegend } from "./mapInputs";

  interface Props {
    legend: SpeciesLegend;
  }

  let { legend }: Props = $props();
</script>

{#if legend?.kind === "continuous"}
  <div class="species-legend" data-testid="species-legend">
    <Legend title={legend.title} stops={legend.stops} unit={legend.unit} />
  </div>
{:else if legend?.kind === "categorical"}
  <div class="species-legend species-legend--categorical" data-testid="species-legend">
    <h2>{legend.title}</h2>
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
