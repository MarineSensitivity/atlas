<script lang="ts">
  // usability M14 / R2 deliverable 4: the phone has NO legend at all today
  // (ScoresLegend.svelte/SpeciesLegend.svelte both `display:none` below 900px, "no room beside the
  // sheet"). This is the phone's substitute: a small tappable chip above the bottom tab bar,
  // showing the legend's own title; tapping it opens the SAME legend content -- passed as a
  // snippet, so ScoresLegend.svelte/SpeciesLegend.svelte are reused verbatim here, never forked --
  // full-size in a modal. Shell.svelte mounts this ONLY while `isPhone` (its own header comment),
  // mutually exclusive with the desktop floating-legend branch, so "one legend on screen at a
  // time" (spec.md) still holds. Positioned by shell.css's `.legend-chip-region` (this component
  // sizes only itself, per src/shell/shell.css's own "the shell owns WHERE it floats" convention).
  import { type Snippet } from "svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
  let open = $state(false);
</script>

<button type="button" class="legend-chip" aria-haspopup="dialog" onclick={() => (open = true)}>
  <Icon name="layers" size={14} />
  <span>{title}</span>
</button>

<Modal {open} title="Legend" onclose={() => (open = false)}>
  <!-- ScoresLegend.svelte/SpeciesLegend.svelte both position their root `position: absolute` (they
       normally float directly over the map) -- `position: relative` here gives that absolute
       positioning a LOCAL containing block instead of the viewport, and the min-height gives its
       `bottom`/`right` offsets somewhere real to land (an absolutely-positioned child contributes
       NO height of its own to an auto-height parent). -->
  <div class="legend-modal-body">
    {@render children()}
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

  .legend-chip span {
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

  .legend-modal-body {
    position: relative;
    min-height: 140px;
  }
</style>
