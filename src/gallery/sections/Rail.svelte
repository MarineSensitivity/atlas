<script lang="ts">
  import Rail, { type RailItem } from "../../lib/ui/Rail.svelte";

  // spec.md §5.1: the same five, in the same order, on every viewport
  const scoresItems: RailItem[] = [
    { name: "layers", icon: "layers", label: "Layers" },
    { name: "places", icon: "places", label: "Places" },
    { name: "flower", icon: "flower", label: "Flower plot" },
    { name: "table", icon: "table", label: "Table" },
    { name: "report", icon: "report", label: "Report" },
  ];

  // spec.md §5.2: in the Species lens, Flower fades in place instead of disappearing
  const speciesItems: RailItem[] = scoresItems.map((item) =>
    item.name === "flower"
      ? { ...item, inactive: true, inactiveReason: "Flower plot — Scores only" }
      : item,
  );

  let active = $state("layers");
  let announced = $state("");
</script>

<div class="demo-row">
  <figure>
    <Rail items={scoresItems} {active} onSelect={(name) => (active = name)} />
    <figcaption>desktop (vertical), Scores lens</figcaption>
  </figure>
  <figure>
    <Rail
      items={speciesItems}
      {active}
      onSelect={(name) => (active = name)}
      onAnnounce={(text) => (announced = text)}
    />
    <figcaption>desktop (vertical), Species lens -- Flower inactive in place</figcaption>
  </figure>
  <figure>
    <Rail
      items={scoresItems}
      {active}
      orientation="horizontal"
      onSelect={(name) => (active = name)}
    />
    <figcaption>phone bottom bar (horizontal), the same five tools</figcaption>
  </figure>
</div>

<p class="live" role="status" aria-live="polite">{announced}</p>
<p class="note">
  Roving tabindex: Tab once into a rail, then arrow keys move between its five controls. Click the
  inactive Flower button in the Species lens above to hear its reason announced.
</p>

<style>
  .demo-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6);
    padding: var(--space-4);
  }

  figure {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
  }

  figcaption {
    max-width: 16em;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .live,
  .note {
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .live {
    min-height: 1.2em;
  }
</style>
