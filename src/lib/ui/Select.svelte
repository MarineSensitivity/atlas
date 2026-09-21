<script lang="ts" module>
  export interface SelectOption {
    value: string;
    label: string;
  }
</script>

<script lang="ts">
  // atlas-3 spec.md §6: "version | mdiChevronDown | the v7 ▾ chip, every <select>-like control."
  // A native <select> underneath (full keyboard/AT support for free) with the chevron as a
  // decorative overlay -- the select itself carries the accessible name, the icon is aria-hidden.
  import Icon from "./Icon.svelte";

  interface Props {
    options: SelectOption[];
    value: string;
    /** the accessible name (aria-label) -- spec.md's controls carry no visible label of their own */
    label: string;
    onchange?: (value: string) => void;
    id?: string;
  }

  let { options, value, label, onchange, id }: Props = $props();
  const selectId = $derived(id ?? `select-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
</script>

<span class="select-wrap">
  <select
    id={selectId}
    class="select"
    aria-label={label}
    {value}
    onchange={(e) => onchange?.(e.currentTarget.value)}
  >
    {#each options as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <Icon name="version" size={16} class="select-chevron" />
</span>

<style>
  .select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .select {
    height: var(--size-touch);
    padding: 0 28px 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    appearance: none;
    cursor: pointer;
  }

  .select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .select-wrap :global(.select-chevron) {
    position: absolute;
    right: var(--space-2);
    color: var(--icon-muted);
    pointer-events: none;
  }
</style>
