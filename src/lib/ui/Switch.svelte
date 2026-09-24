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
    onchange?: (checked: boolean) => void;
  }

  let { label, checked, disabled = false, onchange }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="switch"
  class:switch--on={checked}
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
    border-color: var(--fill-accent);
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
