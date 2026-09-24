<script lang="ts" module>
  import type { IconName } from "./icon-paths";

  export interface RailItem {
    name: string;
    icon: IconName;
    label: string;
    /** spec.md §5.2: fades in place, stays focusable, never removed */
    inactive?: boolean;
    inactiveReason?: string;
  }
</script>

<script lang="ts">
  // atlas-3 spec.md §5.1: the tool rail is FIVE controls, the SAME five, in the SAME order, on
  // every viewport -- only `orientation` differs (vertical desktop column, horizontal phone bottom
  // bar). Roving tabindex per spec.md §5.1/roving.ts; this component owns no page position of its
  // own (the app shell places it), only its own glass chrome and layout direction.
  //
  // R4 (docs/usability.md §7): a labelled vertical stack, not a row of icon-only hexes -- the
  // hexagon shape moves to the logo (src/lib/brand/WaveHexMark.svelte) and to the active marker
  // (RailButton.svelte's own small hex "pip"). HexButton.svelte itself is unchanged and still
  // shown in the gallery; this file just stops using it as the rail's own button shape.
  import RailButton from "./RailButton.svelte";
  import { nextRovingIndex, type Orientation } from "./roving";

  interface Props {
    items: RailItem[];
    /** the `name` of the currently-open tool, or undefined if none is open */
    active?: string;
    orientation?: Orientation;
    ariaLabel?: string;
    onSelect?: (name: string) => void;
    /** spec.md §5.2: activating an inactive control re-announces its reason in the ONE shared
     * live region (Toast owns that region; the rail only forwards the text) */
    onAnnounce?: (text: string) => void;
  }

  let {
    items,
    active,
    orientation = "vertical",
    ariaLabel = "Tools",
    onSelect,
    onAnnounce,
  }: Props = $props();

  let rovingIndex = $state(0);

  function handleKeydown(event: KeyboardEvent) {
    const container = event.currentTarget as HTMLElement;
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button.railitem")];
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current === -1) return;
    const next = nextRovingIndex(current, buttons.length, event.key, orientation);
    if (next === null) return;
    event.preventDefault();
    rovingIndex = next;
    buttons[next]?.focus();
  }
</script>

<div
  class="rail rail--{orientation}"
  aria-label={ariaLabel}
  role="toolbar"
  aria-orientation={orientation}
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#each items as item, i (item.name)}
    <RailButton
      icon={item.icon}
      label={item.label}
      pressed={active === item.name}
      inactive={item.inactive}
      inactiveReason={item.inactiveReason}
      tabindex={i === rovingIndex ? 0 : -1}
      {orientation}
      tourId={`rail-${item.name}`}
      {onAnnounce}
      onclick={() => {
        rovingIndex = i;
        onSelect?.(item.name);
      }}
    />
  {/each}
</div>

<style>
  /* R4: a labelled stack, not a rounded pill of hexes -- card radius, tighter gap/padding, matching
     the reviewed mockup (docs/design/mockups/r2/r2.css's `.rail-stack`). */
  .rail {
    display: inline-flex;
    gap: 6px;
    padding: 6px;
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--surface-panel) var(--glass-opacity), transparent);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--elev-2);
  }

  .rail--vertical {
    flex-direction: column;
  }

  .rail--horizontal {
    flex-direction: row;
  }
</style>
