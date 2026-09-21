// The reactive Sel <-> URL binding. This is the ONLY file under src/lib allowed to import svelte
// (plan atlas-2 Step 2 Gate: "no module in src/lib imports svelte except state/") — every rule
// (parsing, clamping, formatting, legacy-key rewriting) lives in the plain, Node-testable modules
// beside it (codec.ts, legacy.ts, types.ts), so those stay unit-testable without a DOM. This file is
// wiring only: a Svelte 5 `$state` object kept in sync with the URL via `history.replaceState` —
// NEVER push-state (CLAUDE.md "URL-is-the-view": a link must reproduce its exact view, not grow a
// back-button stack of every filter tweak; see tests/state/invariants.test.ts's source-scan guard).
//
// No lens/panel component consumes this yet (no UI in this phase, per the subplan) — this exists so
// later phases have one place to mount into, matching the module's documented contract.
import { formatSel, parseSel, type UrlLike } from "./codec";
import { DEFAULT_SEL, type Sel } from "./types";
import type { AliasLookup } from "./legacy";

export interface SelStore {
  /** the live, reactive `Sel` — read this from a component; mutate it only through `set`/`replace`. */
  readonly sel: Sel;
  /** patch one or more fields and write the resulting URL with `history.replaceState`. */
  set(patch: Partial<Sel>): void;
  /** replace the whole `Sel` (defaults filled for any field `next` omits) and write the URL. */
  replace(next: Partial<Sel>): void;
}

/**
 * Create a `Sel` bound to the current URL, initialized by parsing `loc` once. Call this ONCE per
 * page (index.html / report.html); later phases' components read `.sel` and call `.set()`, which
 * mutates the reactive object and pushes the new URL via `history.replaceState` in the same tick, so
 * the URL and the in-memory `Sel` can never observably disagree.
 */
export function createSelStore(loc: UrlLike & { pathname: string }, alias?: AliasLookup): SelStore {
  const state = $state<Sel>(parseSel(loc, alias));

  function sync() {
    const { search, hash } = formatSel(state);
    history.replaceState(history.state, "", `${loc.pathname}${search}${hash}`);
  }

  return {
    get sel() {
      return state;
    },
    set(patch: Partial<Sel>) {
      Object.assign(state, patch);
      sync();
    },
    replace(next: Partial<Sel>) {
      Object.assign(state, DEFAULT_SEL, next);
      sync();
    },
  };
}
