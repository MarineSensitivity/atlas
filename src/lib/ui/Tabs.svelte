<script lang="ts" module>
  export interface TabOption {
    value: string;
    label: string;
  }
</script>

<script lang="ts">
  // R4-C (control grammar, branding/control-grammar.md): TABS change the VIEW of the same data
  // inside one surface -- plain labels on a hairline, the active one bold with a 3 px underline.
  // A gold pill switch (`Segmented.svelte`) changes the DATA; the rail changes the SURFACE. Never
  // style one as the other. Props mirror `Segmented`'s. Roving tabindex + automatic activation:
  // only the selected tab is in the Tab order; arrows/Home/End move AND select (`tabsKeys.ts`).
  import { tabsKeyTarget } from "./tabsKeys";

  interface Props {
    options: TabOption[];
    value: string;
    ariaLabel: string;
    onchange?: (value: string) => void;
  }

  let { options, value, ariaLabel, onchange }: Props = $props();

  let listEl = $state<HTMLDivElement>();

  function onkeydown(event: KeyboardEvent) {
    const current = options.findIndex((o) => o.value === value);
    const next = tabsKeyTarget(Math.max(current, 0), options.length, event.key);
    if (next === null) return;
    event.preventDefault();
    onchange?.(options[next].value);
    listEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
</script>

<!-- keydown bubbles from the focused tab (roving tabindex); the tablist itself is never a Tab stop -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabs" role="tablist" aria-label={ariaLabel} bind:this={listEl} {onkeydown}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="tab"
      aria-selected={value === opt.value}
      tabindex={value === opt.value ? 0 : -1}
      onclick={() => onchange?.(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: var(--space-4);
    border-bottom: 1px solid var(--divider);
  }

  .tabs button {
    min-height: var(--size-touch);
    padding: 0 var(--space-1);
    border: 0;
    /* the underline sits ON the tablist's hairline (negative margin) so the active one replaces it */
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .tabs button:hover {
    color: var(--text-primary);
  }

  .tabs button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .tabs button[aria-selected="true"] {
    color: var(--text-primary);
    font-weight: 700;
    border-bottom-color: var(--border-accent);
  }

  @media (forced-colors: active) {
    .tabs {
      border-bottom-color: ButtonText;
    }
    .tabs button[aria-selected="true"] {
      border-bottom-color: Highlight;
    }
  }
</style>
