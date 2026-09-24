<script lang="ts">
  // §7.2's layer bar: green (merged) / orange (input), one pill per input in dataset.sort_order,
  // a struck-through DISABLED pill (a <span>, never a <button> — spec.md's own content rule for
  // this state) for an input with no published surface, and the representation toggle.
  //
  // The struck-through pill is deliberately NOT `src/lib/ui/Pill.svelte`'s disabled variant: that
  // component keeps a real, focusable <button> (aria-disabled only), but the atlas-5 gate requires
  // "not focusable-as-button" — a plain <span title="..."> satisfies that and the native `title`
  // tooltip at once, with no extra wiring.
  import type { LayerBar, LayerPill, RepresentationOption } from "./data/layerBar";
  import type { Representation } from "../../lib/state/types";

  interface Props {
    bar: LayerBar;
    rep: Representation;
    onSelectLayer: (key: string) => void;
    onSetRepresentation: (rep: Representation) => void;
  }

  let { bar, rep, onSelectLayer, onSetRepresentation }: Props = $props();
  let expanded = $state(false);

  function pillClick(p: LayerPill) {
    if (!p.hasSurface) return; // struck-through pills are spans; this is defensive only
    onSelectLayer(p.key);
  }

  function repOption(opt: RepresentationOption) {
    onSetRepresentation(opt.value);
  }
</script>

<div
  class="layer-bar"
  class:is-merged={bar.variant === "merged"}
  class:is-input={bar.variant === "input"}
  class:expanded
  data-testid="layer-bar"
>
  <div class="layer-bar-head">
    <span class="layer-mark" aria-hidden="true">{bar.variant === "merged" ? "✓" : "▶"}</span>
    <span class="layer-title">{bar.title}</span>
    {#if bar.showMergedLink}
      <button type="button" class="merged-link" onclick={() => onSelectLayer("merged")}>
        show Merged Model
      </button>
    {/if}
    <button
      type="button"
      class="layer-toggle"
      aria-expanded={expanded}
      aria-controls="layer-pills"
      onclick={() => (expanded = !expanded)}
    >
      {bar.mobileToggleLabel}
      <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
    </button>
  </div>

  <div class="layer-links" id="layer-pills">
    {#each bar.pills as p (p.key)}
      {#if p.hasSurface}
        <button
          type="button"
          class="layer-pill"
          class:active={p.active}
          data-testid="layer-pill"
          data-key={p.key}
          onclick={() => pillClick(p)}
        >
          {p.label}
        </button>
      {:else}
        <span
          class="layer-pill unavailable"
          data-testid="layer-pill"
          data-key={p.key}
          title={p.tooltip ?? undefined}
        >
          {p.label}
        </span>
      {/if}
    {/each}
  </div>

  {#if bar.representation.available}
    <div
      class="representation"
      role="group"
      aria-label="Representation"
      data-testid="representation"
    >
      {#each bar.representation.options as opt (opt.value)}
        <button
          type="button"
          class="rep-pill"
          class:active={rep === opt.value}
          title={opt.tooltip}
          onclick={() => repOption(opt)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .layer-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    border-left: 4px solid var(--border-control);
  }

  /* is-merged / is-input carry the SEMANTIC state (§7.2) for tests and for anyone skinning this
     later; the visual distinction itself is the ✓/▶ mark plus the accent fill on the active pill,
     using tokens already governed by the contrast contract — never a new, unclassified hex color
     (spec.md §2: "brand colors are chrome"; tests/raster/ramps.wiring.test.ts also forbids a bare
     hex literal anywhere under src/lens/**). */
  .layer-bar.is-merged {
    border-left-color: var(--border-accent);
  }

  .layer-bar.is-input {
    border-left-color: var(--text-secondary);
  }

  .layer-bar-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .layer-mark {
    color: var(--text-secondary);
  }

  .layer-bar.is-merged .layer-mark {
    color: var(--fill-accent);
  }

  .layer-title {
    font-weight: 700;
  }

  .merged-link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
  }

  .layer-toggle {
    display: none;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    margin-left: auto;
  }

  .layer-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .layer-pill {
    display: inline-flex;
    align-items: center;
    height: 26px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .layer-pill.active {
    background: var(--fill-accent);
    border-color: var(--border-accent);
    color: var(--text-on-accent);
    font-weight: 700;
  }

  .layer-pill.unavailable {
    cursor: not-allowed;
    opacity: 0.5;
    text-decoration: line-through;
    border-style: dashed;
    background: transparent;
  }

  .representation {
    display: flex;
    gap: var(--space-2);
  }

  .rep-pill {
    height: 24px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .rep-pill.active {
    background: var(--fill-control);
    font-weight: 700;
  }

  @media (max-width: 575.98px) {
    .layer-toggle {
      display: inline-flex;
    }
    .layer-bar:not(.expanded) .layer-links {
      display: none;
    }
  }
</style>
