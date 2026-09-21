<script lang="ts">
  import Segmented from "../../lib/ui/Segmented.svelte";

  let lens = $state("scores");
</script>

<div class="stage">
  <Segmented
    ariaLabel="Lens"
    value={lens}
    options={[
      { value: "scores", label: "Scores" },
      { value: "species", label: "Species" },
    ]}
    onchange={(v) => (lens = v)}
  />
  <p class="muted">current: {lens}</p>
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
