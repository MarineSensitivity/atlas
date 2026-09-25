<script lang="ts">
  // R3-W2: the reusable dropdown -- shows both a left-aligned and a right-aligned instance (the
  // Download menu, this round's own caller, sits at the top bar's right end), plus a disabled item
  // with a hint (the GeoTIFF item's own "no COG published" state).
  import Icon from "../../lib/ui/Icon.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import type { MenuItem } from "../../lib/ui/menuItem";

  let lastSelected = $state("(none yet)");

  const items: MenuItem[] = [
    {
      id: "png",
      label: "Map view · PNG",
      hint: "raster, with legend + footer",
      icon: "image",
      onSelect: () => (lastSelected = "Map view · PNG"),
    },
    {
      id: "svg",
      label: "Map view · SVG",
      hint: "raster map in an SVG wrapper",
      icon: "vectorFile",
      onSelect: () => (lastSelected = "Map view · SVG"),
    },
    {
      id: "cog",
      label: "Data layer · GeoTIFF",
      hint: "no COG published for this view",
      icon: "geoRaster",
      disabled: true,
    },
    {
      id: "geojson",
      label: "Selected places · GeoJSON",
      icon: "geoVector",
      onSelect: () => (lastSelected = "Selected places · GeoJSON"),
    },
    {
      id: "docs",
      label: "Docs",
      icon: "help",
      href: "https://marinesensitivity.org/docs/",
    },
  ];
</script>

<div class="stage">
  <div class="row">
    <Menu label="Download" align="left" {items}>
      {#snippet trigger()}
        <Icon name="download" size={18} />
      {/snippet}
    </Menu>
    <Menu label="Download (right-aligned)" align="right" {items}>
      {#snippet trigger()}
        <Icon name="download" size={18} />
      {/snippet}
    </Menu>
  </div>
  <p class="muted">last selected: {lastSelected}</p>
  <p class="muted">
    <code>role="menu"</code>/<code>role="menuitem"</code>, roving Up/Down + Home/End, Esc and
    outside-click close with focus returned to the trigger. An `href` item opens in a new tab
    (Docs); a disabled item (GeoTIFF here) shows its reason as a hint and is skipped by the
    initial-focus query.
  </p>
</div>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .row {
    display: flex;
    gap: var(--space-6);
  }

  .row :global(.menu-wrap) {
    display: inline-flex;
  }

  .row :global(button[aria-haspopup="menu"]) {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    cursor: pointer;
  }

  .muted {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    max-width: 480px;
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
