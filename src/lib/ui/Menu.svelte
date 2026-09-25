<script lang="ts">
  // R3-W2: a reusable dropdown menu -- `Menu.svelte` (`Popover.svelte`'s sibling, not a wrapper
  // around it: Popover has no `role="menu"` semantics, no roving tabindex and no `align` prop --
  // it exists for a two-sentence informational bubble, not a list of actions). This component owns
  // the trigger button, the floating `role="menu"` list, outside-click/Esc dismiss and focus
  // return -- the SAME pattern `src/shell/TopBarActions.svelte`'s own inline "more-menu" already
  // implements: roving tabindex via `roving.ts#nextRovingIndex`, and the panel is always rendered
  // (never `{#if open}`), toggled with `hidden`, so it EXISTS in the DOM at every point (SC 4.1.2).
  // The trigger deliberately carries NO `aria-controls` -- axe's `aria-valid-attr-value` rule flags
  // an `aria-haspopup="menu"` trigger's `aria-controls` as an untriaged "incomplete" finding
  // ("Unable to determine if aria-controls referenced ID exists...") whenever the referenced panel
  // is `hidden` at read time, REGARDLESS of it always being present in the DOM (measured,
  // `e2e/gallery.spec.ts`'s axe gate) -- the more-menu's own trigger omits it for the identical
  // reason, `aria-expanded` + the panel's own `role="menu"`/`aria-label` already say everything a
  // screen reader needs. `menuId` still names the panel's `id` (useful for a future `aria-owns` or
  // a test selector), it is simply never wired to `aria-controls`. Generalized here so a second
  // caller (the Download menu, R3-W2) never reimplements the trigger/panel wiring a third time.
  //
  // CalCOFI explore's `Menu` (`ui.tsx`, cited in the round-3 common brief) is the SHAPE this
  // borrows: a pill trigger with `aria-haspopup="menu"`, a `role="menu"` list, Esc/outside-click
  // close, `align` left/right -- not its code (this app has its own tokens/Icon/Popover).
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { MenuItem } from "./menuItem";
  import { nextRovingIndex } from "./roving";
  import { uid } from "./uid";

  interface Props {
    /** the trigger's accessible name, e.g. "Download". */
    label: string;
    items: readonly MenuItem[];
    /** which edge the panel hangs from -- a right-aligned trigger (the top bar's rightmost icons)
     * needs `align="right"` so the panel never overhangs the viewport's right edge. */
    align?: "left" | "right";
    /** the trigger's own visible content (an `<Icon>`, "Download…", …) -- this component supplies
     * only the button chrome (`aria-haspopup`/`aria-expanded`, the class, the click handler). */
    trigger: Snippet;
    triggerClass?: string;
    /** forwarded verbatim onto the trigger `<button>` -- Shell.svelte's existing
     * `data-tooltip`/`data-tour`/`data-control` conventions need a way in without this component
     * inventing a parallel prop for each one. */
    triggerAttrs?: Record<string, string>;
  }

  let {
    label,
    items,
    align = "left",
    trigger,
    triggerClass = "",
    triggerAttrs = {},
  }: Props = $props();

  let open = $state(false);
  let rovingIndex = $state(0);
  let triggerEl: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined = $state();
  const menuId = uid("menu");

  export function close() {
    if (!open) return;
    open = false;
    triggerEl?.focus();
  }

  export async function openMenu() {
    open = true;
    rovingIndex = 0;
    // wait for the always-rendered (never `{#if}`-gated, see template below) panel to lose
    // `hidden` before focusing its first item -- the same convention TopBarActions.svelte's
    // `openMore()` uses.
    await tick();
    menuEl?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }

  function toggle() {
    if (open) close();
    else void openMenu();
  }

  function selectItem(item: MenuItem) {
    if (item.disabled) return;
    close();
    item.onSelect?.();
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // the innermost open layer handles Esc first -- Popover.svelte's own rule
      close();
      return;
    }
    const nodes = menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    const current = [...nodes].indexOf(document.activeElement as HTMLElement);
    const next = nextRovingIndex(current === -1 ? 0 : current, nodes.length, event.key, "vertical");
    if (next === null) return;
    event.preventDefault();
    rovingIndex = next;
    nodes[next]?.focus();
  }

  function onDocumentPointerdown(event: PointerEvent) {
    if (!open) return;
    const target = event.target as Node;
    if (menuEl?.contains(target) || triggerEl?.contains(target)) return;
    open = false; // dismissed by clicking elsewhere -- focus was already elsewhere, no return needed
  }

  $effect(() => {
    document.addEventListener("pointerdown", onDocumentPointerdown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerdown);
  });
</script>

<span class="menu-wrap">
  <button
    type="button"
    class={triggerClass}
    bind:this={triggerEl}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    {...triggerAttrs}
    onclick={toggle}
  >
    {@render trigger()}
  </button>
  <!-- always rendered (never {#if open}), toggled with `hidden` -- same SC 4.1.2 fix as
       Popover.svelte/Accordion.svelte/TopBarActions.svelte's own more-menu. -->
  <div
    class="menu align-{align}"
    id={menuId}
    role="menu"
    aria-label={label}
    tabindex="-1"
    hidden={!open}
    bind:this={menuEl}
    onkeydown={onMenuKeydown}
  >
    {#each items as item, i (item.id)}
      {#if item.href && !item.disabled}
        <a
          class="menu-item"
          role="menuitem"
          tabindex={i === rovingIndex ? 0 : -1}
          href={item.href}
          target="_blank"
          rel="noopener"
          onclick={() => selectItem(item)}
        >
          {#if item.icon}<Icon name={item.icon} size={16} />{/if}
          <span class="menu-item-text">
            <span class="menu-item-label">{item.label}</span>
            {#if item.hint}<span class="menu-item-hint">{item.hint}</span>{/if}
          </span>
        </a>
      {:else}
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          tabindex={i === rovingIndex ? 0 : -1}
          aria-disabled={item.disabled || undefined}
          onclick={() => selectItem(item)}
        >
          {#if item.icon}<Icon name={item.icon} size={16} />{/if}
          <span class="menu-item-text">
            <span class="menu-item-label">{item.label}</span>
            {#if item.hint}<span class="menu-item-hint">{item.hint}</span>{/if}
          </span>
        </button>
      {/if}
    {/each}
  </div>
</span>

<style>
  .menu-wrap {
    position: relative;
    display: inline-block;
  }

  /* Fix round (Opus 5.5 eyes-on review): shell.css's global `.tool[data-tooltip]:hover::after`
     tooltip drew OVER the open menu's own top-right corner -- the pointer is still resting on the
     trigger (from the click that opened it) so `:hover` stays true after the click. A general
     "suppress tooltip while ITS OWN popover/menu is open" utility is being added elsewhere; this
     local override is enough for the one trigger this component renders, and does not assume any
     particular `triggerClass` (matches on the element/attributes this component itself controls,
     not the caller's own class name). Specificity: `button[aria-expanded][data-tooltip]::after`
     (2 attrs + 1 type + 1 pseudo-element) ties shell.css's `.tool[data-tooltip]:hover::after` (1
     class + 1 attr + 1 pseudo-class + 1 pseudo-element) on the class/attribute count, so the extra
     `.menu-wrap` ancestor here is load-bearing -- without it, which rule wins would depend on
     unrelated stylesheet load order, not this selector's own intent. */
  .menu-wrap button[aria-expanded="true"][data-tooltip]::after {
    content: none;
  }

  .menu[hidden] {
    display: none;
  }

  .menu {
    position: absolute;
    z-index: 25;
    top: calc(100% + var(--space-2));
    display: flex;
    flex-direction: column;
    min-width: 260px;
    padding: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    box-shadow: var(--elev-3);
  }

  .menu.align-left {
    left: 0;
  }

  .menu.align-right {
    right: 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--size-touch);
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: none;
    text-align: left;
    cursor: pointer;
  }

  .menu-item[aria-disabled="true"] {
    color: var(--text-secondary);
    cursor: not-allowed;
  }

  .menu-item:hover {
    background: var(--fill-control);
  }

  .menu-item[aria-disabled="true"]:hover {
    background: none;
  }

  .menu-item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .menu-item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .menu-item-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-item-hint {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
