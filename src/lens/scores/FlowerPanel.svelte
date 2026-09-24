<script lang="ts">
  // atlas-4 — the flower panel. Step 1 ships the two Tier-0-only paths (nothing selected -> the
  // release's `flower_default`; a zone selected -> `boot.zones[unit]`'s own metrics); a cell
  // selection's flower needs the engine (`sql/cell_components.sql`) and is wired by
  // `ScoresLens.svelte`'s step-2 click handling, which passes `cellComponents` down once loaded.
  import Flower from "../../lib/ui/Flower.svelte";
  import {
    defaultFlowerComponents,
    flowerEmptyText,
    flowerTitle,
    zoneFlowerComponents,
    type DedupResult,
  } from "./flower";
  import { zoneAllKey, zoneRows } from "./boot";
  import type { ScoresSelection } from "./selection";

  interface Props {
    boot: unknown;
    selection: ScoresSelection;
    /** the clicked cell's own flower (step 2's engine-backed path, already de-duplicated by
     * `cellFlowerComponents`); `undefined` while unloaded, `null` on a load failure OR genuinely no
     * data. Cell selections fall back to a loading/empty message when this is not yet a real
     * result. */
    cellComponents?: DedupResult | null;
    /** D3(b) (Opus 5.5 eyes-on, 2026-09-24): set ONLY when `cellComponents` became `null` because
     * the fetch itself THREW (a real engine/network failure) — `undefined`/`null` for a plain "no
     * components" answer. Keeps the "genuine query failure" state textually distinct from "nothing
     * scored is selected" (`flower.ts#flowerEmptyText`'s own header explains why they must never be
     * confused). */
    cellComponentsError?: string | null;
    cellCoords?: { lon: number; lat: number };
  }

  let { boot, selection, cellComponents, cellComponentsError, cellCoords }: Props = $props();

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

  // every path already returns ONE slot per category (`flower.ts`'s `dedupeFlowerComponents`,
  // atlas-4 fix round 2) -- `droppedLabels` is surfaced to `Flower.svelte` so it can announce the
  // drop once, rather than the data quirk silently disappearing.
  const result = $derived.by((): DedupResult | null => {
    if (selection?.kind === "zone")
      return zoneFlowerComponents(zoneRows(boot, selection.unit), selection.key);
    if (selection?.kind === "cell") return cellComponents ?? null;
    return defaultFlowerComponents(boot, allKey);
  });
  const components = $derived(result?.components ?? null);
  const droppedLabels = $derived(result?.droppedLabels ?? []);
</script>

<div class="flower-panel">
  {#if components}
    <Flower {title} {components} {droppedLabels} />
  {:else if selection?.kind === "cell" && cellComponents === undefined}
    <p class="note">Loading the cell's component scores…</p>
  {:else if cellComponentsError}
    <p class="note note--error">{flowerEmptyText(cellComponentsError)}</p>
  {:else}
    <p class="note">{flowerEmptyText()}</p>
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

  /* D3(b): a genuine query failure reads visually distinct from the plain "click a cell" hint --
     never the same colour as a routine empty state. */
  .note--error {
    color: var(--text-danger);
  }
</style>
