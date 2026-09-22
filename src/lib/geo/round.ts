// R's round(), which is half-to-EVEN — not JavaScript's Math.round(), which is half-up.
//
// This matters twice in atlas-2: `pct_covered = round(fraction * 100)` in the coverage twin
// (a drawn rectangle snapped to a tenth of a cell produces exact halves, and msens rounds them
// R's way), and the codec's quantisation `round(coord * 10^precision)`, which the R twin has to
// reproduce digit for digit. Math.round(0.5) = 1 while R's round(0.5) = 0.

/**
 * R's `round()`: the half goes to the even neighbour, and nothing else is touched.
 *
 * Deliberately has NO tolerance of its own: `round(coord * 10^p)` in the codec must agree with the
 * R twin bit for bit, and it does — both sides round the SAME IEEE double (the multiplication is
 * deterministic), so any fudge here would be a difference, not a fix. Where a value is a computed
 * AREA rather than a parsed coordinate, snap it with `snapNoise()` first — see coverage.ts.
 */
export function roundHalfEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * Snap a computed value onto the 1e-9 grid, so a number that is an exact half on paper is an exact
 * half in the variable too.
 *
 * A cell coverage fraction is a sum of floating-point products, so the 0.5 % sliver that R's
 * `round()` sends to 0 arrives here as 0.4999999999996 or 0.5000000000004 depending on which
 * corner of which cell it is — and rounding THAT by its last bit is a coin toss between the two
 * implementations, exactly on the cases the half-even rule exists for. 1e-9 is far finer than any
 * meaningful `pct` and far coarser than the noise. The R twin does the same with
 * `round(round(x, 9))`.
 */
export function snapNoise(x: number, digits = 9): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e12) return x;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * R's `signif(x, digits)` (atlas-4: the raster legend's endpoints are `signif(rescale, 3)`,
 * verbatim — the manifest's own rescale, never re-rounded to a fixed number of decimals, which
 * would misrepresent a metric whose range is e.g. `[35.1, 11033.7]`). Half-even, like `round()`
 * above — R's `signif()` shares the same IEC 60559 rounding rule.
 */
export function signif3(x: number, digits = 3): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const magnitude = Math.floor(Math.log10(Math.abs(x)));
  const factor = 10 ** (digits - magnitude - 1);
  return roundHalfEven(x * factor) / factor;
}
