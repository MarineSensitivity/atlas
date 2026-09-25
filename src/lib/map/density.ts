// Ben's ask (2026-09-25, round-3 review UI-4 fold-in): "it would be really awesome to have a
// sparkline style histogram showing the range of values and a vertical line where that given
// clicked element exists wrt to the full distribution actually in the popup" -- clarified as "a
// smooth DENSITY curve, not individual bars". This module is the pure math: bin a value list into
// counts, smooth those counts into a density curve (a small triangular kernel over ~40 bins reads
// as "smooth" without a real KDE's bandwidth-selection cost), and turn that into the closed SVG
// area path + marker x-position the sparkline component draws. Nothing here touches the DOM, a
// palette, or a network/engine call -- see `distribution.ts` for where the raw values come from,
// and `popup.ts` for how this gets turned into markup (the gradient fill is built there, from
// `raster/ramps.ts`'s own stops, never a second ramp here).
import { roundHalfEven } from "../geo/round";

export interface Histogram {
  /** the bin count actually used (may be less than requested if the value range degenerates). */
  binCount: number;
  /** raw counts per bin, left to right. */
  counts: number[];
  min: number;
  max: number;
}

/**
 * Bins `values` into `binCount` equal-width buckets over `[min(values), max(values)]`. Non-finite
 * values (NaN, ±Infinity -- a real Parquet column can carry either) are dropped before binning, not
 * counted, and never widen the range. `values` with fewer than 2 distinct finite values (empty, one
 * value, or every value identical) returns a ONE-bin histogram holding every value — a degenerate
 * but still valid "distribution" (a flat point at that value), rather than dividing by a
 * `max - min` of zero.
 */
export function binValues(values: readonly number[], binCount = 40): Histogram {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { binCount: 0, counts: [], min: 0, max: 0 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max - min < 1e-12) {
    return { binCount: 1, counts: [finite.length], min, max };
  }
  const n = Math.max(1, Math.floor(binCount));
  const counts = new Array<number>(n).fill(0);
  const width = (max - min) / n;
  for (const v of finite) {
    // the max value must land in the LAST bin, not spill into a phantom (n)-th one.
    const idx = Math.min(n - 1, Math.floor((v - min) / width));
    counts[idx]++;
  }
  return { binCount: n, counts, min, max };
}

/**
 * A small triangular kernel (`[1, 2, 1] / 4` at the interior, clamped at the edges) applied `passes`
 * times — this is what turns the raw per-bin counts into a curve that reads as a smooth density
 * rather than individual bars, without a real KDE's bandwidth search. Two passes approximates a
 * wider Gaussian kernel closely enough for a ~120px-wide sparkline; the edges reflect rather than
 * zero-pad, so a distribution with real mass at its extreme bins is not artificially pinched to
 * zero at the ends.
 */
export function smoothCounts(counts: readonly number[], passes = 2): number[] {
  let out = [...counts];
  for (let p = 0; p < passes; p++) {
    const next = new Array<number>(out.length);
    for (let i = 0; i < out.length; i++) {
      const left = out[i - 1] ?? out[i];
      const right = out[i + 1] ?? out[i];
      next[i] = (left + 2 * out[i] + right) / 4;
    }
    out = next;
  }
  return out;
}

/**
 * The normalized [0, 1] density curve for `histogram` — smoothed counts, scaled so the tallest bin
 * is exactly 1 (the sparkline's own height is applied by the caller). An empty/zero-count
 * histogram returns an all-zero curve (a flat line, never `NaN` from a divide-by-zero).
 */
export function densityCurve(histogram: Histogram): number[] {
  const smoothed = smoothCounts(histogram.counts);
  const peak = Math.max(0, ...smoothed);
  if (peak <= 0) return smoothed.map(() => 0);
  return smoothed.map((c) => c / peak);
}

/**
 * The sparkline's closed SVG `<path>` `d` attribute — a filled area under `curve` (already [0, 1]
 * normalized, `densityCurve()`'s own output), `width`x`height` px, baseline at the bottom. One
 * point per bin, connected with straight lines (the smoothing already happened in `densityCurve`;
 * a second curve-fit here would just be decoration on decoration). An empty curve draws a flat
 * baseline rectangle of zero height — a closed, valid (if invisible) path, never a broken `d`.
 */
export function densityPathD(curve: readonly number[], width: number, height: number): string {
  if (curve.length === 0) return `M0,${height} L${width},${height} Z`;
  const n = curve.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const points = curve.map((v, i) => {
    const x = n > 1 ? i * stepX : width / 2;
    const y = height - v * height;
    return `${round2(x)},${round2(y)}`;
  });
  const first = points[0];
  const last = points[points.length - 1];
  const firstX = first.split(",")[0];
  const lastX = last.split(",")[0];
  return `M${firstX},${height} L${points.join(" L")} L${lastX},${height} Z`;
}

function round2(v: number): number {
  return roundHalfEven(v * 100) / 100;
}

/**
 * The marker's x position (px, within `[0, width]`) for `value` against `[min, max]` — clamped to
 * the ends for a value at or outside the observed range (the clicked cell is always ON the curve
 * it is plotted against, by construction, but a caller building this from a slightly different
 * source than the histogram itself — e.g. the raw click value vs. a resampled tile — should not be
 * able to place the marker off the sparkline entirely).
 */
export function markerX(value: number, min: number, max: number, width: number): number {
  if (!Number.isFinite(value)) return width / 2;
  const denom = Math.max(max - min, 1e-12);
  const t = Math.min(1, Math.max(0, (value - min) / denom));
  return round2(t * width);
}
