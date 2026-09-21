<script lang="ts">
  // atlas-3 spec.md §6: the ONE canonical name -> path map, rendered by this one component.
  // Never a raw path string as a prop -- that would let a caller re-introduce the exact mistake
  // the icon-map generator exists to prevent (a hand-typed "MDI" path that does not match the
  // library). An unknown name renders nothing rather than throwing, so a typo in a caller does
  // not blank the whole page; the icon-paths tests are what actually catch a typo.
  import { ICON_PATHS, type IconName } from "./icon-paths";

  interface Props {
    name: IconName;
    /** CSS pixels; the glyph is always drawn on a 24x24 viewBox, so this only scales it */
    size?: number;
    /** when set, the icon carries its OWN accessible name (role="img"). Leave unset when the
     * icon sits inside a control that already has an accessible name (a button's aria-label,
     * a tooltip) -- spec.md §5.1: "the rail carries no words; the tooltip does." */
    title?: string;
    class?: string;
  }

  let { name, size = 20, title, class: className = "" }: Props = $props();
  const d = $derived(ICON_PATHS[name]);
</script>

{#if d}
  <svg
    class="icon {className}"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    role={title ? "img" : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : "true"}
    focusable="false"
  >
    <path fill="currentColor" {d} />
  </svg>
{/if}

<style>
  .icon {
    display: inline-block;
    flex: none;
    color: inherit;
  }
</style>
