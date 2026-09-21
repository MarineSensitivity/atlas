<script lang="ts">
  // atlas-3 spec.md §5.4: aria-expanded="false" idle, chevron; aria-expanded="true" active,
  // chevron rotates. One chevron icon (never swapped for a second one) rotated by CSS, so the
  // glyph itself never changes -- only its orientation does.
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    children: Snippet;
    defaultOpen?: boolean;
  }

  let { title, children, defaultOpen = false }: Props = $props();
  // `defaultOpen` is deliberately read only ONCE, as an "uncontrolled" initial value (like
  // <input defaultValue>); this accordion's own open/closed state afterward is not meant to
  // track a later change to the prop.
  // svelte-ignore state_referenced_locally
  let open = $state(defaultOpen);
  const bodyId = $derived(`accordion-body-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
</script>

<div class="acc">
  <h3 class="acc-heading">
    <button
      type="button"
      class="acc-head"
      aria-expanded={open}
      aria-controls={bodyId}
      onclick={() => (open = !open)}
    >
      <span>{title}</span>
      <Icon name="chevronDown" size={18} class="acc-chevron {open ? 'acc-chevron--open' : ''}" />
    </button>
  </h3>
  {#if open}
    <div class="acc-body" id={bodyId}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .acc {
    border-top: 1px solid var(--divider);
  }

  .acc-heading {
    margin: 0;
  }

  .acc-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--size-touch);
    padding: var(--space-2) 0;
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-weight: 700;
    font-size: var(--text-md);
    text-align: left;
    cursor: pointer;
  }

  .acc-head span {
    flex: 1;
  }

  .acc-head:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .acc-head :global(.acc-chevron) {
    color: var(--icon-muted);
    transition: transform var(--motion-fast) var(--ease-out);
  }

  .acc-head :global(.acc-chevron--open) {
    transform: rotate(180deg);
  }

  .acc-body {
    padding: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
</style>
