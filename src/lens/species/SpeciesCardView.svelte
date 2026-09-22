<script lang="ts">
  // §7.3's sidebar card: facts, the Values tree (bold = the layer on screen; a no-surface input is
  // plain text, never a link), the Mask section, plus atlas-5's own additions: Share (copy link)
  // and "Download this layer" (the public COG/PMTiles URL — every asset is already public S3/CDN).
  import Icon from "../../lib/ui/Icon.svelte";
  import { announce } from "../../lib/ui/announcer";
  import type { SpeciesCard, ValueNode } from "./data/card";
  import type { TaxonAsset } from "./data/shards";

  interface Props {
    info: SpeciesCard;
    /** the asset actually on screen — Download needs its URL; Share just copies `location.href`. */
    asset: TaxonAsset | null;
    onSelect: (key: string) => void;
  }

  let { info, asset, onSelect }: Props = $props();

  async function share() {
    try {
      await navigator.clipboard.writeText(location.href);
      announce("Link copied to your clipboard.");
    } catch {
      announce("Couldn't copy the link automatically — copy it from the address bar.");
    }
  }

  function download() {
    if (!asset) return;
    const a = document.createElement("a");
    a.href = asset.url;
    a.rel = "noopener";
    a.target = "_blank";
    a.click();
  }
</script>

{#snippet valueList(nodes: ValueNode[])}
  <ul>
    {#each nodes as node (node.key)}
      <li>
        {#if node.hasSurface}
          <button
            type="button"
            class="value-link"
            class:active={node.active}
            onclick={() => onSelect(node.key)}
          >
            {node.label}
          </button>
        {:else}
          <span class="value-plain">{node.label}</span>
          <em class="muted">(no published surface)</em>
        {/if}
        {#if node.required}<em class="muted"> (required)</em>{/if}
        {#if node.info}<br /><em class="value-info">({node.info})</em>{/if}
        {#if node.children}
          <br /><em class="muted">(maximum of):</em>
          {@render valueList(node.children)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="species-card" data-testid="species-card">
  <h3>{info.sci}</h3>
  {#if info.noSurfaceNotice}
    <p class="notice" role="status">{info.noSurfaceNotice}</p>
  {/if}
  <ul class="facts">
    {#each info.facts as f (f.label)}
      <li>
        {f.label}:
        {#if f.href}
          <a href={f.href} target="_blank" rel="noopener">{f.value}</a>
        {:else}
          {f.value}
        {/if}
      </li>
    {/each}
  </ul>

  <p class="section-title">Values</p>
  {@render valueList(info.values)}

  {#if info.mask}
    <p class="section-title">Mask <em class="muted">(to constrain extent)</em></p>
    {@render valueList(info.mask)}
  {/if}

  <div class="card-actions">
    <button type="button" onclick={share}>
      <Icon name="share" size={16} />Share
    </button>
    <button type="button" onclick={download} disabled={!asset}>
      <Icon name="download" size={16} />Download this layer
    </button>
  </div>
</div>

<style>
  .species-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .species-card h3 {
    font-style: italic;
    margin: 0;
  }

  .notice {
    color: var(--text-secondary);
  }

  .facts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .section-title {
    font-weight: 700;
    margin: var(--space-2) 0 0;
  }

  .muted {
    color: var(--text-secondary);
  }

  .value-info {
    color: var(--text-secondary);
  }

  .value-link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-link);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }

  .value-link.active {
    font-weight: 700;
    color: var(--text-primary);
    text-decoration: none;
  }

  .value-plain {
    color: var(--text-secondary);
  }

  ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  .card-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .card-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .card-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .card-actions button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
