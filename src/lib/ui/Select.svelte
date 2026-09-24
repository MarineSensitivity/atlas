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
  import { uid } from "./uid";

  interface Props {
    options: SelectOption[];
    value: string;
    /** the accessible name (aria-label) -- spec.md's controls carry no visible label of their own */
    label: string;
    onchange?: (value: string) => void;
    id?: string;
  }

  let { options, value, label, onchange, id }: Props = $props();
  // per-INSTANCE, not per-label, when no explicit id is given (SC 4.1.2) -- see HexButton.svelte's
  // identical fix. Resolved ONCE, a plain const, never re-run on a later render.
  // svelte-ignore state_referenced_locally
  const selectId = id ?? uid("select");

  // the innermost open layer handles Esc first: while the native listbox is open, Escape closing
  // it is the browser's own default action and does not stop the keydown from also bubbling to an
  // enclosing Panel's Escape-collapses-it handler.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") event.stopPropagation();
  }
</script>

<span class="select-wrap">
  <select
    id={selectId}
    class="select"
    aria-label={label}
    {value}
    onchange={(e) => onchange?.(e.currentTarget.value)}
    onkeydown={handleKeydown}
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
    /* D2 (Opus eyes-on assessment, 2026-09-24): every caller (LayersPanel's Study area/Spatial
       units/Color palette, ReportTool's zone picker) places this in a container that gives it a
       definite width -- a flex-column field or row -- but `inline-flex` on its own only ever
       shrink-wraps to content, so the visible box ended at the label text while the chevron
       (positioned against THIS element, below) floated wherever an ambient parent `stretch`
       happened to push it. Spanning the container explicitly removes that dependency; see
       `.select`'s own `width: 100%` below for the other half of the fix. */
    width: 100%;
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
    /* D2: a horizontal flex child does not stretch along the MAIN axis on its own (`align-items:
       stretch` only affects the CROSS axis) -- without this the select's own border-box stayed
       content-sized even once `.select-wrap` above spanned the full field, which is exactly what
       let the chevron (absolutely positioned against the now-wide wrapper) drift away from the
       box it is meant to sit inside. */
    width: 100%;
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
