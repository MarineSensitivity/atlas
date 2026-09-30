<script lang="ts">
  import Tabs from "../../lib/ui/Tabs.svelte";

  let view = $state("species");
</script>

<div class="stage">
  <Tabs
    ariaLabel="Table view"
    value={view}
    options={[
      { value: "species", label: "Species" },
      { value: "zones", label: "Zones" },
      { value: "composition", label: "Composition" },
    ]}
    onchange={(v) => (view = v)}
  />
  <p class="muted">current: {view}</p>
</div>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .muted {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
</style>
