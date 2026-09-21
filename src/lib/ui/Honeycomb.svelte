<script lang="ts">
  // atlas-3 spec.md "Motion": the loader is seven hexagons pulsing in sequence; under
  // prefers-reduced-motion it is a static honeycomb (the keyframe animation is disabled by a
  // local @media query -- tokens.css's --motion-* collapse is for control transitions, not a
  // multi-second looping animation). The status text is always present (aria-live, and visible),
  // so a screen reader and a reduced-motion viewer both get the same information a sighted,
  // motion-tolerant viewer gets from the pulse.
  interface Props {
    label?: string;
  }

  let { label = "Loading…" }: Props = $props();
  const cells = [0, 1, 2, 3, 4, 5, 6];
</script>

<div class="honeycomb" role="status" aria-live="polite">
  <div class="hc-grid" aria-hidden="true">
    {#each cells as i (i)}
      <span class="hc-cell" style="animation-delay: {i * 120}ms"></span>
    {/each}
  </div>
  <span class="hc-label">{label}</span>
</div>

<style>
  .honeycomb {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .hc-grid {
    display: grid;
    grid-template-columns: repeat(4, 14px);
    grid-template-rows: repeat(3, 14px);
    gap: 3px;
  }

  .hc-cell {
    width: 14px;
    height: 14px;
    background: var(--motif-color);
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    animation: hc-pulse 1.2s ease-in-out infinite;
  }

  /* offset alternate rows so the cells actually tile like a honeycomb, not a plain grid */
  .hc-cell:nth-child(4n + 2),
  .hc-cell:nth-child(4n + 3) {
    margin-top: 7px;
  }

  @keyframes hc-pulse {
    0%,
    100% {
      opacity: 0.25;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hc-cell {
      animation: none;
      opacity: 0.7;
    }
  }

  .hc-label {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
</style>
