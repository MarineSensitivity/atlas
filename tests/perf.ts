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
//
// Every test using either MUST pass {@link PERF_TIMEOUT_MS} as its vitest timeout — see that
// constant for the failure that made it necessary.
/**
 * The timeout every perf test must be given (vitest's third `it()` argument).
 *
 * Fix round 2, defect 1: best-of-5 on the GAA fixture ran [948.9, 1010.2, 522.3, 504.3, 599.6] ms
 * on a loaded machine and blew vitest's DEFAULT 5,000 ms per-test timeout — so the suite went red
 * with `Test timed out in 5000ms` even though the measurement itself was well inside its 2,000 ms
 * budget. A sampling gate that samples N times inherently needs N times the headroom, and the
 * default was never chosen with that in mind. 60 s is deliberately absurd: it exists to make the
 * TIMEOUT never be the thing that fails, so that the only thing that can fail is the assertion.
 */
export const PERF_TIMEOUT_MS = 60_000;

export interface Measurement {
  /** the minimum across all samples — the estimate the assertion uses. */
  ms: number;
  /** every sample, in order, for the console line (so a failure shows the spread). */
  samples: number[];
}

/**
 * Run `fn` up to `n` times (after one warm-up) and keep the fastest.
 *
 * **It stops as soon as one sample comes in under `budgetMs`.** A pass needs exactly one good
 * sample — the minimum is the estimate, and no later sample can lower a number already under
 * budget — so the common case costs one run, not `n`. Only a genuinely slow implementation, or one
 * being descheduled every single time, pays for all `n`; and that is precisely the case where the
 * extra samples are worth their cost, because that is when the answer is still in doubt.
 *
 * Omitting `budgetMs` (the ratio callers, which have no absolute budget) samples all `n`.
 */
export function bestOfN(n: number, fn: () => unknown, budgetMs?: number): Measurement {
  fn(); // warm up: JIT, caches, lazy allocation
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
    if (budgetMs !== undefined && samples[samples.length - 1] < budgetMs) break;
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
