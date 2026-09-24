<script lang="ts">
  // atlas-3 spec.md "Motion": the loader is seven hexagons pulsing in sequence; under
  // prefers-reduced-motion it is a static honeycomb (the keyframe animation is disabled by a
  // local @media query -- tokens.css's --motion-* collapse is for control transitions, not a
  // multi-second looping animation). The status text is always visible, so a reduced-motion
  // viewer gets the same information a motion-tolerant one gets from the pulse.
  //
  // atlas-3 step 4 fix round 1 (SC 4.1.3): renders no live region of its own -- announces once,
  // through the ONE shared region (src/lib/ui/announcer.ts), when it first mounts. (A fuller
  // aria-busy pattern on whatever container this loader appears inside is left for atlas-8.)
  //
  // U1 fix round (CI run 35956406448): a PERSISTENT, app-level loader (Shell.svelte's first-view
  // map loader, the only OTHER caller besides the gallery demo below) outlives a single mount --
  // its "Map ready" (on hide, announced separately by the caller) can fire at any later,
  // unpredictable moment (whenever the map's own "idle" settles) and clobber the shared region's
  // text out from under an UNRELATED feature's own announcement made in between (a popup's
  // description, a chunk-load failure) -- three real specs (scores.popup, species-popup,
  // shell.chunk-error) read stale "Map ready" instead of their own text. `announceOnMount=false`
  // opts a caller like that OUT of this shared-region announcement so it can use its own, isolated
  // live region instead (Shell.svelte does); the gallery demo section (a short-lived, one-shot
  // mount with nothing else competing for the shared region) keeps the original default.
  import { onMount } from "svelte";
  import { announce } from "./announcer";

  interface Props {
    label?: string;
    announceOnMount?: boolean;
  }

  let { label = "Loading…", announceOnMount = true }: Props = $props();
  const cells = [0, 1, 2, 3, 4, 5, 6];

  onMount(() => {
    if (announceOnMount) announce(label);
  });
</script>

<div class="honeycomb">
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
