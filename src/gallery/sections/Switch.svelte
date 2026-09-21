<script lang="ts">
  import Switch from "../../lib/ui/Switch.svelte";

  let obisOn = $state(false);
</script>

<div class="row">
  <Switch label="OBIS occurrences" checked={obisOn} onchange={(v) => (obisOn = v)} />
  <span class="muted">{obisOn ? "on" : "off"}</span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .muted {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
</style>
