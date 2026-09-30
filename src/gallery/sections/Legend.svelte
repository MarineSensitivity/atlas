<script lang="ts">
  import Legend from "../../lib/ui/Legend.svelte";
  import { legendStops } from "../../lib/raster/ramps";

  // sample-only stops for the gallery, generated at runtime (never a hex literal in this file --
  // check-hex-literals.mjs also scans src/gallery). Real stops come from boot.palettes; Legend
  // itself never invents a ramp.
  // (#rrggbb, because the histogram bars interpolate the ramp -- `colorForValue` reads hex stops,
  // as every real `boot.palettes` entry is)
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  const sampleStops = Array.from(
    { length: 6 },
    (_, i) => `#${hex(40 + i * 40)}${hex(150 - i * 20)}${hex(230 - i * 30)}`,
  );
  const stops = legendStops(sampleStops, 0, 1);
  // R4-A: a sample whole-layer histogram (a skewed bell over 0..1) and a clicked value's marker
  const sampleCounts = [2, 5, 11, 20, 31, 40, 34, 22, 13, 8, 4, 2];
  const histogram = { binCount: sampleCounts.length, counts: sampleCounts, min: 0, max: 1 };
</script>

<div class="stage">
  <Legend
    title="Composite score"
    {stops}
    formatValue={(v) => v.toFixed(1)}
    unit="score"
    {histogram}
    marker={0.42}
  />
</div>

<style>
  .stage {
    padding: var(--space-4);
  }
</style>
