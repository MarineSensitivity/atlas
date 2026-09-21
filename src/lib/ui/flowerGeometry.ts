// atlas-3 step 2b: the flower plot's geometry, pulled out of Flower.svelte so its hard rules are
// unit-tested directly (CLAUDE.md: core logic lives in an exported function; the component only
// calls it). Mirrors msens::ggplot_flower() (viz.R:719-829): every bar has `even = 1` (equal
// angular width, independent of score or how many components there are -- 7 on v7, 8 on v8/v9,
// parity scores app.md:826-830); centre = `weighted.mean(score, even, na.rm = TRUE)`, which with
// every weight equal to 1 IS the plain mean of the components actually present.
//
// One deliberate correction over the R app: a component with NO value is "no data", not an
// implicit 0 that `na.rm = TRUE` quietly drops from view. This module keeps that component's
// angular SLOT (so the ring's layout doesn't shift depending on which components happen to be
// present) but draws no petal in it and excludes it from the mean -- "absent is not zero"
// (docs/design/spec.md / the plan).
import { categoryFor, type Category } from "./categories";

export interface FlowerComponentInput {
  /** raw category/component key as the data names it (msens sp_cat, or the flower's
   * metric_key-derived component label) -- resolved through categories.ts so every spelling of a
   * category shares one color token. */
  key: string;
  /** 0-100, or null when this place has no value for this component ("no data", not zero). */
  score: number | null;
}

export interface FlowerPetal {
  key: string;
  category: Category;
  /** the score actually drawn, clamped to [0, 100] */
  score: number;
  startAngle: number;
  endAngle: number;
  /** SVG path `d` for a filled sector from the centre out to `score`'s scaled radius; "" when the
   * radius is 0 (a real score of exactly 0 -- still present, just degenerate) */
  path: string;
}

export interface FlowerSlot {
  key: string;
  category: Category;
  startAngle: number;
  endAngle: number;
}

export interface FlowerGeometry {
  /** one entry per input component with a non-null score, in input order -- what is actually drawn */
  petals: FlowerPetal[];
  /** one entry per input component with a null score, in input order -- drawn as nothing ("absent
   * is not zero"); the panel/table/text summary lists these as "no data" */
  noData: FlowerSlot[];
  /** the mean of the NON-null scores, unrounded; null when every component is null ("centre = the
   * mean of the non-null components") */
  centerValue: number | null;
  /** total slots -- fixes the equal angular width (360 / sliceCount) independent of how many of
   * them are actually drawn */
  sliceCount: number;
}

export interface FlowerGeometryOptions {
  /** the SVG viewBox is `0 0 (2*outerRadius) (2*outerRadius)`; the centre is
   * `(outerRadius, outerRadius)`. Default 100 (a 0-100 viewBox unit maps 1:1 to a score point). */
  outerRadius?: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  // angleDeg = 0 at 12 o'clock, increasing clockwise -- reads the same rotational sense as
  // coord_polar(theta = "y") without needing to reproduce ggplot's exact axis origin.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** a filled circular sector from `(cx, cy)` out to `radius`, spanning `[startAngle, endAngle)`
 * degrees. `radius <= 0` draws nothing (a real score of 0, not an error). */
export function sectorPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  if (radius <= 0 || endAngle <= startAngle) return "";
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return (
    `M ${cx} ${cy} ` +
    `L ${start.x.toFixed(3)} ${start.y.toFixed(3)} ` +
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`
  );
}

/**
 * PURE: the flower's geometry for one place's components. Equal angular width regardless of score
 * or petal count (7 vs 8); a null score draws no petal and never enters the mean; scores are
 * clamped to [0, 100] before being drawn.
 */
export function computeFlowerGeometry(
  components: readonly FlowerComponentInput[],
  options: FlowerGeometryOptions = {},
): FlowerGeometry {
  const outerRadius = options.outerRadius ?? 100;
  const n = components.length;
  const petals: FlowerPetal[] = [];
  const noData: FlowerSlot[] = [];

  if (n === 0) return { petals, noData, centerValue: null, sliceCount: 0 };

  const angleStep = 360 / n; // EQUAL for every slot, regardless of score or count -- the seeded
  // fault this rule guards against is a width proportional to score (unequal petals)
  const present: number[] = [];

  components.forEach((c, i) => {
    const startAngle = i * angleStep;
    const endAngle = (i + 1) * angleStep;
    const category = categoryFor(c.key);
    if (c.score === null) {
      noData.push({ key: c.key, category, startAngle, endAngle });
      return;
    }
    const score = clamp(c.score, 0, 100);
    present.push(score);
    const radius = (score / 100) * outerRadius;
    petals.push({
      key: c.key,
      category,
      score,
      startAngle,
      endAngle,
      path: sectorPath(outerRadius, outerRadius, radius, startAngle, endAngle),
    });
  });

  const centerValue = present.length
    ? present.reduce((sum, v) => sum + v, 0) / present.length
    : null;

  return { petals, noData, centerValue, sliceCount: n };
}
