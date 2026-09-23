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
  import { onMount, type Component } from "svelte";
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
  import { formatSel } from "../lib/state/codec";
  import { defaultOut, resolveTheme } from "../lib/state/types";
  import { createMap, type MapHandle } from "../lib/map/map";
  import { composeStyle } from "../lib/map/style";
  import { warmBasemapStyles, type CartoStyleLike } from "../lib/map/layers/basemap";
  import { zoneUnitsFromBoot, zoneUnitsWithOutline } from "../lib/map/layers/zones";
  import { studyAreaFromBoot } from "../lib/map/interaction";
  import { createAnalytics } from "../lib/analytics/analytics";
  // atlas-8 Deliverable 4 (beta feedback, zero backend -- CLAUDE.md/GATES.md's "the CalCOFI
  // zero-backend fallback"): both pure functions take a snapshot the caller builds -- neither ever
  // reads `location`/`window.location` itself (tests/feedback/noHash.test.ts's source-scan gate).
  import {
    feedbackIssueUrl,
    pageUrlFromLocation,
    type FeedbackContext,
  } from "../lib/feedback/issueUrl";
  import { postFeedback } from "../lib/feedback/postFeedback";
  // atlas-5: the species lens. Shell owns WHERE it mounts (the "layers" panel body, the topbar
  // search field, a legend region over the map) and the ONE composeStyle call; the lens owns what
  // to draw (docs/map.md / this file's own header comment). `state.svelte.ts` is the lens' pure
  // DATA/wiring layer (CLAUDE.md: "keep core logic in an exported function... a component calls
  // it") -- it never imports a `.svelte` file itself, so it stays a static import even though every
  // lens PANEL component below is now lazy (see "lazy lens/panel chunks" below).
  import { createSpeciesLens } from "../lens/species/state.svelte";
  // 0.10.21 fix 1 -- type-only (erased at build time, never pulls the scores lens' runtime module
  // into the static bundle): the scores lens' equivalent of `createSpeciesLens` above, EXCEPT the
  // runtime module is loaded dynamically, keyed on `sel.lens === "scores"` (see "lazy lens/panel
  // chunks" below) -- unlike species' `state.svelte.ts`, it pulls in `mapInputs.ts`/`boot.ts`/
  // `raster.ts`/`zoneFill.ts` (`state.svelte.ts`'s own header explains why that weight must stay
  // out of a species-only session's bundle). `tests/shell/lazy-lens-imports.test.ts` asserts this
  // file never imports the RUNTIME module statically.
  import type { ScoresLens as ScoresLensState } from "../lens/scores/state.svelte";
  // atlas-6 step 1: the Places panel mounts here (the shell's one reserved panel slot); it never
  // touches MapLibre directly -- `placesMap` is the reactive bridge this file's own composeStyle
  // effect (below) folds into the ONE `selection` input, per docs/map.md. `placesMap.svelte.ts` is
  // the reactive STORE (plain runes, no `.svelte` component inside it) and stays static for the
  // same reason `state.svelte.ts` does above: `placesSelection` (below) reads it unconditionally,
  // even when the Places PANEL itself (`../places/Places.svelte`, lazy) has never been opened.
  import { createPlacesMapStore } from "../places/placesMap.svelte";
  import type { ResolvedTheme, ZoneUnitSpec } from "../lib/map/types";
  // U6 (round 2): Report -- pure decision logic (report.ts) + the tour's step DATA (tour.ts, no
  // driver.js). Both are small/dependency-free, so both stay ordinary static imports; only the
  // TOUR RUNTIME (tourRuntime.ts, which imports driver.js) is a dynamic import() -- see
  // `beginTour()` below and that file's own header.
  import { recordRecentReport, reportAction } from "./report";
  import { tourStepsForLens, type TourActions } from "./tour";
  import type { Lens } from "../lib/state/types";

  const selStore = createSelStore(location);
  const sel = selStore.sel;

  // a minimal Analytics instance (analytics.ts's own header: the GA4 `<script>` LOADER tag is a
  // later phase's job; `track()` calls made before it lands simply queue into `dataLayer` the way
  // GA4's own snippet already expects — see analytics.ts). `preview` is always false here: the
  // shell does not yet thread a resolved preview session down to a lens (a known gap, not this
  // phase's to close — see this component's own boot section below).
  const analytics = createAnalytics({ appVersion: __APP_VERSION__, preview: false });

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

  // --- the tool rail: FIVE controls, the same five, in the same order, on every viewport -------
  // (spec.md §5.1; data + order live in ./tools.ts, unit-tested there). The Flower control fades
  // in place -- never removed -- in the Species lens (spec.md §5.2): "activeTool" is chrome (which
  // panel is open), not URL view state.
  let activeTool = $state<ToolName>("layers");
  const railItems = $derived(buildRailItems(sel.lens === "species"));

  // fix list #5 (SC 2.4.3), WEBKIT ONLY: activating a rail tool that CHANGES the open tool drops
  // `document.activeElement` to `<body>` roughly 100ms later, once the newly-chosen tool's lazy
  // panel chunk resolves and the panel body swaps -- chromium and firefox never do this. Not
  // traced to one line inside that swap; instead of re-focusing once at a single known instant
  // (too early: the import has not resolved yet), a MutationObserver on `#panel-region` restores
  // focus to the rail button the user actually activated WHENEVER a mutation settles there, for
  // as long as this tool activation is still "pending" -- and only while focus has actually been
  // lost to `<body>` in the meantime, so a user who has since Tabbed into the panel on purpose is
  // never overridden (Panel.svelte's own collapse()/restore() re-establish focus the same way,
  // just for a swap that happens synchronously rather than on an async import's own schedule).
  let panelRegionEl: HTMLDivElement | undefined;
  let railFocusObserver: MutationObserver | undefined;
  let railFocusDeadline = 0;
  // the observer below is created ONCE and lives for the shell's whole lifetime; this is what it
  // reads on every mutation, so a LATER call to armRailFocusRestore (a second tool switch) always
  // retargets the SAME observer rather than being silently ignored by an `if (railFocusObserver)`
  // early-return that would otherwise freeze it on whichever tool was activated first.
  let railFocusTarget: string | null = null;

  function focusRailButton(name: string): void {
    const label = railItems.find((i) => i.name === name)?.label;
    if (!label) return;
    const btn = document.querySelector<HTMLButtonElement>(
      `#rail-region button.hexbtn[aria-label="${CSS.escape(label)}"]`,
    );
    btn?.focus();
  }

  function armRailFocusRestore(name: string): void {
    railFocusTarget = name;
    railFocusDeadline = Date.now() + 1500;
    if (railFocusObserver || !panelRegionEl) return;
    railFocusObserver = new MutationObserver(() => {
      if (!railFocusTarget || Date.now() > railFocusDeadline) return;
      const active = document.activeElement;
      // measured on webkit: giving `#rail-region` its own `tabindex="-1"` (fix list #6) changed
      // WHERE this exact focus loss lands -- instead of falling all the way back to `<body>`, it
      // now settles on the nearest ancestor that IS focusable, `#rail-region` itself (the nav).
      // Both are "focus was lost, not deliberately moved" for this purpose.
      if (active === document.body || active?.id === "rail-region") {
        focusRailButton(railFocusTarget);
      }
    });
    railFocusObserver.observe(panelRegionEl, { childList: true, subtree: true });
  }

  onMount(() => {
    panelRegionEl = (document.getElementById("panel-region") as HTMLDivElement | null) ?? undefined;
    return () => railFocusObserver?.disconnect();
  });

  function selectTool(name: string) {
    activeTool = name as ToolName;
    armRailFocusRestore(name);
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

  // --- Report (U6, round 2, docs/usability.md M1) -------------------------------------------------
  // "Report" does the obvious thing with what is selected NOW: `reportAction()` (report.ts, pure)
  // decides between opening report.html straight away (a place list in `#pl=`, or a zone selected
  // via `sel=zone:…`) and showing the chooser -- the SAME rail panel `selectTool("report")` already
  // opens for every other tool, never a second surface. window.open() runs SYNCHRONOUSLY here (no
  // `await` before it), the same popup-blocker rule Places.svelte/TablePanel.svelte's own "Report"
  // actions already follow.
  function reportStorage(): Storage | null {
    try {
      return window.sessionStorage;
    } catch {
      return null; // private mode / storage disabled -- chrome, not correctness
    }
  }

  function onReport() {
    const action = reportAction(sel, earlyVersion);
    if (action.kind === "open") {
      window.open(action.href, "_blank", "noopener");
      recordRecentReport(reportStorage(), { href: action.href, label: action.label });
    } else {
      selectTool("report");
    }
  }

  // --- Help menu (U6, round 2) ---------------------------------------------------------------------
  // A non-modal disclosure (Popover.svelte's own dismiss-on-outside-click/Esc pattern, inlined here
  // rather than reused verbatim: Popover.svelte renders its OWN small round trigger button, and this
  // menu's trigger is the EXISTING top-bar "Help" button instead of a second, nested one). Tour,
  // keyboard shortcuts and a docs link; "Report a problem" stays bottom-left for now (U3 moves it).
  // Deliberately NOT a <dialog>/Modal.svelte: a modal's top-layer + focus trap would block the rest
  // of the page, and e2e/shell.a11y.spec.ts's interaction walk clicks Help and then every rail tool
  // in the same test -- a blocking modal left open would break that walk for no functional reason
  // (a menu, unlike a welcome/version dialog, is not meant to demand attention).
  let helpOpen = $state(false);
  let helpTriggerEl: HTMLButtonElement | undefined;
  let helpMenuEl: HTMLDivElement | undefined;

  function onHelp() {
    helpOpen = !helpOpen;
    if (helpOpen) analytics.track("open_help", {});
  }

  function closeHelp(returnFocus = true) {
    if (!helpOpen) return;
    helpOpen = false;
    if (returnFocus) helpTriggerEl?.focus();
  }

  function handleHelpDocumentPointerdown(event: PointerEvent) {
    if (!helpOpen) return;
    const target = event.target as Node;
    if (helpMenuEl?.contains(target) || helpTriggerEl?.contains(target)) return;
    helpOpen = false; // dismissed by clicking elsewhere -- focus was already elsewhere
  }

  // LOCAL, not document-level, for the same reason Popover.svelte's identical handler is: the
  // innermost open layer handles Esc first, before it can bubble to an ancestor's own Escape
  // handling (e.g. an enclosing Panel collapsing itself). Attached IMPERATIVELY, not a template
  // `onkeydown` on the (non-interactive) menu `<div>` -- Popover.svelte's own identical fix for
  // the same svelte-check a11y rule (a static element with a keydown handler needs a role a
  // plain disclosure region should not claim).
  function handleHelpKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && helpOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeHelp();
    }
  }

  onMount(() => {
    document.addEventListener("pointerdown", handleHelpDocumentPointerdown);
    const el = helpMenuEl;
    el?.addEventListener("keydown", handleHelpKeydown);
    return () => {
      document.removeEventListener("pointerdown", handleHelpDocumentPointerdown);
      el?.removeEventListener("keydown", handleHelpKeydown);
    };
  });

  function onHelpTakeTour() {
    closeHelp(false);
    void beginTour();
  }

  // --- Tour (U6, round 2) ---------------------------------------------------------------------------
  // The step DATA (tour.ts) is a plain, dependency-free module and stays a static import above; the
  // RUNTIME (tourRuntime.ts, driver.js) is reached ONLY through this dynamic import(), so driver.js
  // never enters the static critical path (scripts/size-budget.mjs's 450 KB budget). `?tour=on`
  // (an EXPLICIT query value, checked directly -- `sel.tour` cannot distinguish that from the
  // default, both parse to "on") starts the tour once on load, same rule WelcomeModal.svelte's own
  // suppression now follows so the two overlays never stack.
  let tourActive = $state(false);

  function buildTourActions(): TourActions {
    let tourSnapshot: { lens: Lens; activeTool: ToolName } | null = null;
    return {
      getLens: () => sel.lens,
      setLens: (lens) => onLensChange(lens),
      selectTool: (name) => selectTool(name),
      snapshot: () => {
        tourSnapshot = { lens: sel.lens, activeTool };
      },
      restore: () => {
        if (!tourSnapshot) return;
        if (sel.lens !== tourSnapshot.lens) onLensChange(tourSnapshot.lens);
        activeTool = tourSnapshot.activeTool;
        tourSnapshot = null;
      },
    };
  }

  async function beginTour() {
    if (tourActive) return;
    tourActive = true;
    const lens = sel.lens;
    const { startTour } = await import("./tourRuntime");
    const steps = tourStepsForLens(lens);
    const actions = buildTourActions();
    analytics.track("tour_start", { lens });
    startTour(steps, actions, {
      onStep: (step, index) => analytics.track("tour_step", { lens, step: step.id, index }),
      onEnd: (completed) => {
        analytics.track("tour_end", { lens, completed });
        tourActive = false;
      },
    });
  }

  onMount(() => {
    let explicitTourOn = false;
    try {
      explicitTourOn = new URLSearchParams(location.search).get("tour") === "on";
    } catch {
      /* location.search unavailable -- treat as absent, never as an error */
    }
    if (!explicitTourOn) return;
    // a beat for the shell's own first paint to settle before the tour overlay appears -- the
    // same reasoning tourRuntime.ts's BEFORE_SETTLE_MS uses between steps, just once, up front.
    const t = setTimeout(() => void beginTour(), 400);
    return () => clearTimeout(t);
  });

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
  // U6 (round 2): the Help menu's Docs link -- the same `https://marinesensitivity.org/docs/{ver}/`
  // shape src/lib/report/model.ts's own `docsHref` already uses, keyed on THIS release.
  const docsHref = $derived(`https://marinesensitivity.org/docs/${earlyVersion ?? "latest"}/`);
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
  // 0.10.21: `selStore` deps the store's own baseline outline-restore effect reads (see
  // placesMap.svelte.ts's header) -- unconditional/eager, same as `createSpeciesLens` above, so a
  // deep-linked selected place's outline restores regardless of which tool is active.
  const placesMap = createPlacesMapStore({ selStore });

  // outline-only, on purpose: labels, choropleth fills and the score raster are the LENS's
  // composeStyle inputs (atlas-4/5), not the shell's. `src/lib/map/layers/zones.ts` already builds
  // all three -- see docs/map.md.
  const zoneUnits = $derived<ZoneUnitSpec[]>(zoneUnitsFromBoot(boot));

  // atlas-5: the species lens' reactive core. A plain call, not a component -- state.svelte.ts's
  // own header explains why (the same "wiring only, rules live in plain modules" split
  // src/lib/state/sel.svelte.ts already documents). `mapHandle`/`boot`/`earlyVersion` are read
  // through getters so the closures below always see the CURRENT value, not the one captured at
  // this call site (all three settle asynchronously, after this line runs).
  const speciesLens = createSpeciesLens({
    selStore,
    ver: () => earlyVersion,
    boot: () => boot,
    mapHandle: () => mapHandle,
    track: (name, params) => analytics.track(name as never, params as never),
  });

  // --- page title: the ONE writer (spec.md/atlas-3 step 3 deliverable 4; atlas-8 fix) -----------
  // Used to be two independent `$effect`s -- this one and species/state.svelte.ts's own -- each
  // with different reactive dependencies (`sel.lens` here, species-card state there), so either
  // could re-fire and stomp the other's title depending on Svelte's own effect-scheduling order.
  // `speciesLens.docTitle` is still computed in state.svelte.ts (it needs that module's card/`in`
  // state); this is the only place anything assigns `document.title`, and
  // tests/shell/documentTitle.test.ts's source scan pins that.
  $effect(() => {
    document.title =
      sel.lens === "species" && speciesLens.docTitle
        ? speciesLens.docTitle
        : `${sel.lens === "species" ? "Species" : "Scores"} · MarineSensitivity Atlas`;
  });

  // 0.10.21 fix 1 -- the scores lens' own composeStyle contribution (raster, overlays, zone
  // fills/highlights, selection, the floating legend), now a lens-level store
  // (`../lens/scores/state.svelte`'s `createScoresLens()`) the shell instantiates whenever
  // `sel.lens === "scores"` -- NOT a `bind:mapExtra` prop `ScoresLens.svelte` (the PANEL body)
  // used to own. `Panel.svelte` renders its children only while `!geometry.collapsed`
  // (`src/lib/ui/Panel.svelte`), so a collapsed desktop panel used to mean `ScoresLens.svelte`
  // never mounted at all -- `mapExtra` stayed `{}` forever and the score raster (and its floating
  // legend) never painted, even though the map itself was fully visible (the owner's live 0.10.17
  // report; `e2e/scores.collapsed-panel.spec.ts` is the regression gate). Rule: map inputs belong
  // to a lens-level store the shell instantiates whenever the lens is selected; the panel renders
  // UI only. `null` before the lazy chunk resolves (see "lazy lens/panel chunks" below) --
  // every read of it below is null-safe and falls back to "the shell's own base view", same as
  // the old `{}` default did.
  let scoresLens = $state<ScoresLensState | null>(null);

  // G-25 fix: `Sel.out`'s ONE effect on the map, applied to whichever `zones` array (the shell's
  // own outline-only `zoneUnits`, or the scores lens' richer `scoresLens.mapExtra.zones`) is about
  // to reach `composeStyle()` below -- see `zoneUnitsWithOutline`'s own header. This is the ONLY
  // place `sel.out` touches the map; BOTH `composeStyle()` call sites (the automation seam and the
  // reactive effect, below) read THIS, never `zoneUnits`/`scoresLens.mapExtra.zones` directly, so
  // the outline choice can never drift between the two. 0.10.21 fix 1: gated EXPLICITLY on
  // `sel.lens === "scores"` -- species must never receive the scores lens' zones (choropleth
  // fills/highlights), which used to be true only incidentally, because `ScoresLens.svelte` was
  // never mounted on a species view in the first place.
  const zonesForStyle = $derived<ZoneUnitSpec[]>(
    zoneUnitsWithOutline(
      sel.lens === "scores" ? (scoresLens?.mapExtra.zones ?? zoneUnits) : zoneUnits,
      sel.out,
    ),
  );

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
    // atlas-5 §6.5: the species click. The shared map's raw click event -- never a second map
    // instance, never a second `on("click")` owner; a non-species lens ignores its own clicks
    // inside `handleMapClick` itself (checks `sel.lens` first).
    const onMapClick = (e: {
      lngLat: { lng: number; lat: number };
      point: { x: number; y: number };
    }) => {
      void speciesLens.handleMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat }, e.point);
    };
    handle.map.on("click", onMapClick);
    // the map's public test/automation seam (docs/map.md): the handle plus the CURRENT composeStyle
    // inputs, so e2e/map.spec.ts and scripts/verify.mjs can drive the real map the way a lens will
    // -- compose a style, apply it -- instead of reaching into MapLibre. It exposes nothing a
    // viewer could not already read off the page.
    (window as unknown as { __atlasMap?: unknown }).__atlasMap = {
      handle,
      composeStyle,
      inputs: () => ({
        theme: resolvedTheme,
        // same field the reactive effect below passes, so `composeStyle(inputs())` reproduces
        // exactly what is on screen -- including whether the basemap has resolved yet (0.10.20).
        basemapStyle: basemapStyles[resolvedTheme],
        projection: sel.proj,
        zones: zonesForStyle,
        raster:
          sel.lens === "scores"
            ? (scoresLens?.mapExtra.raster ?? null)
            : speciesLens.mapInputs.raster,
        range: sel.lens === "species" ? speciesLens.mapInputs.range : null,
        overlays: sel.lens === "scores" ? (scoresLens?.mapExtra.overlays ?? []) : [],
        selection:
          placesSelection ??
          (sel.lens === "scores" ? (scoresLens?.mapExtra.selection ?? null) : null),
      }),
    };
    // the species lens' own test/automation seam, same spirit as __atlasMap just above: it exposes
    // only `selectSpecies`, exactly what clicking a picker option already does through the UI (used
    // by e2e/species.smoke.spec.ts to drive TWO rapid switches before the map's first "idle" --
    // the exact race styleQueue.ts's regression test covers at the unit level).
    (window as unknown as { __atlasSpecies?: unknown }).__atlasSpecies = {
      selectSpecies: (key: string) => speciesLens.selectSpecies(key),
    };
    // no window `resize` listener here: createMap observes the CONTAINER, which also covers a
    // layout-driven resize (a panel opening, the phone sheet changing detent) that no window event
    // reports.
    return () => {
      delete (window as unknown as { __atlasMap?: unknown }).__atlasMap;
      delete (window as unknown as { __atlasSpecies?: unknown }).__atlasSpecies;
      handle.map.off("click", onMapClick);
      handle.destroy();
      mapHandle = undefined;
    };
  });

  // one composed style, re-applied with setStyle(diff:true) whenever theme, projection, the
  // release's zone units, OR (species lens only) the layer on screen changes -- never addLayer()
  // piecemeal (CLAUDE.md). `raster`/`range` are the ONLY species-specific fields this shell ever
  // reads; every rule that produced them lives in the lens (mapInputs.ts), not here.
  // release's zone units, or places' own pick-mode highlight / "show analysis cells" toggle change
  // -- never addLayer() piecemeal (CLAUDE.md). `placesMap.{outline,cells}` are atlas-6's ONLY way
  // to reach the map: composeStyle `selection` inputs (docs/map.md), nothing imperative. Cells (a
  // place's own covered-cell squares) take priority over the pick-mode outline when both exist --
  // Deliverable 2 shows cells only for the place currently being inspected, so nothing else should
  // paint underneath it at the same time.
  const placesSelection = $derived(
    placesMap.cells
      ? { features: placesMap.cells, cellOpacity: true }
      : placesMap.outline
        ? { features: placesMap.outline }
        : null,
  );
  // atlas-map basemap fix: the basemap is CARTO's vector style.json now, fetched once per theme
  // and cached (layers/basemap.ts#loadBasemapStyle). composeStyle() itself stays SYNCHRONOUS -- it
  // takes the already-resolved style as a plain input.
  //
  // 0.10.20: that input is now REACTIVE STATE, and the fetch's own `.then()` writes it. Between
  // 0.10.11 and 0.10.19 nothing here forced a recompose when a fetch resolved; the comment that
  // stood in this spot argued "the effect below already re-runs on the very next unrelated
  // reactive change (zones/raster/selection all change within the first second of any real load)".
  // That is an assumption about a RACE, and under load it loses: when the style.json lands after
  // the last of those changes, the cache is warm and nothing ever reads it again -- the basemap
  // never paints, for the life of the page. Measured on Firefox (1 of 40 repeats of
  // `e2e/scores.firstpaint.spec.ts`'s raster probe at load ~11; deterministic with the style.json
  // answered 3 s late): ocean pixel `247,171,122` -- the score raster over the flat `--surface-map`
  // colour -- with ZERO `basemap-` layers in `getStyle()` ten seconds after the response arrived.
  // See `layers/basemap.ts#warmBasemapStyles`.
  //
  // The reason it was left out is real and is fixed at its own root: an extra `setStyle(diff:true)`
  // landing at a network-timed moment used to expose a MapLibre-level mis-ordering, because
  // `map/styleQueue.ts` only queued while `!map.isStyleLoaded()` and the map's first, source-less
  // `blankStyle()` is trivially "loaded". That queue now holds "at most one `setStyle` in flight"
  // unconditionally; since 0.10.22 a flight ends on the issued style's own "style.load" (not
  // "idle"), and a recompose identical to the last issued style -- the INACTIVE theme reporting
  // in -- is not issued at all, so this costs nothing measurable (see styleQueue.ts's header).
  //
  // BOTH themes are warmed unconditionally, on mount -- not reactively per `resolvedTheme` change.
  // A theme TOGGLE therefore never itself kicks off a fetch: it reads state that is already there.
  // Warming only the active theme (and fetching the other one AT the moment of the toggle instead)
  // measurably broke `e2e/map.spec.ts`'s theme-switch test: a network-driven callback landing
  // inside that critical window occasionally left the canvas's WebGL context unrenderable under
  // heavy parallel load (`getContext()` returning null).
  let basemapStyles = $state<Partial<Record<ResolvedTheme, CartoStyleLike>>>({});
  onMount(() => {
    // `warmBasemapStyles` never rejects and always reports every theme exactly once, so this
    // fire-and-forget call cannot leave `basemapStyles` half-written.
    warmBasemapStyles(["navy", "paper"], (theme, style) => {
      basemapStyles = { ...basemapStyles, [theme]: style };
    });
  });

  $effect(() => {
    const isSpecies = sel.lens === "species";
    // read raster/range as their OWN statements, not inline inside `mapHandle?.`'s optional
    // chain: optional chaining short-circuits BEFORE evaluating a call's arguments, so an
    // `applyStyle` call skipped by a still-null `mapHandle` would never even read
    // `speciesLens.mapInputs` — a defensive belt beside the real fix for this exact symptom,
    // which turned out to be map.ts's `applyStyle` queue (see its own comment: it was waiting on
    // an event that only ever fires once).
    const raster = isSpecies ? speciesLens.mapInputs.raster : null;
    const range = isSpecies ? speciesLens.mapInputs.range : null;
    mapHandle?.applyStyle(
      composeStyle({
        theme: resolvedTheme,
        // the reactive half of the 0.10.20 basemap fix: reading this is what makes the effect
        // re-run (and the basemap actually appear) when the CARTO fetch resolves late.
        basemapStyle: basemapStyles[resolvedTheme],
        projection: sel.proj,
        zones: zonesForStyle,
        raster: sel.lens === "scores" ? (scoresLens?.mapExtra.raster ?? null) : raster,
        range,
        overlays: sel.lens === "scores" ? (scoresLens?.mapExtra.overlays ?? []) : [],
        selection:
          placesSelection ??
          (sel.lens === "scores" ? (scoresLens?.mapExtra.selection ?? null) : null),
      }),
    );
  });
  const releaseNote = $derived(
    `Marine Sensitivity Atlas · release ${earlyVersion ?? "—"} · scores and species from the ` +
      `published marine-atlas release. Basemap © OpenStreetMap contributors.`,
  );

  // --- Deliverable 4: "Report a problem" -> a prefilled GitHub issue, zero backend --------------
  // `viewport` is the one field with no existing reactive source (unlike lens/ver/theme, all read
  // off `sel`/`earlyVersion`/`resolvedTheme` below) -- tracked the same way `isPhone` above is.
  let viewportW = $state(0);
  let viewportH = $state(0);
  onMount(() => {
    function measure() {
      viewportW = window.innerWidth;
      viewportH = window.innerHeight;
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  // the page URL, fragment stripped, query kept: built from `formatSel(sel).search` (the SAME
  // string `selStore`'s own `history.replaceState` call just wrote), never `location.search`
  // directly -- reading it through `sel` is what makes this recompute on every lens/ver/theme
  // change instead of freezing at mount (plan D8's privacy rule: the hash, which carries a drawn
  // place, must never reach this at all -- `pageUrlFromLocation`'s own `PageLocationLike` has no
  // field for it).
  const feedbackCtx = $derived<FeedbackContext>({
    appVersion: __APP_VERSION__,
    appSha: __APP_SHA__,
    ver: earlyVersion,
    lens: sel.lens,
    pageUrl: pageUrlFromLocation({
      origin: location.origin,
      pathname: location.pathname,
      search: formatSel(sel).search,
    }),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    viewport: `${viewportW}x${viewportH}`,
    theme: resolvedTheme,
  });
  const feedbackHref = $derived(feedbackIssueUrl(feedbackCtx));

  // set at build time only (VITE_FEEDBACK_URL); unset -> the control is a plain link to the GitHub
  // issue above and this handler is never attached (see the template below).
  const FEEDBACK_URL = import.meta.env.VITE_FEEDBACK_URL as string | undefined;

  async function onFeedbackClick(e: MouseEvent) {
    if (!FEEDBACK_URL) return; // plain <a>, default navigation to feedbackHref
    e.preventDefault();
    const ok = await postFeedback(FEEDBACK_URL, feedbackCtx, fetch);
    if (ok) {
      announce("Thanks — your feedback was sent.");
    } else {
      // falls back to the SAME GitHub link a plain click would have followed -- never silently
      // swallows feedback because the configured endpoint failed.
      window.open(feedbackHref, "_blank", "noopener");
    }
  }

  // --- lazy lens/panel chunks (atlas-4 fix round 2, D13) ----------------------------------------
  // Shell.svelte used to statically import every lens' panel component (ScoresLens,
  // SpeciesLensPanel/Picker/Legend/NotFoundModal, Places, VersionPickerModal, WelcomeModal) --
  // 450.4 KB gzip static, 0.4 KB over budget, and a species-only deep link downloaded the ENTIRE
  // scores lens it never renders. Each becomes its own dynamic `import()` chunk, chosen by
  // `sel.lens` (Places by `activeTool === "places"` instead -- it mounts on either lens). This is
  // the SAME dynamic-component pattern `TablePanel.svelte`/`Composition.svelte` already use for
  // `Composition.svelte`/`Treemap.svelte` (a `Component<any>` held in `$state`, resolved by a
  // `$effect`, rendered via `{@const Comp = ...}` -- `Component`'s real generic Props type is not
  // importable from a plain module here any more than it is there). While a chunk is still in
  // flight the template falls back to the EXISTING skeleton markup (`TOOL_BODY[activeTool]`'s
  // placeholder text, or simply omitting an overlay/modal that has no visible closed state) so
  // e2e/shell.cls.spec.ts's skeleton/hydrated geometry-equality gate never sees a new box shape.
  // VersionPickerModal/WelcomeModal are app-wide chrome, not gated on `sel.lens` (see the comment
  // by their own markup below) -- they load unconditionally, right after mount, same as
  // `TablePanel.svelte`'s CompositionComponent; that still moves their bytes out of the entry's
  // STATIC import graph (`scripts/size-budget.mjs` only walks `imports`, never `dynamicImports`),
  // it just does not delay when the download starts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ScoresLensComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ScoresLegendComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesLensPanelComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesPickerComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesLegendComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let NotFoundModalComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PlacesComp = $state<Component<any> | null>(null);
  // U6 (round 2): the "report" rail tool's real panel body -- same lazy-on-first-open pattern as
  // PlacesComp above (ReportTool.svelte itself has no heavy deps; this is about keeping every
  // tool's panel out of the static graph equally, not a size concern for this one).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ReportToolComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let VersionPickerModalComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let WelcomeModalComp = $state<Component<any> | null>(null);

  $effect(() => {
    if (sel.lens !== "scores") return;
    if (!ScoresLensComp) {
      import("../lens/scores/ScoresLens.svelte").then((mod) => (ScoresLensComp = mod.default));
    }
    // the floating legend (atlas-4 defect fix) -- its own chunk, same trigger as the panel's, so
    // a scores deep link downloads both together rather than waiting on the panel to mount first.
    if (!ScoresLegendComp) {
      import("../lens/scores/ScoresLegend.svelte").then((mod) => (ScoresLegendComp = mod.default));
    }
    // 0.10.21 fix 1 -- the scores lens' MAP-INPUT store, loaded (and instantiated) the SAME way as
    // the two chunks above, so it exists whenever `sel.lens === "scores"` regardless of whether
    // the panel/sheet has ever mounted `ScoresLensComp` (this is the actual fix; the panel chunk
    // above only owns UI). `boot`/`manifest` are read through getters so the lens always sees the
    // CURRENT value, the same reason `createSpeciesLens`'s own deps are getters (above).
    if (!scoresLens) {
      import("../lens/scores/state.svelte").then((mod) => {
        scoresLens = mod.createScoresLens({
          selStore,
          boot: () => boot,
          manifest: () => manifest,
        });
      });
    }
  });

  // one trigger for the whole species UI group -- all four chunks start downloading together the
  // moment the lens becomes "species" (a deep link included, since `sel` resolves from the URL
  // synchronously before first render), well ahead of `NotFoundModal`'s own `open` ever going
  // true (that only happens after `state.svelte.ts` resolves a deep link over the network -- see
  // its own header comment, "the jigger guard").
  $effect(() => {
    if (sel.lens !== "species") return;
    if (!SpeciesLensPanelComp) {
      import("../lens/species/SpeciesLens.svelte").then(
        (mod) => (SpeciesLensPanelComp = mod.default),
      );
    }
    if (!SpeciesPickerComp) {
      import("../lens/species/SpeciesPicker.svelte").then(
        (mod) => (SpeciesPickerComp = mod.default),
      );
    }
    if (!SpeciesLegendComp) {
      import("../lens/species/SpeciesLegend.svelte").then(
        (mod) => (SpeciesLegendComp = mod.default),
      );
    }
    if (!NotFoundModalComp) {
      import("../lens/species/NotFoundModal.svelte").then(
        (mod) => (NotFoundModalComp = mod.default),
      );
    }
  });

  $effect(() => {
    if (activeTool === "places" && !PlacesComp) {
      import("../places/Places.svelte").then((mod) => (PlacesComp = mod.default));
    }
  });

  $effect(() => {
    if (activeTool === "report" && !ReportToolComp) {
      import("./ReportTool.svelte").then((mod) => (ReportToolComp = mod.default));
    }
  });

  $effect(() => {
    if (!VersionPickerModalComp) {
      import("../lens/scores/VersionPickerModal.svelte").then(
        (mod) => (VersionPickerModalComp = mod.default),
      );
    }
  });

  $effect(() => {
    if (!WelcomeModalComp) {
      import("../lens/scores/WelcomeModal.svelte").then((mod) => (WelcomeModalComp = mod.default));
    }
  });
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
    {#if sel.lens === "species" && SpeciesPickerComp}
      {@const Comp = SpeciesPickerComp}
      <Comp
        index={speciesLens.taxaIndex}
        selected={sel.sp}
        usOnly={sel.us}
        onSelect={(key: string) => speciesLens.selectSpecies(key)}
        onSetUsOnly={(enabled: boolean) => speciesLens.setUsOnly(enabled)}
        onSearchLogged={(query: string) => analytics.track("search_species", { query })}
        onFocusIndex={() => speciesLens.ensureTaxaIndex()}
      />
    {:else}
      <input
        type="search"
        aria-label="Search species and places"
        placeholder="Search species and places"
      />
    {/if}
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
  <!-- U6 (round 2): the (?) Help menu -- tour, keyboard shortcuts, a docs link. Always rendered
       (never {#if helpOpen}), toggled with `hidden`, so `aria-controls` on the trigger names an
       element that actually EXISTS in the DOM (SC 4.1.2) -- Popover.svelte's identical fix. -->
  <span class="help-wrap">
    <button
      type="button"
      class="tool topbar-desktop-only"
      data-tour="help"
      data-control="help"
      aria-expanded={helpOpen}
      aria-controls="help-menu"
      aria-label="Help"
      bind:this={helpTriggerEl}
      onclick={onHelp}
    >
      <Icon name="help" size={18} />
    </button>
    <!-- an ordinary disclosure region (About.svelte's own aria-expanded/aria-controls pattern),
         NOT role="menu" -- a real ARIA menu widget promises arrow-key/Home/End roving focus this
         does not implement, which would be a WORSE a11y contract than none at all. Tab/Shift+Tab
         reaches "Take a tour" then "Docs" in document order, same as any other disclosure. -->
    <div
      class="help-menu"
      id="help-menu"
      aria-label="Help"
      hidden={!helpOpen}
      bind:this={helpMenuEl}
    >
      <button type="button" class="help-menu-item" onclick={onHelpTakeTour}>Take a tour</button>
      <div class="help-shortcuts">
        <h3>Keyboard shortcuts</h3>
        <ul>
          <li>Tab / Shift+Tab — move between controls</li>
          <li>Esc — close the open panel or dialog</li>
          <li>↓ / ↑ / Home / End — move within the tool rail</li>
          <li>= — zoom the map in</li>
        </ul>
      </div>
      <a
        class="help-menu-item"
        href={docsHref}
        target="_blank"
        rel="noopener"
        onclick={() => closeHelp(false)}
      >
        Docs
      </a>
    </div>
  </span>
  <!-- U2a (round 2): sun/moon, CalCOFI's convention (src/App.tsx's `.cc-theme-toggle`) -- the
       icon shown is the DESTINATION theme (a sun while dark invites switching to light, a moon
       while light invites switching to dark), and the accessible name states the action in ONE
       vocabulary (light/dark -- the URL's own words, docs/usability.md p3), never "navy"/"paper"
       (those stay internal token-set names only). mdiBrightness7/mdiBrightness4 are Apache-2.0
       (@mdi/js, already a project dependency -- see LICENSE.md / node_modules/@mdi/js/LICENSE). -->
  <button
    type="button"
    class="tool"
    data-tour="theme"
    data-control="theme"
    aria-label={resolvedTheme === "navy" ? "Switch to light theme" : "Switch to dark theme"}
    onclick={toggleTheme}
  >
    <Icon name={resolvedTheme === "navy" ? "themeSun" : "themeMoon"} size={18} />
  </button>
</header>

<main class="stage" id="stage">
  <div
    bind:this={mapEl}
    id="map"
    class="map"
    role="img"
    aria-label="Map of U.S. marine areas"
    aria-describedby="map-table-equivalent"
    data-tour="map"
  ></div>
  <!-- fix list #9 (SC 1.1.1): the map announces itself as an image and nothing more -- the
       project's declared equivalent (docs/accessibility.md §3.1: "a sighted user reads colour-
       by-value on the map; this table is the SAME ranking as text", ZonesTable.svelte) is four
       keystrokes away behind the Table rail tool, and nothing in the map's own semantics said so.
       This is the pointer; the equivalence itself is proven end to end by
       e2e/keyboard-walk.spec.ts's step 1. -->
  <p id="map-table-equivalent" class="visually-hidden">
    Every zone's score is also in the Zones table, under the Table tool.
  </p>

  <!-- fix list #6 (SC 2.4.1), FIREFOX: `tabindex="-1"` on the skip targets -- without it,
       activating "Skip to the tools" only moved the sequential-focus STARTING POINT to this
       `<nav>`, and Firefox (unlike chromium/webkit) places that point AFTER the target's whole
       subtree, so the next Tab landed on the panel's "Collapse to a pill" and skipped the rail
       entirely. With `tabindex="-1"` the target itself becomes the thing that takes focus, so
       every engine agrees on where the next Tab starts from -- the usual remedy for a skip link
       whose target is not natively focusable. -->
  <nav
    class="rail-region"
    id="rail-region"
    aria-label="Tools"
    tabindex="-1"
    data-tour="rail"
    data-control="rail"
  >
    <Rail
      items={railItems}
      active={activeTool}
      orientation={isPhone ? "horizontal" : "vertical"}
      onSelect={selectTool}
      onAnnounce={announce}
    />
  </nav>

  <!-- fix list #6 (SC 2.4.1): the "Skip to the details panel" link's own target -- same
       `tabindex="-1"` remedy as #rail-region above, for the same reason. -->
  <div class="panel-region" id="panel-region" tabindex="-1" data-tour="panel" data-control="panel">
    <!-- the ONE panel body: places owns its tool on either lens; otherwise the active lens
         decides what the tool's panel shows (the scores lens takes every tool and falls back to
         the tool's own text; the species lens takes "layers" only). -->
    {#snippet panelBody()}
      {#if activeTool === "places"}
        {#if PlacesComp}
          {@const Comp = PlacesComp}
          <Comp {sel} {selStore} {boot} {mapHandle} {zoneUnits} mapStore={placesMap} />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if activeTool === "report"}
        <!-- U6 (round 2): intercepted here, BEFORE the lens branches below, so "Report" is the
             SAME chooser+recent-reports panel on either lens -- ScoresLens.svelte's own fallback
             (`fallbackBody`) never renders for this tool any more (its own header already says
             "places" and "report" belong to other phases). -->
        {#if ReportToolComp}
          {@const Comp = ReportToolComp}
          <Comp {sel} {boot} ver={earlyVersion} onOpenPlaces={() => selectTool("places")} />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if sel.lens === "species" && activeTool === "layers"}
        {#if SpeciesLensPanelComp}
          {@const Comp = SpeciesLensPanelComp}
          <Comp lens={speciesLens} rep={sel.rep} />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if sel.lens === "scores"}
        {#if ScoresLensComp && scoresLens}
          {@const Comp = ScoresLensComp}
          <Comp
            {sel}
            {selStore}
            {boot}
            {manifest}
            ver={earlyVersion}
            {mapHandle}
            {activeTool}
            fallbackBody={TOOL_BODY[activeTool]}
            lens={scoresLens}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
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

  <!-- atlas-4 defect fix: ONE floating "lens legend" region, keyed on `sel.lens` -- spec.md's "one
       legend on screen at a time". Species used to be the only lens with a floating legend at
       all; the scores lens' copy used to live INSIDE LayersPanel.svelte (only visible with that
       tool open, and never for the zone-choropleth branch) -- both branches now render here,
       lazy, the same way every other lens component in this file is. -->
  {#if sel.lens === "species" && SpeciesLegendComp}
    {@const Comp = SpeciesLegendComp}
    <Comp legend={speciesLens.mapInputs.legend} />
  {:else if sel.lens === "scores" && ScoresLegendComp}
    {@const Comp = ScoresLegendComp}
    <Comp legend={scoresLens?.mapExtra.legend ?? null} />
  {/if}

  <div class="about-region" id="about-region" data-tour="about" data-control="about">
    <About {releaseNote} />
    <!-- Deliverable 4, zero backend (CLAUDE.md/GATES.md: "the CalCOFI zero-backend fallback"):
         a real <a>, not a button, so it works with JS disabled/failed too -- `href` is a plain
         `$derived` (feedbackHref, above), so it is always the CURRENT lens/ver/theme, never a value
         captured once at mount. Desktop-only, same as the About card it sits beside (shell.css's
         `.about-region { display:none }` below 899px) -- no room next to the phone bottom rail. -->
    <a
      class="feedback-link"
      data-tour="feedback"
      data-control="feedback"
      href={feedbackHref}
      target="_blank"
      rel="noopener"
      onclick={onFeedbackClick}
    >
      <Icon name="alert" size={14} />
      Report a problem
    </a>
  </div>
</main>

{#if NotFoundModalComp}
  {@const Comp = NotFoundModalComp}
  <Comp
    open={speciesLens.notFound !== null}
    reasons={speciesLens.notFound?.reasons ?? []}
    onclose={() => speciesLens.dismissNotFound()}
  />
{/if}

<!-- spec.md §11: the shell's ONE polite live region (SC 4.1.3) -- every component (Rail's
     onAnnounce below, this file's own onShare/onHelp/onVersionClick) calls the shared
     `announce()` from src/lib/ui/announcer.ts; nothing else in the shell renders a region of
     its own. -->
<Announcer />

<!-- atlas-4 step 3: app-wide chrome, not gated on `sel.lens` -- the release picker and the
     welcome modal apply to either lens, exactly as the ported app's own modals did. Both load as
     their own lazy chunk (see "lazy lens/panel chunks" above); until then neither renders anything
     (a closed modal has no visible box), so there is nothing for the skeleton/hydrated geometry
     gate to compare here. -->
{#if VersionPickerModalComp}
  {@const Comp = VersionPickerModalComp}
  <Comp
    open={versionPickerOpen}
    onclose={() => (versionPickerOpen = false)}
    {versions}
    {denied}
    currentVer={earlyVersion}
    loc={{ search: location.search, hash: location.hash }}
  />
{/if}
{#if WelcomeModalComp}
  {@const Comp = WelcomeModalComp}
  <Comp tour={sel.tour} onTakeTour={() => void beginTour()} />
{/if}
