<script lang="ts">
  // atlas-3: a generic on/off control, role="switch" (WAI-ARIA switch pattern), Space/Enter
  // toggles via the native <button> activation behavior -- no extra keydown handling needed.
  interface Props {
    label: string;
    checked: boolean;
    /** m5 (review round 1): a control the release has not wired up yet (the Bathymetry "coming
     * soon" row) should not toggle a state nothing reads -- the native `disabled` attribute (not
     * merely `aria-disabled`) also removes it from the Tab order, matching the row's other
     * disabled controls (the opacity slider already had `disabled`, the move buttons below). */
    disabled?: boolean;
    /** P round deliverable 1 (Ben, live-review 2026-09-24): "the toggles add too much yellow
     * emphasis across whole panel" -- the Layers panel's stack list has 8 rows, all `visible: true`
     * by default, so every one of them lit up `--fill-accent` simultaneously. `"quiet"` swaps the
     * ON state to a neutral fill (the SAME `--fill-track` used for OFF elsewhere) reserving accent
     * for a real selected/active state (the new Raster cells | Program Areas toggle, the top bar's
     * lens switch) -- never a plain "is this switched on" that happens 8 times on one screen.
     * Default `"accent"`: every other caller (Sphere, Cells outside Program Areas) is unchanged. */
    variant?: "accent" | "quiet";
    onchange?: (checked: boolean) => void;
  }

  let { label, checked, disabled = false, variant = "accent", onchange }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="switch"
  class:switch--on={checked}
  class:switch--quiet={variant === "quiet"}
  {disabled}
  onclick={() => onchange?.(!checked)}
>
  <span class="switch-track">
    <span class="switch-thumb"></span>
  </span>
</button>

<style>
  .switch {
    /* m1 (review round 1): the visual track stays 40x22 (below), but SC 2.5.5's 44x44 target size
       is the CLICKABLE button box -- centered padding grows the hit area without growing what's
       drawn. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
  }

  .switch:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .switch:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .switch-track {
    position: relative;
    display: block;
    width: 40px;
    height: 22px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-track);
    transition: background var(--motion-fast) var(--ease-out);
  }

  .switch--on .switch-track {
    background: var(--fill-accent);
    /* R5 y1: --fill-accent alone is 1.49:1 on paper (exempt) -- the track's own border is the
       boundary that carries the "on" state at >= 3:1, per WCAG 1.4.11. */
    border-color: var(--border-accent);
  }

  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-primary);
    transition: transform var(--motion-fast) var(--ease-out);
  }

  .switch--on .switch-thumb {
    transform: translateX(18px);
    background: var(--text-on-accent);
  }

  /* P round deliverable 1: "quiet" ON reuses `--border-control` (already this component's own OFF
     track BORDER, tokens.css) rather than `--fill-accent` -- distinct enough from the plain OFF
     `--fill-track` fill to read as "on" in both themes, without every row glowing the same accent
     gold as a real selected/active control (the new Raster cells | Program Areas toggle). */
  .switch--quiet.switch--on .switch-track {
    background: var(--border-control);
    border-color: var(--border-control);
  }

  /* UI-10 fix (round 3, Opus 5.5 eyes-on review): "quiet" ON read as lavender on navy and
     olive-brown on paper -- neither is the gold 'selected' colour every other on-state uses, so
     ON did not read the SAME between themes. Decision (this round): keep the TRACK neutral --
     that is the whole point of "quiet" (P round deliverable 1, above: avoid 8 rows glowing gold
     at once) -- but give the THUMB `--fill-accent`, so there is still one consistent gold cue for
     "on" in both themes, just a small dot rather than the whole track. */
  .switch--quiet.switch--on .switch-thumb {
    background: var(--fill-accent);
  }

  /* SC 1.4.1/1.4.11: forced-colors mode strips the track/thumb backgrounds to nothing distinct,
     erasing on vs off; system colors (the same Highlight/HighlightText pair the OS uses for a
     selected control) restore that distinction without overriding the user's chosen palette. */
  @media (forced-colors: active) {
    .switch-track {
      background: ButtonFace;
      border-color: ButtonText;
    }
    .switch--on .switch-track {
      background: Highlight;
      border-color: Highlight;
    }
    .switch-thumb {
      background: ButtonText;
    }
    .switch--on .switch-thumb {
      background: HighlightText;
    }
  }
</style>
