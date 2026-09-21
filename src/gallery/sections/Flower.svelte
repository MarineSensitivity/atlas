<script lang="ts">
  // atlas-3 step 2b: Flower states -- 8 components (v8/v9), 7 (v7), a null component ("no data" --
  // not a zero-length petal), and all-null (empty ring, no centre number).
  import Flower from "../../lib/ui/Flower.svelte";
  import type { FlowerComponentInput } from "../../lib/ui/flowerGeometry";

  const eight: FlowerComponentInput[] = [
    { key: "bird", score: 62 },
    { key: "coral", score: 18 },
    { key: "fish", score: 40 },
    { key: "invertebrate", score: 55 },
    { key: "mammal", score: 70 },
    { key: "primary producer", score: 33 },
    { key: "turtle", score: 12 },
    { key: "primprod", score: 88 },
  ];

  const seven: FlowerComponentInput[] = eight.slice(0, 7);

  const withNoData: FlowerComponentInput[] = [
    { key: "bird", score: 62 },
    { key: "coral", score: null },
    { key: "fish", score: 40 },
    { key: "invertebrate", score: 55 },
    { key: "mammal", score: 70 },
    { key: "primprod", score: 33 },
    { key: "turtle", score: 12 },
  ];

  const allNull: FlowerComponentInput[] = [
    { key: "bird", score: null },
    { key: "coral", score: null },
    { key: "fish", score: null },
  ];
</script>

<div class="row">
  <Flower title="Full study area (default) — 8 components" components={eight} />
  <Flower title="Cell 12345 — 7 components (v7)" components={seven} />
  <Flower title="Program Area: GEO — one component absent" components={withNoData} />
  <Flower title="Cell 99999 — no data at all" components={allNull} size={150} />
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: flex-start;
  }
</style>
