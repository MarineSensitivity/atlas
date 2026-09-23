<script lang="ts">
  // atlas-3 spec.md §8 / "Data color": Legend takes its stops as PROPS -- it must NOT define a
  // ramp of its own. Score ramps come from src/lib/raster/ramps.ts (`legendStops()`) at runtime;
  // this component only renders whatever LegendStop[] it is handed. A continuous ramp cannot meet
  // 3:1 stop-to-stop (spec.md §8), which is why it is labelled with tick VALUES rather than relying
  // on color alone.
  import { legendTicks, type LegendStop } from "../raster/ramps";
  import { uid } from "./uid";

  interface Props {
    title: string;
    stops: LegendStop[];
    formatValue?: (value: number) => string;
    /** the unit the values are in (e.g. "score", "%"); passed by the caller, never hard-coded
     * here -- see the ramp's aria-label below (SC 1.1.1: the ramp's only text equivalent). */
    unit: string;
    /** how many of `stops` get a rendered label under the gradient -- spec.md's continuous-ramp
     * rule: the two ENDPOINTS (default) and optionally a midpoint (3), never one label per stop
     * (the atlas-4/5 fix: a species legend used to print all 11 stops at 2 dp). The GRADIENT still
     * paints every color in `stops` regardless -- only the labels are reduced (`ramps.ts`'s
     * `legendTicks`). A caller that genuinely wants more can raise this. */
    ticks?: number;
  }

  let {
    title,
    stops,
    formatValue = (v: number) => v.toFixed(2),
    unit,
    ticks = 2,
  }: Props = $props();
  const gradient = $derived(`linear-gradient(to right, ${stops.map((s) => s.color).join(", ")})`);
  const tickStops = $derived(legendTicks(stops, ticks));
  // the ramp's only accessible name: states the quantity (title) and both endpoints, with units --
  // a continuous ramp cannot meet 3:1 stop-to-stop (spec.md §8), so this IS the text equivalent
  // (SC 1.1.1), not merely a decorative caption.
  const rampName = $derived.by(() => {
    if (stops.length === 0) return `${title}, no data`;
    const lo = formatValue(stops[0].value);
    const hi = formatValue(stops[stops.length - 1].value);
    return `${title}, ${unit} ramp from ${lo} to ${hi} ${unit}`;
  });
  // fix list #11 (SC 1.3.1 + 2.4.6): the shell mounts this as a bare `<div>` child of `<main>` --
  // no landmark at all, so landmark navigation never offers it. `role="region"` + `aria-labelledby`
  // pointing at its OWN `h2` (per-instance, not a shared literal -- HexButton/Modal/Popover's own
  // identical fix) makes it reachable without inventing a second name for the same title.
  const titleId = uid("legend-title");
</script>

<div class="legend" role="region" aria-labelledby={titleId}>
  <h2 id={titleId}>{title}</h2>
  <div class="ramp" role="img" aria-label={rampName} style="background: {gradient}"></div>
  <div class="ramp-ticks" aria-hidden="true">
    {#each tickStops as s, i (i)}
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

  /* SC 1.4.1/1.4.11: forced-colors mode replaces `background-image` with `none` outright, which
     would leave the ramp completely blank -- unlike a chrome control's state, the ramp's colors
     ARE the data (a continuous score gradient), so forced-color-adjust: none keeps the author's
     gradient instead of trying to express it in the four system colors. A border keeps its
     boundary visible against a Canvas-colored page either way. */
  @media (forced-colors: active) {
    .ramp {
      forced-color-adjust: none;
      border: 1px solid CanvasText;
    }
  }

  .ramp-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
