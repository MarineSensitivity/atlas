<script lang="ts">
  // atlas-3 spec.md §5.4 ("Layer pill") and §5.3 (a collapsed panel becomes "a labelled pill on
  // the nearest edge"): one small control that is either a SELECTABLE toggle (`pressed`, e.g. a
  // layer filter), a DISCLOSURE (`expanded` + `controls`, e.g. Panel's collapsed state), or
  // disabled with a reason (spec.md: "…feeds the merged model, but v7 publishes no surface for
  // it"). Exactly one of `pressed`/`expanded` applies to a given instance -- never both.
  import { uid } from "./uid";

  interface Props {
    label: string;
    pressed?: boolean;
    /** disclosure mode: pairs with `controls` (the id of the region this pill reveals) */
    expanded?: boolean;
    controls?: string;
    disabled?: boolean;
    /** required in practice whenever `disabled` is true -- spec.md: "a dashed border,
     * strike-through, aria-disabled, and a reason that says WHY". */
    disabledReason?: string;
    onclick?: () => void;
    class?: string;
  }

  let {
    label,
    pressed = false,
    expanded,
    controls,
    disabled = false,
    disabledReason,
    onclick,
    class: className = "",
  }: Props = $props();

  // per-INSTANCE, not per-label (SC 4.1.2) -- see HexButton.svelte's identical fix.
  const reasonId = uid("pill-reason");
</script>

<span class="pill-wrap">
  <button
    type="button"
    class="pill {className}"
    class:pill--disabled={disabled}
    aria-pressed={expanded === undefined ? pressed : undefined}
    aria-expanded={expanded}
    aria-controls={controls}
    aria-disabled={disabled ? "true" : undefined}
    aria-describedby={disabled && disabledReason ? reasonId : undefined}
    {onclick}
  >
    {label}
  </button>
  {#if disabled && disabledReason}
    <!-- V1 fix (Opus eyes-on review, 2026-09-24): "struck-through 'Show analysis cells' has no
         visible reason" -- this used to be a hover/focus-only tooltip (`position: absolute`,
         shown by JS on pointerenter/focus), which (a) had nothing to show on a phone TAP (no
         hover, and focus-then-immediately-blur on touch never gave it time to register) and (b)
         clipped invisibly whenever an ancestor panel/list scrolled (`overflow: auto/hidden`
         crops an absolutely-positioned child that extends past its box -- exactly what "clipped
         at the panel edge" was). A plain, ALWAYS-RENDERED line of text in normal document flow
         can neither: it needs no interaction to appear, and normal-flow content is never clipped
         by an ancestor's overflow the way an absolutely-positioned one can be. -->
    <span class="pill-reason" id={reasonId}>{disabledReason}</span>
  {/if}
</span>

<style>
  .pill-wrap {
    /* V1 fix: stacks the pill above its always-visible reason line (below it, per the brief) --
       `inline-flex` (not `inline-block`) so this wrapper still sits inline among sibling
       buttons/pills in a toolbar row, wrapping the row's own flow to fit the extra line's
       height rather than the old absolutely-positioned tooltip's zero-layout-impact footprint. */
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .pill:hover {
    border-color: var(--text-secondary);
  }

  .pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .pill[aria-pressed="true"],
  .pill[aria-expanded="true"] {
    background: var(--fill-accent);
    /* R5 y1: --fill-accent alone is 1.49:1 on paper (exempt) -- the pill's own border is the
       boundary that carries the state at >= 3:1, per WCAG 1.4.11. */
    border-color: var(--border-accent);
    color: var(--text-on-accent);
    font-weight: 700;
  }

  .pill--disabled {
    border-style: dashed;
    color: var(--text-secondary);
    text-decoration: line-through;
    cursor: not-allowed;
  }

  /* V1 fix: a normal-flow line under the pill, ALWAYS rendered while disabled (never gated on
     hover/focus/tap) -- see this file's own script header for why this replaces the old
     absolutely-positioned hover tooltip (visible on a phone tap; never clipped by an ancestor's
     `overflow`). Wraps at a readable width rather than a single unbroken `nowrap` line, since a
     real reason ("Select a drawn or uploaded place first.") is a full sentence, not a short label. */
  .pill-reason {
    max-width: 220px;
    font-size: var(--text-xs);
    line-height: 1.3;
    color: var(--text-secondary);
  }
</style>
