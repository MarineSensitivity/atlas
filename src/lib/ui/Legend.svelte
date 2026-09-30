<script lang="ts">
  // atlas-3 spec.md §8 / "Data color": Legend takes its stops as PROPS -- it must NOT define a
  // ramp of its own. Score ramps come from src/lib/raster/ramps.ts (`legendStops()`) at runtime;
  // this component only renders whatever LegendStop[] it is handed. A continuous ramp cannot meet
  // 3:1 stop-to-stop (spec.md §8), which is why it is labelled with tick VALUES rather than relying
  // on color alone.
  import { legendTicks, colorForValue, type LegendStop } from "../raster/ramps";
  import { formatMarkerValue, histogramBars, markerX, type Histogram } from "../map/density";
  import { uid } from "./uid";

  interface Props {
    title: string;
    /** Ben's ask (round-3 review, UI-L2): "which layer is being displayed" -- a second line under
     * the title, built by `lib/map/legendTitle.ts#legendTitle()` (e.g. "Raster cells · All US
     * waters · v7"). `null`/omitted renders no second line at all. */
    subtitle?: string | null;
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
    /** R4-A (Ben, 2026-09-30): the density of values across the WHOLE layer, drawn above the ramp
     * on the ramp's own x-axis (first..last stop value) with bars coloured by the ramp at their x.
     * It is layer-level, so it never changes with a click. `null`/omitted draws today's legend
     * exactly (a source that failed, a vector range, a release with nothing to bin). */
    histogram?: Histogram | null;
    /** the last clicked element's value: a vertical line through histogram + ramp with its value
     * as a label (and as text for screen readers). `null`/omitted draws no marker. */
    marker?: number | null;
  }

  let {
    title,
    subtitle = null,
    stops,
    formatValue = (v: number) => v.toFixed(2),
    unit,
    ticks = 2,
    histogram = null,
    marker = null,
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
  // R4-A: the histogram and the marker share the ramp's x-axis (its first and last stop value).
  const domain = $derived(
    stops.length >= 2 ? { min: stops[0].value, max: stops[stops.length - 1].value } : null,
  );
  const bars = $derived.by(() => {
    if (!domain) return [];
    const colors = stops.map((s) => s.color);
    return histogramBars(histogram, domain).map((b) => {
      // a non-hex stop (the ramp draws fine from any CSS colour) must not take the legend down
      let color = "var(--text-secondary)";
      try {
        color = colorForValue(colors, b.value, domain.min, domain.max);
      } catch {
        /* keep the neutral fill */
      }
      return { ...b, color };
    });
  });
  const markerFrac = $derived(markerX(marker, domain));
  // the popup's own rounding, not the ramp-end formatter (which keeps decimals)
  const markerLabel = $derived(formatMarkerValue(marker, domain) ?? "");
  const histogramName = $derived(
    `Distribution of ${title} across the whole layer, ${unit} from ${
      stops.length ? formatValue(stops[0].value) : ""
    } to ${stops.length ? formatValue(stops[stops.length - 1].value) : ""}`,
  );
  // fix list #11 (SC 1.3.1 + 2.4.6): the shell mounts this as a bare `<div>` child of `<main>` --
  // no landmark at all, so landmark navigation never offers it. `role="region"` + `aria-labelledby`
  // pointing at its OWN `h2` (per-instance, not a shared literal -- HexButton/Modal/Popover's own
  // identical fix) makes it reachable without inventing a second name for the same title.
  const titleId = uid("legend-title");
</script>

<div class="legend" role="region" aria-labelledby={titleId}>
  <h2 id={titleId}>{title}</h2>
  {#if subtitle}
    <p class="legend-subtitle">{subtitle}</p>
  {/if}
  <div class="chart" class:has-marker={markerFrac !== null} data-testid="legend-chart">
    {#if bars.length}
      <svg
        class="hist"
        data-testid="legend-histogram"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={histogramName}
      >
        {#each bars as b, i (i)}
          <rect
            x={b.x * 100}
            y={100 - b.h * 100}
            width={b.w * 100}
            height={b.h * 100}
            fill={b.color}
          />
        {/each}
      </svg>
    {/if}
    <div class="ramp" role="img" aria-label={rampName} style="background: {gradient}"></div>
    {#if markerFrac !== null}
      <div
        class="marker"
        data-testid="legend-marker"
        style="left: {markerFrac * 100}%"
        class:marker-start={markerFrac < 0.12}
        class:marker-end={markerFrac > 0.88}
        aria-hidden="true"
      >
        <span class="marker-label">{markerLabel}</span>
      </div>
    {/if}
  </div>
  {#if markerFrac !== null}
    <span class="sr-only">Clicked value: {markerLabel} {unit}</span>
  {/if}
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
    margin: 0 0 var(--space-1);
  }

  .legend-subtitle {
    margin: 0 0 var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .ramp {
    height: 10px;
    border-radius: var(--radius-pill);
  }

  /* R4-A: histogram above the ramp on the same x-axis; the marker is one absolutely positioned
     line through both, its label riding above the chart. */
  .chart {
    position: relative;
  }

  .chart.has-marker {
    padding-top: 16px;
  }

  .hist {
    display: block;
    width: 100%;
    height: 32px;
    margin-bottom: 2px;
  }

  .marker {
    position: absolute;
    top: 16px;
    bottom: 0;
    width: 0;
    border-left: 2px solid var(--text-primary);
    /* a thin halo so the line reads over dark and light bars alike */
    filter: drop-shadow(0 0 1px var(--surface-raised));
    pointer-events: none;
  }

  .marker-label {
    position: absolute;
    top: -16px;
    left: 0;
    transform: translateX(-50%);
    padding: 0 var(--space-1);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 14px;
    white-space: nowrap;
  }

  .marker-start .marker-label {
    transform: none;
  }

  .marker-end .marker-label {
    transform: translateX(-100%);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* SC 1.4.1/1.4.11: forced-colors mode replaces `background-image` with `none` outright, which
     would leave the ramp completely blank -- unlike a chrome control's state, the ramp's colors
     ARE the data (a continuous score gradient), so forced-color-adjust: none keeps the author's
     gradient instead of trying to express it in the four system colors. A border keeps its
     boundary visible against a Canvas-colored page either way. */
  @media (forced-colors: active) {
    .ramp,
    .hist {
      forced-color-adjust: none;
    }

    .ramp {
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
