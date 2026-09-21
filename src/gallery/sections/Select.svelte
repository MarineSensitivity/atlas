<script lang="ts">
  import Select from "../../lib/ui/Select.svelte";

  let ver = $state("v7");
</script>

<div class="stage">
  <Select
    label="Release version"
    value={ver}
    options={[
      { value: "v7", label: "v7" },
      { value: "v8", label: "v8 (restricted)" },
      { value: "v9", label: "v9 (restricted)" },
    ]}
    onchange={(v) => (ver = v)}
  />
  <p class="muted">current: {ver}</p>
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
