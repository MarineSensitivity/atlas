<script lang="ts">
  // atlas-3 step 2, Deliverable 3: one file per section under src/gallery/sections/, discovered
  // here with import.meta.glob -- a later agent adding a component's gallery section never edits
  // this file. Sections are sorted by name so the page (and its Playwright screenshot baseline)
  // is deterministic regardless of filesystem read order.
  import type { Component } from "svelte";

  const modules = import.meta.glob<{ default: Component }>("./sections/*.svelte", {
    eager: true,
  });

  const sections = Object.entries(modules)
    .map(([path, mod]) => ({
      name: path.replace("./sections/", "").replace(".svelte", ""),
      Section: mod.default,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  function slug(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  }

  function toggleTheme() {
    const root = document.documentElement;
    const next = root.dataset.theme === "paper" ? "navy" : "paper";
    root.dataset.theme = next;
    try {
      localStorage.setItem("atlas.gallery-theme", next);
    } catch {
      // private mode / storage disabled: the toggle still works for this page view
    }
  }
</script>

<div class="gallery">
  <a class="skip-link" href="#gallery-main">Skip to sections</a>
  <header class="gallery-head">
    <h1>Atlas component gallery</h1>
    <p class="gallery-sub">
      atlas-3 step 2 &middot; every component, every state, both themes &middot; the Playwright
      screenshot baseline
    </p>
    <button type="button" class="btn" onclick={toggleTheme}>Toggle theme</button>
  </header>
  <nav class="gallery-nav" aria-label="Component sections">
    <ul>
      {#each sections as s (s.name)}
        <li><a href="#{slug(s.name)}">{s.name}</a></li>
      {/each}
    </ul>
  </nav>
  <main class="gallery-body" id="gallery-main">
    {#each sections as s (s.name)}
      <section class="gallery-section" id={slug(s.name)} aria-labelledby="{slug(s.name)}-title">
        <h2 id="{slug(s.name)}-title">{s.name}</h2>
        <div class="gallery-stage">
          <s.Section />
        </div>
      </section>
    {/each}
  </main>
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
  }

  :global(body) {
    background: var(--surface-map);
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: var(--text-md);
    line-height: var(--leading-normal);
  }

  .skip-link {
    position: absolute;
    left: var(--space-2);
    top: calc(var(--space-2) * -6);
    z-index: 40;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .skip-link:focus {
    top: var(--space-2);
  }

  .gallery {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto 1fr;
    min-height: 100vh;
  }

  @media (min-width: 900px) {
    .gallery {
      grid-template-columns: 220px 1fr;
      grid-template-rows: auto 1fr;
      grid-template-areas: "head head" "nav main";
    }
    .gallery-head {
      grid-area: head;
    }
    .gallery-nav {
      grid-area: nav;
    }
    .gallery-body {
      grid-area: main;
    }
  }

  .gallery-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--divider);
  }

  .gallery-head h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-display);
    margin: 0;
  }

  .gallery-sub {
    flex: 1 1 100%;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .gallery-nav {
    padding: var(--space-3);
    border-bottom: 1px solid var(--divider);
  }
  @media (min-width: 900px) {
    .gallery-nav {
      border-bottom: 0;
      border-right: 1px solid var(--divider);
      overflow-y: auto;
    }
  }

  .gallery-nav ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  @media (min-width: 900px) {
    .gallery-nav ul {
      flex-direction: column;
    }
  }

  .gallery-nav a {
    display: block;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-control);
    color: var(--text-link);
    font-size: var(--text-sm);
    text-decoration: underline;
  }
  .gallery-nav a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .gallery-body {
    padding: var(--space-4);
    overflow-y: auto;
  }

  .gallery-section {
    margin-bottom: var(--space-6);
    padding-bottom: var(--space-5);
    border-bottom: 1px solid var(--divider);
  }
  .gallery-section:last-child {
    border-bottom: 0;
  }

  .gallery-section h2 {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-display);
    margin: 0 0 var(--space-3);
  }

  .gallery-stage {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4);
  }
</style>
