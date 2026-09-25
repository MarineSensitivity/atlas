<script lang="ts">
  // usability M14 / R2 deliverable 4: the phone has NO legend at all today
  // (ScoresLegend.svelte/SpeciesLegend.svelte both `display:none` below 900px, "no room beside the
  // sheet"). This is the phone's substitute: a small tappable chip, showing "Legend" + a
  // best-effort metric name (see below), that opens the SAME legend content -- passed as a
  // snippet, so ScoresLegend.svelte/SpeciesLegend.svelte are reused verbatim here, never forked --
  // full-size in a modal. Shell.svelte mounts this ONLY while `isPhone` (its own header comment),
  // mutually exclusive with the desktop floating-legend branch, so "one legend on screen at a
  // time" (spec.md) still holds.
  //
  // P1 fix (Ben's phone report, 2026-09-24): WHERE this chip renders is no longer this
  // component's concern beyond its own size -- Shell.svelte places it either in a floating
  // `.legend-chip-region` (shell.css, anchored to the sheet's measured top edge,
  // sheetGeometry.ts's `legendChipMode`) or inline inside the sheet's own header block
  // (Sheet.svelte's `headerExtra`) at the "full" detent, so it can never again land on top of the
  // sheet's header controls (peek) or its last scrolled-to row (half/full) the way a FIXED offset
  // used to.
  import { type Snippet } from "svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    children: Snippet;
    /** R3-B5 (Opus eyes-on review, 2026-09-25): the current layer's own long description, when the
     * release publishes one and it says something the ramp's own title does not already say
     * (`Shell.svelte`'s `phoneLegendDescription`, the SAME dedupe rule `LayersPanel.svelte`'s
     * `currentLayerDescription` already applies) -- shown under the ramp instead of leaving that
     * space blank. `undefined`/`null` renders nothing (species has none to offer yet). */
    description?: string | null;
  }

  let { title, children, description = null }: Props = $props();
  let open = $state(false);
</script>

<!-- P1 fix: Ben's report was two bugs, not one -- the chip's LABEL was the full metric title
     ("Combined score of extinction risk per species category...", unbounded), which made the
     positioning bug (below) worse the longer a title got. "Legend" is the fixed, load-bearing
     word (never truncated, `flex: none`); the metric name is a bonus that only shows as much of
     itself as the remaining space allows (`flex: 1 1 auto; min-width: 0`) -- at zero remaining
     space it shows nothing at all, never wrapping to a second line. The full title is still shown
     in full inside the modal (Legend.svelte's own <h2>), unaffected by this. -->
<button type="button" class="legend-chip" aria-haspopup="dialog" onclick={() => (open = true)}>
  <Icon name="layers" size={14} />
  <span class="legend-chip-label">
    <span class="legend-chip-label-word">Legend</span>
    <span class="legend-chip-label-metric">&middot; {title}</span>
  </span>
</button>

<Modal {open} title="Legend" onclose={() => (open = false)}>
  <!-- P1 fix: ScoresLegend.svelte/SpeciesLegend.svelte both position their root `position:
       absolute; right: var(--space-3); bottom: var(--space-3)` -- their DESKTOP placement, sized
       for a `right`/`bottom` offset against the whole map viewport. Reused verbatim here (never
       forked) with that positioning left in place, the same fixed offset instead spilled the
       ramp's 280px-wide box past this modal's own (much narrower) left edge -- invisible for as
       long as the modal body was `display:none` (the OTHER P1 bug), so nobody had seen it render
       until now. `:global()` neutralizes it to normal flow, using the component's own natural
       width instead of the desktop offset. -->
  <div class="legend-modal-body">
    {@render children()}
    {#if description}
      <p class="legend-description">{description}</p>
    {/if}
  </div>
</Modal>

<style>
  .legend-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-xs);
    box-shadow: var(--elev-2);
    cursor: pointer;
  }

  .legend-chip-label {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
    overflow: hidden;
  }

  .legend-chip-label-word {
    flex: none;
    white-space: nowrap;
  }

  .legend-chip-label-metric {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .legend-chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .legend-chip {
      height: var(--size-touch);
    }
  }

  /* R3-B5: sizes to its own content -- the OLD `min-height: 140px` floor left ~65px of dead card
     below a ramp that only needs ~76px, empty on every release that has no description to show.
     No floor at all now: the ramp card alone is never so short that a floor would have mattered,
     and a description paragraph (below) fills real space when one is published. */
  .legend-modal-body {
    position: relative;
  }

  .legend-description {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  /* P1 fix: see the template comment above `<Modal>` -- reaches into the reused child components'
     own scoped root class to drop their desktop `position: absolute` placement inside this modal. */
  .legend-modal-body :global(.scores-legend),
  .legend-modal-body :global(.species-legend) {
    position: static;
  }
</style>
