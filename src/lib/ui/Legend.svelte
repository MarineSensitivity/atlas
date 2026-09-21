<script lang="ts">
  // atlas-3 spec.md §8 / "Data color": Legend takes its stops as PROPS -- it must NOT define a
  // ramp of its own. Score ramps come from src/lib/raster/ramps.ts (`legendStops()`) at runtime;
  // this component only renders whatever LegendStop[] it is handed. A continuous ramp cannot meet
  // 3:1 stop-to-stop (spec.md §8), which is why it is labelled with tick VALUES rather than relying
  // on color alone.
  import type { LegendStop } from "../raster/ramps";

  interface Props {
    title: string;
    stops: LegendStop[];
    formatValue?: (value: number) => string;
  }

  let { title, stops, formatValue = (v: number) => v.toFixed(2) }: Props = $props();
  const gradient = $derived(`linear-gradient(to right, ${stops.map((s) => s.color).join(", ")})`);
</script>

<div class="legend">
  <h2>{title}</h2>
  <div class="ramp" style="background: {gradient}"></div>
  <div class="ramp-ticks">
    {#each stops as s, i (i)}
      <span>{formatValue(s.value)}</span>
    {/each}
  </div>
</div>

<style>
  .legend {
    width: 280px;
    font-size: var(--text-xs);
  }

  .legend h2 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-2);
  }

  .ramp {
    height: 10px;
    border-radius: var(--radius-pill);
  }

  .ramp-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
