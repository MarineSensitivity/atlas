<script lang="ts">
  import Legend from "../../lib/ui/Legend.svelte";
  import { legendStops } from "../../lib/raster/ramps";

  // sample-only stops for the gallery, generated at runtime (never a hex literal in this file --
  // check-hex-literals.mjs also scans src/gallery). Real stops come from boot.palettes; Legend
  // itself never invents a ramp.
  const sampleStops = Array.from({ length: 6 }, (_, i) => `hsl(${210 - i * 40}, 70%, 55%)`);
  const stops = legendStops(sampleStops, 0, 1);
</script>

<div class="stage">
  <Legend title="Composite score" {stops} formatValue={(v) => v.toFixed(1)} />
</div>

<style>
  .stage {
    padding: var(--space-4);
  }
</style>
