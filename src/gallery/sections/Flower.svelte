<script lang="ts">
  // atlas-3 step 2b: Flower states -- 8 components (v8/v9), 7 (v7), a null component ("no data" --
  // not a zero-length petal), and all-null (empty ring, no centre number).
  import Flower from "../../lib/ui/Flower.svelte";
  import type { FlowerComponentInput } from "../../lib/ui/flowerGeometry";

  // one of each of the eight real categories (categories.ts's CATEGORY_KEYS) -- "primary
  // producer" and "primprod" are the SAME category (both normalize to primprod), so this fixture
  // must use only one of them; the eighth distinct slot is "other" (computeFlowerGeometry throws
  // on a genuine duplicate, see flowerGeometry.test.ts).
  const eight: FlowerComponentInput[] = [
    { key: "bird", score: 62 },
    { key: "coral", score: 18 },
    { key: "fish", score: 40 },
    { key: "invertebrate", score: 55 },
    { key: "mammal", score: 70 },
    { key: "other", score: 33 },
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
  <div id="flower-eight">
    <Flower title="Full study area (default) — 8 components" components={eight} />
  </div>
  <Flower title="Cell 12345 — 7 components (v7)" components={seven} />
  <div id="flower-one-absent">
    <Flower title="Program Area: GEO — one component absent" components={withNoData} />
  </div>
  <Flower title="Cell 99999 — no data at all" components={allNull} size={150} />
  <!-- W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25, phone-06/07): the EXACT scenario that wrapped
       onto two lines and narrowed to the flower's own compact column -- a real clicked-cell title
       (`flower.ts#flowerTitle`'s own format) at `FlowerPanel.svelte`'s phone half-detent cap
       (`FLOWER_SIZE_HALF_DETENT`, 170). The `.flower`/`.flower-body` CSS fix (Flower.svelte) is
       shared by this gallery instance and the real app's FlowerPanel, so this is a real reproduction
       of the bug, not a synthetic stand-in for it. -->
  <div id="flower-compact-cell-title">
    <Flower title="Cell ID: 3350704 (x: -90.575, y: 28.625)" components={seven} size={170} />
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: flex-start;
  }
</style>
