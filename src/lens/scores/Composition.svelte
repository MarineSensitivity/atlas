<script lang="ts">
  // atlas-4 step 2 — the composition treemap, over the CURRENT species selection (parity doc §7.6).
  // "The 'bird' component has yet to be added to this visualization" stays a literal note (BOTW
  // taxa are not in the WoRMS hierarchy `composition.sql` joins against) until that changes —
  // an enhancement, not a parity gap this phase can close.
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
  <p class="note">
    Note: the "bird" component has yet to be added to this visualization (BOTW taxa are not in the
    WoRMS hierarchy this treemap is built from).
  </p>
  {#if rows === undefined}
    <p class="note">Loading species composition…</p>
  {:else if !tree}
    <p class="note">No composition data for this selection.</p>
  {:else if TreemapComponent}
    {@const Comp = TreemapComponent}
    <Comp {title} data={tree} />
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
