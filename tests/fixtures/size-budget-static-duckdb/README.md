# size-budget red fixture

A tiny, self-contained Vite project whose entry (`index.html` → `main.ts`) **statically** imports
`duckdb-stub.ts` — a stub standing in for `@duckdb/duckdb-wasm`'s real entry chunk, named so
`scripts/size-budget.mjs`'s forbidden-marker check can find it without the real dependency being
installed (S1 has not pinned a duckdb-wasm version yet, and atlas-0 is explicitly not allowed to add
it).

Build it, then run the checker against its output:

```sh
npm run build:fixture:size-budget
```

That must exit non-zero (red) — proving the check can actually fail, per the plan's "a check that
cannot fail is not a check." The real app's own `npm run build && node scripts/size-budget.mjs`
(green) is the control.
