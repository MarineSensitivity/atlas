<script lang="ts">
  // atlas-3 step 3: the hydrated shell. Reads and writes view state ONLY through src/lib/state
  // (createSelStore -> history.replaceState, never pushState -- CLAUDE.md "URL-is-the-view"; see
  // tests/shell/shell-invariants.test.ts's source-scan guard, the same technique
  // tests/state/invariants.test.ts already uses for sel.svelte.ts). No data and no lens logic
  // beyond the lens switch itself (atlas-4/5 own that): every rail tool's panel body is a one-line
  // placeholder. atlas-map added the MAP -- basemap by theme plus the release's zone outlines,
  // composed through src/lib/map and nothing more; the panels, legend and choropleth are the
  // lenses' own composeStyle inputs (docs/map.md).
  //
  // This file owns NO scoped CSS for the shell's own layout/topbar chrome -- it imports shell.css
  // as a plain global stylesheet (the SAME file index.html's inline critical CSS `@import`s), so
  // there is exactly one source for every geometry value the CLS gate depends on. The real
  // src/lib/ui/* components below (Rail, Panel, Sheet, Segmented, About, VersionBadge, Announcer)
  // bring their own scoped styles and are used only by import, per this step's instructions.
  import { onMount } from "svelte";
  import "./shell.css";
  import { buildRailItems, TOOL_BODY, TOOL_LABEL, type ToolName } from "./tools";
  // a plain `src="../lib/brand/vendor/mst-mark.svg"` in the template below would resolve against
  // the PAGE's URL at runtime (index.html, mounted at site root), not this file's location, and a
  // production build would ship it unrewritten -- a relative-base violation (CLAUDE.md) that also
  // 404s, since dist/ never contains src/. Importing it as a `?url` asset routes it through Vite's
  // normal pipeline (hashed, copied to dist/assets/, and rewritten relative to the page).
  import markNavyUrl from "../lib/brand/vendor/mst-mark.svg?url";
  import markPaperUrl from "../lib/brand/vendor/mst-mark-dark.svg?url";
  import Icon from "../lib/ui/Icon.svelte";
  import Rail from "../lib/ui/Rail.svelte";
  import Panel from "../lib/ui/Panel.svelte";
  import Sheet from "../lib/ui/Sheet.svelte";
  import Segmented from "../lib/ui/Segmented.svelte";
  import About from "../lib/ui/About.svelte";
  import VersionBadge from "../lib/ui/VersionBadge.svelte";
  import Announcer from "../lib/ui/Announcer.svelte";
  import { announce } from "../lib/ui/announcer";
  import { createSelStore } from "../lib/state/sel.svelte";
  import { defaultOut, resolveTheme } from "../lib/state/types";
  import { createMap, type MapHandle } from "../lib/map/map";
  import { composeStyle } from "../lib/map/style";
  import { zoneUnitsFromBoot } from "../lib/map/layers/zones";
  import { studyAreaFromBoot } from "../lib/map/interaction";
  import type { RasterLayerSpec, SelectionSpec, ZoneUnitSpec } from "../lib/map/types";
  import ScoresLens from "../lens/scores/ScoresLens.svelte";
  import VersionPickerModal from "../lens/scores/VersionPickerModal.svelte";
  import WelcomeModal from "../lens/scores/WelcomeModal.svelte";

  const selStore = createSelStore(location);
  const sel = selStore.sel;

  // --- theme: the SAME rule as index.html's pre-paint script, kept live afterward -------------
  let prefersDark = $state<boolean | null>(null);
  onMount(() => {
    let mql: MediaQueryList | undefined;
    try {
      mql = matchMedia("(prefers-color-scheme: dark)");
      prefersDark = mql.matches;
      const onChange = (e: MediaQueryListEvent) => (prefersDark = e.matches);
      mql.addEventListener("change", onChange);
      return () => mql?.removeEventListener("change", onChange);
    } catch {
      prefersDark = null; // resolveTheme treats "unavailable" as navy, same as the pre-paint script
    }
  });
  const resolvedTheme = $derived(resolveTheme(sel.theme, prefersDark));
  $effect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  });
  function toggleTheme() {
    selStore.set({ theme: resolvedTheme === "navy" ? "light" : "dark" });
  }

  // --- phone breakpoint: spec.md §10's ONE matchMedia switch, no separate route or bundle ------
  let isPhone = $state(false);
  onMount(() => {
    const mql = matchMedia("(max-width: 899px)");
    isPhone = mql.matches;
    const onChange = (e: MediaQueryListEvent) => (isPhone = e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  // --- page title tracks the view (spec.md/atlas-3 step 3 deliverable 4) -----------------------
  $effect(() => {
    document.title = `${sel.lens === "species" ? "Species" : "Scores"} · MarineSensitivity Atlas`;
  });

  // --- the tool rail: FIVE controls, the same five, in the same order, on every viewport -------
  // (spec.md §5.1; data + order live in ./tools.ts, unit-tested there). The Flower control fades
  // in place -- never removed -- in the Species lens (spec.md §5.2): "activeTool" is chrome (which
  // panel is open), not URL view state.
  let activeTool = $state<ToolName>("layers");
  const railItems = $derived(buildRailItems(sel.lens === "species"));

  function selectTool(name: string) {
    activeTool = name as ToolName;
  }

  // --- top bar: version chip, lens switch, search, Share / Report / Help / theme ---------------
  function onLensChange(value: string) {
    const lens = value === "species" ? "species" : "scores";
    // `out`'s default is per-lens (state/types.ts's `defaultOut`); there is no outline control
    // yet (atlas-4/5), so an explicit lens switch also resets `out` to the new lens's default --
    // otherwise the PREVIOUS lens's default value lingers and formatSel writes it as if the user
    // had chosen it on purpose (e.g. `out=programarea` surviving a switch to Species, whose own
    // default is "none" -- the seeded case in e2e/shell.url-state.spec.ts).
    selStore.set({ lens, out: defaultOut(lens) });
  }

  async function onShare() {
    try {
      await navigator.clipboard.writeText(location.href);
      announce("Link copied to your clipboard.");
    } catch {
      announce("Couldn't copy the link automatically — copy it from the address bar.");
    }
  }

  function onReport() {
    activeTool = "report";
  }

  function onHelp() {
    announce("Guided tour and full help arrive in a later phase — see About below.");
    document.querySelector<HTMLButtonElement>("#about-region button")?.focus();
  }

  let versionPickerOpen = $state(false);
  function onVersionClick() {
    versionPickerOpen = true;
  }

  // --- the on-map About card's release note (spec.md §9): the seal itself is About.svelte's own
  // concern (gated on VITE_SEAL/VITE_AGENCY, already wired in that component) -- this only reads
  // the resolved version off window.__early, the same global VersionBadge.svelte reads.
  interface Early {
    version: Promise<string | null>;
    boot?: Promise<unknown>;
    // atlas-4: the scores lens' raster/overlay/legend inputs come from `manifest.overlays`
    // (boot.json carries no `overlays` key today) -- read the same global VersionBadge.svelte and
    // index.html's inline script already publish, never a second fetch.
    manifest?: Promise<unknown>;
    // atlas-4 step 3: the release picker (D15) reads the SAME `versions.json` rows and denial
    // record index.html's inline early-fetch script already resolved -- never a second fetch.
    versions?: Promise<EarlyVersionRow[] | null>;
    denied?: Promise<{ ver: string; reason: string } | null>;
  }
  // structurally identical to src/lib/release/access.ts's own `VersionRow` -- NOT imported from
  // it: this file must never import src/lib/release (tests/shell/shell-invariants.test.ts's
  // source-scan guard) since the early-fetch script is the ONE place that logic runs before any
  // bundle parses; the shell only ever reads window.__early's already-resolved values.
  interface EarlyVersionRow {
    ver?: string;
    status?: string;
    access?: string;
    released?: string;
  }
  let earlyVersion = $state<string | null>(null);
  let boot = $state<unknown>(null);
  let manifest = $state<unknown>(null);
  let versions = $state<EarlyVersionRow[] | null>(null);
  let denied = $state<{ ver: string; reason: string } | null>(null);
  onMount(() => {
    const early = (window as unknown as { __early?: Early }).__early;
    early?.version.then((v) => (earlyVersion = v)).catch(() => {});
    // boot.json is the map's only data source at this step (Tier 0, plan D3): the zone units and
    // their PMTiles archives. A missing/404 boot (no release has published app/boot.json until
    // atlas-1) leaves `boot` null and the map paints basemap-only -- never an error.
    early?.boot?.then((b) => (boot = b)).catch(() => {});
    early?.manifest?.then((m) => (manifest = m)).catch(() => {});
    early?.versions?.then((v) => (versions = v)).catch(() => {});
    // a denied version (e.g. the public host + ?ver=v9) auto-opens the picker so the "why" is
    // visible without a click -- D15's e2e gate: "shows the notice", not "shows it once asked".
    early?.denied
      ?.then((d) => {
        denied = d;
        if (d) versionPickerOpen = true;
      })
      .catch(() => {});
  });

  // --- the map (atlas-map): mounted under the panels, one MapLibre instance ---------------------
  // This component NEVER touches MapLibre directly and never calls addLayer/setStyle: it computes
  // composeStyle() inputs and hands the result to the handle (docs/map.md). Every lens does the
  // same.
  let mapEl = $state<HTMLDivElement | undefined>(undefined);
  let mapHandle = $state<MapHandle | undefined>(undefined);

  // outline-only, on purpose: labels, choropleth fills and the score raster are the LENS's
  // composeStyle inputs (atlas-4/5), not the shell's. `src/lib/map/layers/zones.ts` already builds
  // all three -- see docs/map.md.
  const zoneUnits = $derived<ZoneUnitSpec[]>(zoneUnitsFromBoot(boot));

  // atlas-4: the ACTIVE lens' own composeStyle contribution (raster, overlays, zone fills/
  // highlights, selection). A lens computes it and hands it back through this one bucket -- the
  // shell still owns the ONE `applyStyle` call (below), so a lens never touches MapLibre itself
  // (docs/map.md). `zones` here REPLACES the shell's outline-only `zoneUnits` when a lens supplies
  // its own (choropleth fills/highlights included); `undefined` on any field falls back to "the
  // shell's own base view" so a lens that has not loaded yet (or a species view, which does not
  // use this bucket the same way) never blanks the map.
  let lensMapExtra = $state<{
    zones?: ZoneUnitSpec[];
    raster?: RasterLayerSpec | null;
    overlays?: RasterLayerSpec[];
    selection?: SelectionSpec | null;
  }>({});

  onMount(() => {
    if (!mapEl) return;
    const handle = createMap(mapEl, {
      theme: resolveTheme(sel.theme, prefersDark),
      camera: sel.map,
      area: studyAreaFromBoot(null, sel.area),
      projection: sel.proj,
      // URL-is-the-view: the camera goes back through selStore, i.e. history.replaceState, and
      // only for user-driven moves (src/lib/map/camera.ts).
      onCamera: (map) => selStore.set({ map }),
    });
    mapHandle = handle;
    // the map's public test/automation seam (docs/map.md): the handle plus the CURRENT composeStyle
    // inputs, so e2e/map.spec.ts and scripts/verify.mjs can drive the real map the way a lens will
    // -- compose a style, apply it -- instead of reaching into MapLibre. It exposes nothing a
    // viewer could not already read off the page.
    (window as unknown as { __atlasMap?: unknown }).__atlasMap = {
      handle,
      composeStyle,
      inputs: () => ({
        theme: resolvedTheme,
        projection: sel.proj,
        zones: lensMapExtra.zones ?? zoneUnits,
        raster: lensMapExtra.raster ?? null,
        overlays: lensMapExtra.overlays ?? [],
        selection: lensMapExtra.selection ?? null,
      }),
    };
    // no window `resize` listener here: createMap observes the CONTAINER, which also covers a
    // layout-driven resize (a panel opening, the phone sheet changing detent) that no window event
    // reports.
    return () => {
      delete (window as unknown as { __atlasMap?: unknown }).__atlasMap;
      handle.destroy();
      mapHandle = undefined;
    };
  });

  // one composed style, re-applied with setStyle(diff:true) whenever theme, projection, the
  // release's zone units OR the active lens' own contribution changes -- never addLayer()
  // piecemeal (CLAUDE.md).
  $effect(() => {
    mapHandle?.applyStyle(
      composeStyle({
        theme: resolvedTheme,
        projection: sel.proj,
        zones: lensMapExtra.zones ?? zoneUnits,
        raster: lensMapExtra.raster ?? null,
        overlays: lensMapExtra.overlays ?? [],
        selection: lensMapExtra.selection ?? null,
      }),
    );
  });
  const releaseNote = $derived(
    `Marine Sensitivity Atlas · release ${earlyVersion ?? "—"} · scores and species from the ` +
      `published marine-atlas release. Basemap © OpenStreetMap contributors.`,
  );
</script>

<header class="topbar" data-tour="topbar">
  <span data-tour="brand" style="display:flex;align-items:center;gap:var(--space-2)">
    <img class="mark mark--navy" src={markNavyUrl} alt="" />
    <img class="mark mark--paper" src={markPaperUrl} alt="" />
    <h1 class="brand-title" id="app-title">Marine Sensitivity Atlas</h1>
  </span>

  <button
    type="button"
    class="chip"
    data-tour="version-chip"
    data-control="version-chip"
    aria-haspopup="dialog"
    onclick={onVersionClick}
  >
    <Icon name="version" size={14} />
    <VersionBadge />
    <span class="visually-hidden">Change release version</span>
  </button>

  <div data-tour="lens-switch" data-control="lens-switch">
    <Segmented
      options={[
        { value: "scores", label: "Scores" },
        { value: "species", label: "Species" },
      ]}
      value={sel.lens}
      ariaLabel="Lens"
      onchange={onLensChange}
    />
  </div>

  <label class="search-field topbar-desktop-only" data-tour="search" data-control="search">
    <Icon name="search" size={16} />
    <input
      type="search"
      aria-label="Search species and places"
      placeholder="Search species and places"
    />
  </label>

  <span class="spacer"></span>

  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="share"
    data-control="share"
    onclick={onShare}
  >
    <Icon name="share" size={18} />Share
  </button>
  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="report-top"
    data-control="report-top"
    onclick={onReport}
  >
    <Icon name="report" size={18} />Report
  </button>
  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="help"
    data-control="help"
    aria-label="Help, guided tour and About"
    onclick={onHelp}
  >
    <Icon name="help" size={18} />
  </button>
  <button
    type="button"
    class="tool"
    data-tour="theme"
    data-control="theme"
    aria-label={resolvedTheme === "navy" ? "Switch to the paper theme" : "Switch to the navy theme"}
    onclick={toggleTheme}
  >
    <Icon name="theme" size={18} />
  </button>
</header>

<main class="stage" id="stage">
  <div
    bind:this={mapEl}
    id="map"
    class="map"
    role="img"
    aria-label="Map of U.S. marine areas"
    data-tour="map"
  ></div>

  <nav class="rail-region" id="rail-region" aria-label="Tools" data-tour="rail" data-control="rail">
    <Rail
      items={railItems}
      active={activeTool}
      orientation={isPhone ? "horizontal" : "vertical"}
      onSelect={selectTool}
      onAnnounce={announce}
    />
  </nav>

  <div class="panel-region" id="panel-region" data-tour="panel" data-control="panel">
    {#snippet panelBody()}
      {#if sel.lens === "scores"}
        <ScoresLens
          {sel}
          {selStore}
          {boot}
          {manifest}
          ver={earlyVersion}
          {mapHandle}
          {activeTool}
          fallbackBody={TOOL_BODY[activeTool]}
          bind:mapExtra={lensMapExtra}
        />
      {:else}
        <p>{TOOL_BODY[activeTool]}</p>
      {/if}
    {/snippet}
    {#if isPhone}
      <Sheet id="shell" title={TOOL_LABEL[activeTool]}>
        {@render panelBody()}
      </Sheet>
    {:else}
      <Panel id="shell" title={TOOL_LABEL[activeTool]}>
        {@render panelBody()}
      </Panel>
    {/if}
  </div>

  <div class="about-region" id="about-region" data-tour="about" data-control="about">
    <About {releaseNote} />
  </div>
</main>

<!-- spec.md §11: the shell's ONE polite live region (SC 4.1.3) -- every component (Rail's
     onAnnounce below, this file's own onShare/onHelp/onVersionClick) calls the shared
     `announce()` from src/lib/ui/announcer.ts; nothing else in the shell renders a region of
     its own. -->
<Announcer />

<!-- atlas-4 step 3: app-wide chrome, not gated on `sel.lens` -- the release picker and the
     welcome modal apply to either lens, exactly as the ported app's own modals did. -->
<VersionPickerModal
  open={versionPickerOpen}
  onclose={() => (versionPickerOpen = false)}
  {versions}
  {denied}
  currentVer={earlyVersion}
  loc={{ search: location.search, hash: location.hash }}
/>
<WelcomeModal tour={sel.tour} />
