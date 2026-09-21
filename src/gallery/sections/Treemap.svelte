<script lang="ts">
  // atlas-3 step 2b: species composition (populated) and an empty state.
  import Treemap, { type TreemapInputNode } from "../../lib/ui/Treemap.svelte";

  // roughly the v9 scored-species counts by category (report pipeline spec.md:330)
  const composition: TreemapInputNode = {
    name: "root",
    children: [
      { name: "invertebrate", value: 9424 },
      { name: "fish", value: 6290 },
      { name: "coral", value: 783 },
      { name: "primary producer", value: 319 },
      { name: "bird", value: 229 },
      { name: "mammal", value: 75 },
      { name: "turtle", value: 6 },
    ],
  };

  const empty: TreemapInputNode = { name: "root", children: [] };
</script>

<div class="row">
  <Treemap title="Species composition — full study area" data={composition} />
  <Treemap title="Species composition — no data" data={empty} />
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: flex-start;
  }
</style>
