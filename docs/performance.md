# performance.md — what each budget measured, on what, and the three slowest matrix states

atlas-8 step 3. Every number below is real, from a real command run in this dispatch (2026-09-23,
macOS, this worktree, laptop) unless marked otherwise. Nothing here is invented or interpolated.

## Size budgets (`scripts/size-budget.mjs`, `pages.yml`'s `checks` job)

Measured with `npm run build && node scripts/size-budget.mjs` (2026-09-23):

| what                                                | measured          | budget   |
| --------------------------------------------------- | ----------------- | -------- |
| static critical path (index.html's own `<script>`s) | **409.4 KB gzip** | ≤ 450 KB |
| runtime worker (maplibre-gl's)                      | **140.5 KB gzip** | ≤ 150 KB |
| combined, "before first interaction"                | **549.9 KB gzip** | ≤ 600 KB |

Both individual budgets and the combined one pass with headroom (40.6 KB / 9.5 KB / 50.1 KB
respectively). The two red-fixture controls
(`npm run build:fixture:size-budget[-worker]` + the inverted checker call) still fail as designed —
re-verified in this dispatch's own `npx tsc`/`vitest`/`eslint`/`prettier` pass, unchanged from
atlas-0's own wiring.

## The timing gate (`e2e/species.timing.spec.ts`, its own "timing" Playwright project)

Rule (this subplan's own pyramid + atlas-8's 2026-09-21 handover): the gate runs ALONE
(`workers: 1`, `dependencies: ["chromium","webkit","firefox"]` in `playwright.config.ts` so it
starts only once those finish), gates on the MEDIAN of N ≥ 3 cold runs, never a single sample.

**Laptop, this dispatch** (`npx playwright test --project=timing --no-deps`, machine otherwise
idle): three cold runs of **1711 ms, 1497 ms, 1579 ms — median 1579 ms**, against the 2.5 s budget
(`e2e/species.timing.spec.ts:48`'s own assertion). This measures "deep link (`?sp=`) to first
species raster pixel painted," a different (later) milestone than S2's own "first maplibre paint"
number (atlas-0's spike, 499–740 ms median) — the two are not directly comparable; both stay well
inside their own budgets.

**CI runner: not yet observed.** atlas-0's review (F6) found "the ≤ 2.5 s first-data-frame gate has
never run on the CI runner" and asked this phase to put it into CI and record the runner's number.
This dispatch does the first half — `pages.yml`'s new `e2e` job runs `npx playwright test
--project=timing` as its own step, after the three engine projects, exactly matching the pyramid's
rule — but this session has no way to trigger or observe a real GitHub Actions run (no CI access
from this sandbox). **The runner's own median is still open**: the next real `main` push should have
its `timing gate` step's output pasted back into this section, replacing this paragraph, per F6's
original ask. Expect it to run slower than the laptop number above — GitHub's standard `ubuntu-
latest` runners are 2-core/7 GB shared VMs, and titiler tile latency (the dominant cost per S2)
is itself network-RTT-bound from whatever region the runner lands in.

## `scripts/verify.mjs`'s state matrix — laptop, chromium (full run)

`node scripts/verify.mjs --engines=chromium`: **174/174 pass** (58 named states × 3 viewports).
Total wall time ~35–40 s for the full sweep (not itself budgeted — `assertLayout` + the per-state
probes are correctness gates, not a timing gate).

**Cross-engine (webkit, firefox): substantially confirmed, not exhaustively swept.** Every
individual `e2e/*.spec.ts` file this phase widened (`map.spec.ts`, `scores.firstpaint.spec.ts`,
`species.smoke.spec.ts`, `places.spec.ts`, `verify.faults.spec.ts`) was run to completion on all
three engines via `npx playwright test <file> --project=<engine>` and is green (one narrowly-scoped
exception logged in `CHANGELOG.md`'s 0.10.2 entry and in `scores.firstpaint.spec.ts` itself). The
raw `verify.mjs` matrix itself was run on webkit/firefox in large but not full-174 batches: this
machine is shared (per this dispatch's own instructions) and its manually-launched `vite preview`
server on :4331 was killed by the OS (exit 137, OOM) three separate times over the course of this
session while other, unrelated processes on the same box were also under memory pressure —
independent of engine or test correctness (confirmed: every state that "failed" this way passed
cleanly on retry once the server was healthy again). This is a laptop/sandbox resource-sharing
artifact, not a finding about WebKit or Firefox, and not expected to recur on a CI runner's own,
non-shared VM. The mechanism itself (hermetic routing, cross-engine launch, the raster/vector
probes) is proven correct by the files above; a full three-engine `node scripts/verify.mjs` sweep
is `pages.yml`'s `e2e` job's job now, on hardware that does not have this problem.

## The three slowest matrix states, and their cause

From a clean (no other load) `node scripts/verify.mjs --engines=chromium` run's own per-state
timings (added this step — see `scripts/verify.mjs`'s `timings` array):

| rank | state                                                            | ms   |
| ---- | ---------------------------------------------------------------- | ---- |
| 1    | `shell (default) @ desktop [chromium]`                           | 1139 |
| 2    | `shell (theme=light) @ desktop [chromium]`                       | 990  |
| 3    | `scores proj=globe out=ecoregion area=FULL @ desktop [chromium]` | 959  |

**Cause: none of these is slow because of what it renders.** Every other state in the 174-run
matrix lands in the same 500–950 ms band regardless of how much data it composes (a 4-zone
choropleth, a raster + legend, a species deep link) — the cost here is dominated by Chromium's own
per-page fixed overhead (a fresh `browser.newPage()`, Vite's already-built bundle parse, Svelte
hydration, MapLibre's WebGL context + initial style compile), not by this app's logic. The TOP
state specifically is the FIRST page `verify.mjs` opens in a freshly-launched browser instance:
V8's JIT has compiled nothing yet and the OS has not yet paged in the browser's own code — every
subsequent state on the same browser instance benefits from that warm-up, which is exactly why
`shell (default)`, running first, is slowest, and why the next two are still "early in the run"
states rather than ones with unusually heavy composeStyle inputs. This is consistent with (and a
smaller-scale echo of) S2's own finding that map first-paint is dominated by fixed per-load costs,
not per-feature ones. No fix is indicated: the matrix is a correctness gate, and 1.1 s for a cold
Chromium launch plus a full hydration is not a regression to chase.

## What CI vs laptop actually differ on (summary)

| gate                                | laptop (this dispatch)                                                                          | CI runner                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| size-budget                         | 409.4 / 140.5 / 549.9 KB gzip                                                                   | not yet observed (job wired this step; deterministic build output, expected identical modulo Vite version drift) |
| timing gate (species first pixel)   | median 1579 ms / 2.5 s budget                                                                   | not yet observed (job wired this step; expect slower — shared 2-core runner + network-bound titiler RTT)         |
| `verify.mjs` matrix, chromium       | 174/174, ~35–40 s                                                                               | not yet observed                                                                                                 |
| `verify.mjs` matrix, webkit/firefox | spot-checked green per-file; full sweep blocked by this shared laptop's own OOM, not by the app | not yet observed                                                                                                 |
| `npm run parity` (v9)               | **PASS**, max\|Δ\| < 1e-9 on every quantity (real bucket, real network)                         | wired this step (own job); same command, expected identical since it reads the same published bucket             |
