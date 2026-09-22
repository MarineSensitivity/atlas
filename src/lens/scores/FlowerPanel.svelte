<script lang="ts">
  // atlas-4 — the flower panel. Step 1 ships the two Tier-0-only paths (nothing selected -> the
  // release's `flower_default`; a zone selected -> `boot.zones[unit]`'s own metrics); a cell
  // selection's flower needs the engine (`sql/cell_components.sql`) and is wired by
  // `ScoresLens.svelte`'s step-2 click handling, which passes `cellComponents` down once loaded.
  import Flower from "../../lib/ui/Flower.svelte";
  import type { FlowerComponentInput } from "../../lib/ui/flowerGeometry";
  import { defaultFlowerComponents, flowerTitle, zoneFlowerComponents } from "./flower";
  import { zoneAllKey, zoneRows } from "./boot";
  import type { ScoresSelection } from "./selection";

  interface Props {
    boot: unknown;
    selection: ScoresSelection;
    /** the clicked cell's own flower (step 2's engine-backed path); `undefined` while unloaded,
     * `null` on a load failure. Cell selections fall back to a loading/unavailable message when
     * this is not yet a real array. */
    cellComponents?: FlowerComponentInput[] | null;
    cellCoords?: { lon: number; lat: number };
  }

  let { boot, selection, cellComponents, cellCoords }: Props = $props();

  const allKey = $derived(zoneAllKey(boot));

  const title = $derived(
    selection?.kind === "cell" && cellCoords
      ? flowerTitle({ kind: "cell", cellId: selection.cellId, ...cellCoords })
      : selection?.kind === "zone"
        ? flowerTitle({ kind: "zone", name: zoneName(selection.unit, selection.key) })
        : flowerTitle(null),
  );

  function zoneName(unit: string, key: string): string {
    return zoneRows(boot, unit).find((z) => z.key === key)?.name ?? key;
  }

  const components = $derived.by((): FlowerComponentInput[] | null => {
    if (selection?.kind === "zone")
      return zoneFlowerComponents(zoneRows(boot, selection.unit), selection.key);
    if (selection?.kind === "cell") return cellComponents ?? null;
    return defaultFlowerComponents(boot, allKey);
  });
</script>

<div class="flower-panel">
  {#if components}
    <Flower {title} {components} />
  {:else if selection?.kind === "cell" && cellComponents === undefined}
    <p class="note">Loading the cell's component scores…</p>
  {:else}
    <p class="note">
      No flower data is published for {selection ? "this selection" : "the default view"} in this release.
    </p>
  {/if}
</div>

<style>
  .flower-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
</style>
