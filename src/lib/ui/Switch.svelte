<script lang="ts">
  // atlas-3: a generic on/off control, role="switch" (WAI-ARIA switch pattern), Space/Enter
  // toggles via the native <button> activation behavior -- no extra keydown handling needed.
  interface Props {
    label: string;
    checked: boolean;
    onchange?: (checked: boolean) => void;
  }

  let { label, checked, onchange }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="switch"
  class:switch--on={checked}
  onclick={() => onchange?.(!checked)}
>
  <span class="switch-track">
    <span class="switch-thumb"></span>
  </span>
</button>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
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
</style>
