// atlas-2 phase review, fix round 1, ruling 3: how this repo is allowed to assert that something
// is FAST, in a unit suite that is a required check on `main`.
//
// The rule it replaces: a single `performance.now()` sample compared against a budget. That is not
// a test of the code, it is a test of the machine — `tests/geo/coverage.test.ts`'s GAA case measured
// ~125 ms idle and 2,282 ms in 1 of 3 full-suite runs under load, i.e. an 18x spread with the
// implementation untouched. A gate that red-lights on scheduler noise gets ignored, and then it
// protects nothing.
//
// Two tools, and every timing assertion in this repo should use one of them:
//
// 1. {@link bestOfN} — the MINIMUM of N runs against a (generous) absolute budget. The minimum is
//    the right statistic for "how long does this take": noise only ever ADDS time, so the fastest
//    sample is the closest estimate of the true cost, and N samples make it very unlikely that
//    every one of them was descheduled. It still fails if the code is genuinely slow.
// 2. {@link ratioOf} — the RATIO of two measurements of the SAME code on inputs of different size.
//    This is the load-proof one: a busy machine slows both numerator and denominator, so the ratio
//    survives it, and it asserts the thing an absolute budget only implies — the COMPLEXITY. A
//    linear algorithm given 4x the input costs ~4x; an accidentally quadratic one costs ~16x.
//
// Prefer a ratio for the property, and keep an absolute best-of-N as a coarse backstop.
export interface Measurement {
  /** the minimum across all samples — the estimate the assertion uses. */
  ms: number;
  /** every sample, in order, for the console line (so a failure shows the spread). */
  samples: number[];
}

/** run `fn` `n` times (after one warm-up) and keep the fastest. `n` should be >= 5. */
export function bestOfN(n: number, fn: () => unknown): Measurement {
  fn(); // warm up: JIT, caches, lazy allocation
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return { ms: Math.min(...samples), samples };
}

/** `big.ms / small.ms`, guarded against a 0 ms denominator on a very fast machine. */
export function ratioOf(big: Measurement, small: Measurement): number {
  return big.ms / Math.max(small.ms, 1e-6);
}

/** a one-line, greppable summary for the test log. */
export function describeMeasurement(label: string, m: Measurement): string {
  const all = m.samples.map((s) => s.toFixed(1)).join(", ");
  return `${label}: best ${m.ms.toFixed(1)} ms of [${all}]`;
}
