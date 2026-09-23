<script lang="ts">
  // atlas-4 step 2 — the composition treemap, over the CURRENT species selection (parity doc §7.6).
  //
  // G-24 fix (docs/parity.html): this used to carry a ported note (quoted in the fix's own commit
  // message and test, not repeated verbatim here on purpose -- see
  // tests/lens/scores/composition-note.test.ts's regression case) claiming the bird component was
  // still missing, above a treemap that DOES show a Bird box. That note describes the SHINY app's
  // six-rank WoRMS hierarchy treemap (G-06, not built here), whose `inner_join`
  // against `d_taxonomy` drops BOTW taxa because they carry no WoRMS row. This component's
  // treemap is the ONE-LEVEL version instead (`composition.ts#compositionTree`), grouped by
  // `sp_cat` straight off `species_sel` via a LEFT JOIN (`sql/composition.sql`) — birds are never
  // excluded by construction here, so the note is never true of what this component draws (both
  // `tests/fixtures/parity/{v7,v9}/composition.json` carry `sp_cat: "bird"` rows, and
  // `compositionTree()` includes any category with a positive sum, bird included). Removed
  // outright rather than made conditional: there is no live code path in this repo where the
  // shipped treemap structurally lacks a category that has data, so a per-selection absence (no
  // bird MODELS in this particular selection) is not the same claim the old note made — it is the
  // same "no box for an empty category" behaviour every other category already has.
  //
  // `Treemap.svelte` is loaded via a DYNAMIC `import()`, never a static one: this component (via
  // `TablePanel.svelte`) is reachable from `Shell.svelte`'s static graph the moment the scores
  // lens mounts, and `scripts/size-budget.mjs`'s FORBIDDEN_LAZY_MARKERS scans for exactly this —
  // "treemap" must never appear in a file reachable by static import (measured: a static import
  // here failed the budget with Treemap.svelte's own class names inside the entry chunk).
  import type { Component } from "svelte";
  import { compositionTree, type CompositionRow } from "./composition";

  interface Props {
    title: string;
    rows: CompositionRow[] | null | undefined;
  }

  let { title, rows }: Props = $props();

  const tree = $derived(rows ? compositionTree(rows) : null);

  // the dynamically-loaded Treemap.svelte component reference; its own Props type is not (and
  // should not be) imported here (see composition.ts's identical "plain tsc cannot see a .svelte
  // module's named exports" note) -- the props passed below are checked against the component's
  // actual Props by svelte-check at the IMPORT site inside .svelte files that import it statically
  // elsewhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TreemapComponent = $state<Component<any> | null>(null);

  $effect(() => {
    if (tree && !TreemapComponent) {
      import("../../lib/ui/Treemap.svelte").then((mod) => {
        TreemapComponent = mod.default;
      });
    }
  });
</script>

<div class="composition">
  {#if rows === undefined}
    <p class="note">Loading species composition…</p>
  {:else if !tree}
    <p class="note">No composition data for this selection.</p>
  {:else if TreemapComponent}
    {@const Comp = TreemapComponent}
    <Comp {title} data={tree} valueLabel="combined suitability x extinction-risk x area" />
  {:else}
    <p class="note">Loading the treemap…</p>
  {/if}
</div>

<style>
  .composition {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
</style>
