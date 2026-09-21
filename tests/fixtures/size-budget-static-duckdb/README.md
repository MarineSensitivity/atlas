# size-budget red fixture

A tiny, self-contained Vite project whose entry (`index.html` → `main.ts`) **statically** imports
`duckdb-stub.ts` — a stub standing in for `@duckdb/duckdb-wasm`'s real entry chunk, named so
`scripts/size-budget.mjs`'s forbidden-marker check can find it the same way it would find the real
package. `@duckdb/duckdb-wasm` is now a real dependency (pinned exactly `1.32.0`, `docs/spikes/S1.md`),
but a stub keeps this fixture's own build small and independent of the real package's size — the rule
under test is "never statically imported," not "how big is duckdb-wasm."

Build it, then run the checker against its output:

```sh
npm run build:fixture:size-budget
```

That must exit non-zero (red) — proving the check can actually fail, per the plan's "a check that
cannot fail is not a check." The real app's own `npm run build && node scripts/size-budget.mjs`
(green) is the control.
