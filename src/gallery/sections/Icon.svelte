<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import { ICON_PATHS, type IconName } from "../../lib/ui/icon-paths";

  const names = Object.keys(ICON_PATHS).sort() as IconName[];
</script>

<ul class="icon-grid">
  {#each names as name (name)}
    <li class="icon-cell">
      <Icon {name} size={28} />
      <span class="icon-name">{name}</span>
    </li>
  {/each}
</ul>

<p class="icon-note">
  Every path above comes from <code>src/lib/ui/icon-paths.ts</code>, generated from
  <code>@mdi/js</code> by export name (or, for <code>flower</code>, read from
  <code>src/lib/brand/glyphs/flower.svg</code>) -- see docs/design/spec.md §6. None is typed by
  hand.
</p>

<style>
  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    width: 100%;
  }

  .icon-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
  }

  .icon-name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    text-align: center;
    word-break: break-word;
  }

  .icon-note {
    width: 100%;
    margin-top: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .icon-note code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
