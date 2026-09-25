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
  import { onMount, tick, type Component } from "svelte";
  import "./shell.css";
  import { buildRailItems, TOOL_BODY, TOOL_LABEL, type ToolName } from "./tools";
  // R3-W8 item 3: the `ui=` token's parse/format core — see that module's own header for what it
  // carries and why it is a separate token from Sel's own query keys.
  import { formatUi, parseUi, type UiExpandedRow, type UiReportTab, type UiTab } from "./uiState";
  import type { LayerGroupId } from "../lib/map/layerStack";
  // R5: the wave-in-hexagon mark replaces the old two-file "wave in a circle" pair
  // (mst-mark.svg/mst-mark-dark.svg, kept vendored only for history -- Report.svelte moved to
  // this same component too) -- inline, so ONE definition serves both themes through
  // --border-accent rather than a `.mark--navy`/`.mark--paper` display:none swap.
  import WaveHexMark from "../lib/brand/WaveHexMark.svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Rail from "../lib/ui/Rail.svelte";
  import Panel from "../lib/ui/Panel.svelte";
  import Sheet from "../lib/ui/Sheet.svelte";
  import Segmented from "../lib/ui/Segmented.svelte";
  import ReportPane from "./ReportPane.svelte";
  import VersionBadge from "../lib/ui/VersionBadge.svelte";
  import Announcer from "../lib/ui/Announcer.svelte";
  import Toast from "../lib/ui/Toast.svelte";
  import Honeycomb from "../lib/ui/Honeycomb.svelte";
  import LegendChip from "../lib/ui/LegendChip.svelte";
  import { announce, notify } from "../lib/ui/announcer";
  // V3 (Ben's report, 2026-09-24): titiler-v8/the API going dark for an hour with a perfectly
  // normal-looking, raster-less map -- src/lib/health/* is the probe state machine (Svelte-free,
  // per tests/state/invariants.test.ts's gate); createHealthStore is this file's own reactive
  // wrapper around it (co-located here, not under src/lib, for the same reason
  // src/lens/species/state.svelte.ts is co-located with its lens).
  import HealthBanner from "../lib/ui/HealthBanner.svelte";
  import { createHealthStore } from "./health.svelte";
  // R2 (docs/usability.md §7): About + Feedback + the phone ⋯ menu -- a NEW component, so this
  // file's own change is one mount line (see the template below) while U5/U6 touch the rail and
  // the Report/Help/theme controls in parallel. See TopBarActions.svelte's own header.
  import TopBarActions from "./TopBarActions.svelte";
  import {
    DEFAULT_PANEL_GEOMETRY,
    loadPanelGeometry,
    viewportBucket,
    type PanelGeometry,
  } from "../lib/ui/panelGeometry";
  import {
    DEFAULT_SHEET_DETENT,
    legendChipMode,
    loadSheetDetent,
    type SheetGeometry,
  } from "../lib/ui/sheetGeometry";
  import { createSelStore } from "../lib/state/sel.svelte";
  import { formatSel } from "../lib/state/codec";
  import { DEFAULT_SEL, defaultOut, resolveTheme, type LayerStackEntry } from "../lib/state/types";
  import { createMap, type MapHandle } from "../lib/map/map";
  import { composeStyle, BASEMAP_LAYER_PREFIX } from "../lib/map/style";
  // R3 (round-2 plan §5 U4): the layer stack — resolved here (the SAME resolved object both
  // `composeStyleInput` and each lens's `LayersPanel` mount read, per this task's own instructions
  // to keep Shell.svelte's edits to exactly "the panel mount and the composeStyle input").
  import { defaultLayerStackEntries, isDefaultLayerStack } from "../lib/map/layerStack";
  import {
    warmBasemapStyles,
    BASEMAP_ATTRIBUTION,
    type CartoStyleLike,
  } from "../lib/map/layers/basemap";
  import { zoneUnitsFromBoot, zoneUnitsWithOutline } from "../lib/map/layers/zones";
  // R3 orchestrator audit item 2: the standalone ecoregion outline, read from the release's
  // MANIFEST (never `boot.units[]`, which stays exactly one row per D17) -- a plain `.ts` reader,
  // not a `.svelte` SFC, so it is exempt from `tests/shell/lazy-lens-imports.test.ts`'s static-
  // import ban the same way `state.svelte.ts` already is (that file's own header explains why).
  import { ecoregionZoneUnitFromManifest, fullSubregion, layerByKey } from "../lens/scores/boot";
  // R3-W2: the Download menu's `?lyr=` fallback -- the SAME rule `state.svelte.ts#lyr` applies
  // (an unset/unknown metric key resolves to the release's own composite default), a plain `.ts`
  // reader like `boot.ts` above, exempt from the lazy-lens-runtime-import ban for the same reason.
  import { effectiveLyr } from "../lens/scores/fallback";
  import { studyAreaFromBoot, type StudyArea } from "../lib/map/interaction";
  import {
    INITIAL_AREA_CAMERA_STATE,
    paddedStudyAreaCenter,
    phoneDefaultCamera,
    shouldFlyToArea,
    type AreaCameraState,
    type ChromePadding,
    type Viewport,
  } from "../lib/map/camera";
  import {
    desktopPanelPadding,
    phonePadding,
    phoneLiveChromePadding,
  } from "../lib/map/chromePadding";
  import { createAnalytics } from "../lib/analytics/analytics";
  import { analyticsLogUrl } from "../lib/analytics/logUrl";
  // atlas-8 Deliverable 4 (beta feedback, zero backend -- CLAUDE.md/GATES.md's "the CalCOFI
  // zero-backend fallback"): both pure functions take a snapshot the caller builds -- neither ever
  // reads `location`/`window.location` itself (tests/feedback/noHash.test.ts's source-scan gate).
  import {
    feedbackIssueUrl,
    pageUrlFromLocation,
    type FeedbackContext,
  } from "../lib/feedback/issueUrl";
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
  // R3-W2: the Download menu -- `places/model.ts#placesFromHash` (never a second parser of `sel.pl`)
  // gives it the current places list for "Selected places · GeoJSON"'s enabled/disabled state.
  import { placesFromHash } from "../places/model";
  // type-only (erased at build time) -- DownloadMenu.svelte's RUNTIME module is loaded dynamically
  // (see `openDownload()`, below, and that file's own "LAZY" header note): its map-capture/SVG/
  // COG-fetch logic pushed the static "before first interaction" budget to 449.9/450.0 KB gzip
  // when statically imported (measured) -- a download is never needed before first interaction,
  // the exact case `scripts/size-budget.mjs`'s rule exists for.
  import type DownloadMenu from "./DownloadMenu.svelte";
  import type { ResolvedTheme, ZoneUnitSpec } from "../lib/map/types";
  // U6 (round 2): Report -- pure decision logic (report.ts) + the tour's step DATA (tour.ts, no
  // driver.js). Both are small/dependency-free, so both stay ordinary static imports; only the
  // TOUR RUNTIME (tourRuntime.ts, which imports driver.js) is a dynamic import() -- see
  // `beginTour()` below and that file's own header.
  import { tourStepsForLens, type TourActions } from "./tour";
  import type { Lens } from "../lib/state/types";

  const selStore = createSelStore(location);
  const sel = selStore.sel;

  // R3-W8 item 3: a shared link's `ui=` token (Share's own writer, `onShare` below) — parsed ONCE,
  // synchronously, from the page's initial query string, so every chrome piece it restores
  // (`activeTool`, `expandedRow` below; `panelGeom`/`sheetGeom`'s own initial overrides, passed to
  // `<Panel>`/`<Sheet>` further down) gets its restored value from the very first render this
  // component makes — never a later `$effect` that would repaint after a visible default flash.
  // `ui=` is NEVER read again after this (no `$effect` watches `location.search` for it) and is
  // never written by `history.replaceState` (`selStore`/`formatSel` do not know it exists) — U1's
  // rule ("layout is chrome, never the URL") holds for every ORDINARY interaction exactly as
  // before; only Share's own one-shot link build touches this token at all.
  const initialUi = parseUi(new URLSearchParams(location.search).get("ui"));

  // V3: created once, up front -- trigger (a) (boot) fires from the `early.version` onMount below,
  // trigger (b) (a real tile failure) from the map's own onMount, trigger (c) from the banner's
  // Retry. It never polls on its own (brief: "Do not poll continuously while everything is fine").
  const health = createHealthStore();

  // a minimal Analytics instance (analytics.ts's own header: the GA4 `<script>` LOADER tag is a
  // later phase's job; `track()` calls made before it lands simply queue into `dataLayer` the way
  // GA4's own snippet already expects — see analytics.ts). `preview: false` here is a necessary
  // GUESS -- the session fetch (`window.__early.session`) has not resolved yet at construction
  // time -- corrected by `analytics.updatePreview()` in the boot `onMount` below once it does
  // (R3-B15; every event tracked before that point, on a public-by-default guess, is the same
  // trade-off `page_location` already makes for the inline early-fetch script's own timing).
  // round 2, Q7 fix: `logUrl` was never passed here, so the Sheet-log beacon (docs/analytics.md)
  // could never fire no matter what Ben set `VITE_LOG_URL` to -- see src/lib/analytics/logUrl.ts.
  const analytics = createAnalytics({
    appVersion: __APP_VERSION__,
    preview: false,
    logUrl: analyticsLogUrl(),
  });

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

  // --- the tool rail: FOUR controls, the same four, in the same order, on every viewport and
  // every lens (R3-W8 item 4: "drop the Flower plot from the toolbar" -- it moved into the Layers
  // pane as that pane's own second tab, below). "activeTool" is chrome (which panel is open), not
  // URL view state.
  // R3-W8 item 3: restored from a shared link's `ui=` token when present (`initialUi`, above) —
  // "layers" (unchanged) otherwise.
  let activeTool = $state<ToolName>(initialUi?.tool ?? "layers");
  const railItems = $derived(buildRailItems());

  // R3-W8 item 4: which of the Layers pane's own two tabs is showing ("layers" | "info" -- the
  // Scores lens' Flower plot / the Species lens' Species info). Lifted here (not left as
  // `LibLayersPanel`'s own internal state) for the same reason `expandedRow` is: Share reads it
  // (`shareUrl()`, below) and a `ui=` link restores it before first interaction.
  let activeTab = $state<UiTab>(initialUi?.tab ?? "layers");

  // R3-W8 item 5: which of the Report pane's own two tabs is showing ("places" | "report" --
  // Places is the default, folded in from its own former rail tool). Same "chrome, restorable
  // from a link, Share reads it back" treatment as `activeTab` above.
  let activeReportTab = $state<UiReportTab>(initialUi?.reportTab ?? "places");

  // the phone sheet / desktop panel title: normally the active tool's label, but while the Layers
  // pane's "info" tab is showing, the tab names itself instead ("Flower plot" for Scores, "Species
  // info" for Species) -- item 4: "the sheet's title shows the active tab's name." Item 5: while
  // the Report pane's own "Places" tab is showing, the title reads "Report · Places" (Ben:
  // discoverability mitigation for a tool that used to have its own rail button).
  const infoTabLabel = $derived(sel.lens === "species" ? "Species info" : "Flower plot");
  const panelTitle = $derived(
    activeTool === "layers" && activeTab === "info"
      ? infoTabLabel
      : activeTool === "report" && activeReportTab === "places"
        ? "Report · Places"
        : TOOL_LABEL[activeTool],
  );

  // R3-W8 item 3: the Layers pane's own expanded row (`LibLayersPanel`'s controlled-row-expansion
  // pair) — lifted here (rather than left as that component's own internal state) so Share can read
  // it and a `ui=` link can restore it, matching `activeTool`'s own "chrome, restorable from a
  // link, never ordinary URL state" treatment. "data-raster" (the Data row) is the same default
  // `LayersPanel.svelte`'s own internal state used before this existed.
  let expandedRow = $state<LayerGroupId | null>(initialUi?.expandedRow ?? "data-raster");

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
  // usability M3: the desktop `<Panel>` instance, bound below -- `selectTool()` calls its exported
  // `expand()` (the same instance-method pattern `Toast.svelte`'s own `push()` uses) so a rail
  // click always un-collapses it. Undefined on the phone, where `<Sheet>` renders instead.
  let panelRef = $state<ReturnType<typeof Panel> | undefined>(undefined);
  // R1: Panel.svelte is the source of truth for its own dock/size/maximized geometry (this shell
  // never sets it) -- it reports every change through `ongeometry`, and THIS mirror is what lets
  // shell.css position `#panel-region` (data-dock/data-maximized/`--panel-size`, below), per this
  // file's "the shell owns WHERE it floats" convention (docs/map.md's sibling rule for the map).
  let panelGeom = $state<PanelGeometry>(DEFAULT_PANEL_GEOMETRY);
  // P1 fix: Sheet.svelte's own mirror of `panelGeom` above -- its `ongeometry` reports the
  // sheet's current detent + REAL measured height (svh-based CSS, not a number this shell could
  // otherwise know), which is what lets the floating legend chip track the sheet's actual top
  // edge (`legendChipMode`, `.legend-chip-region`'s `--legend-chip-sheet-height`, below) instead
  // of sitting at a fixed offset that used to land on the sheet's own header controls at "peek"
  // and the last table row at "half" (Ben's phone report, 2026-09-24).
  let sheetGeom = $state<SheetGeometry>({ detent: DEFAULT_SHEET_DETENT, height: 0 });
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
      `#rail-region button.railitem[aria-label="${CSS.escape(label)}"]`,
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
    // usability M3: a rail click used to leave a collapsed desktop panel collapsed -- only the
    // pill's own label changed, so the tool the user just chose never actually rendered.
    // `panelRef` is undefined on the phone (Sheet.svelte has no collapsed state to un-collapse).
    panelRef?.expand();
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

  // R3-W8 item 3 (Ben, 2026-09-25): "when clicking Share, the link should include all the same UI
  // elements in their arrangement, eg on Layers pane." Everything ELSE Ben's example names (the
  // species input, its representation, the zoom-to-layer preference) is already ordinary `Sel`
  // query state by the time Share is clicked — `location.href` already carries it, same as
  // `unit`/`lyr`/`pal` for the scores lens. This appends ONLY the chrome `ui=` covers (see
  // `uiState.ts`'s own header): built fresh, here, from the shell's own live state — never written
  // by `selStore`/`history.replaceState`, so an ordinary drag/dock/tab change never touches the URL
  // (U1's rule, unchanged).
  // `expandedRow` (the shared Layers-pane row expander) is typed as the WIDER `LayerGroupId | null`
  // (it is also handed straight to `LibLayersPanel`'s `onExpandedRowChange`, which reports any
  // group id) even though only "data-raster"/"data-zones" are ever actually expandable rows
  // (`LayersPanel.svelte`'s own `EXPANDABLE_ROW_IDS`) — `uiState.ts`'s `UiExpandedRow` is the
  // narrower two-value shape the `ui=` token actually encodes, so this narrows explicitly rather
  // than widening the token's own type to match.
  function toUiExpandedRow(id: LayerGroupId | null): UiExpandedRow {
    return id === "data-raster" || id === "data-zones" ? id : null;
  }

  function shareUrl(): string {
    const url = new URL(location.href);
    url.searchParams.set(
      "ui",
      formatUi({
        tool: activeTool,
        dock: panelGeom.dock,
        size: panelGeom.size,
        detent: sheetGeom.detent,
        expandedRow: toUiExpandedRow(expandedRow),
        tab: activeTab,
        reportTab: activeReportTab,
      }),
    );
    return url.toString();
  }

  async function onShare() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      notify("Link copied to your clipboard.");
    } catch {
      notify("Couldn't copy the link automatically — copy it from the address bar.", {
        tone: "error",
      });
    }
  }

  // UI-16 (round 3, Opus 5.5 eyes-on review): the phone ⋯ menu's own quick "Report" action
  // (`onReport()`, its `reportAction()`-driven "open a recent report straight away, or the
  // chooser") is REMOVED -- desktop never had an equivalent top-bar button, only the rail's own
  // "Report" tool (`selectTool("report")`, below), so this was the one ⋯-vs-desktop mismatch the
  // review named. `ReportTool.svelte` (the rail tool's own panel body) already calls the SAME
  // `reportAction()`/`recordRecentReport()` pair independently ("a shortcut to open a report for
  // whatever is already selected", that file's own header) the moment it opens, so nothing here
  // loses functionality -- the smart-open behaviour just now lives in the ONE place both viewports
  // already share, instead of a second copy only the phone's quick action reached.

  // R2 (docs/usability.md §7): "About this release" moved from the on-map bottom-left card into
  // the top bar (`data-control="about"`, TopBarActions.svelte) -- there is no longer a stub `onHelp`
  // here pointing a keyboard/AT user at it; U6's own real Help menu (below) owns `onHelp` outright.

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
    let tourSnapshot: {
      lens: Lens;
      activeTool: ToolName;
      activeReportTab: UiReportTab;
    } | null = null;
    return {
      getLens: () => sel.lens,
      setLens: (lens) => onLensChange(lens),
      selectTool: (name) => selectTool(name),
      selectReportTab: (tab) => (activeReportTab = tab),
      snapshot: () => {
        tourSnapshot = { lens: sel.lens, activeTool, activeReportTab };
      },
      restore: () => {
        if (!tourSnapshot) return;
        if (sel.lens !== tourSnapshot.lens) onLensChange(tourSnapshot.lens);
        activeTool = tourSnapshot.activeTool;
        activeReportTab = tourSnapshot.activeReportTab;
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
    // P round 2 fix (health.svelte.ts#probeData's `base` param): the SAME resolved data origin
    // index.html's early-fetch script used for its OWN `app/boot.json` fetch -- reading it back
    // here (never re-deriving it) means the health probe can never disagree with what actually
    // loaded, preview session prefix included.
    base?: Promise<string | null>;
    boot?: Promise<unknown>;
    // atlas-4: the scores lens' raster/overlay/legend inputs come from `manifest.overlays`
    // (boot.json carries no `overlays` key today) -- read the same global VersionBadge.svelte and
    // index.html's inline script already publish, never a second fetch.
    manifest?: Promise<unknown>;
    // atlas-4 step 3: the release picker (D15) reads the SAME `versions.json` rows and denial
    // record index.html's inline early-fetch script already resolved -- never a second fetch.
    versions?: Promise<EarlyVersionRow[] | null>;
    denied?: Promise<{ ver: string; reason: string } | null>;
    // R3-B15: the SAME same-origin `session.json` result index.html's early-fetch script already
    // resolved (D6's "the one door into preview") -- never a second fetch, and never awaited on
    // the public path (this is read only once it has already settled on its own).
    session?: Promise<{ preview: boolean }>;
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
  // P10: docsHref moved below `releaseRestricted` -- it now needs to know the release's access
  // level, which that derived value (and `currentVersionRow`) computes.
  let boot = $state<unknown>(null);
  let manifest = $state<unknown>(null);
  let versions = $state<EarlyVersionRow[] | null>(null);
  let denied = $state<{ ver: string; reason: string } | null>(null);
  onMount(() => {
    const early = (window as unknown as { __early?: Early }).__early;
    // V3 trigger (a), tiler half: the titiler origin is a fixed constant -- no need to wait on
    // anything resolving first.
    health.probeTiler();
    early?.version
      .then((v) => {
        earlyVersion = v;
        // V3 trigger (a), data half: only once the release itself is known. P round 2 fix: probe
        // the SAME resolved base `early.base` carries (the one index.html's own fetch of
        // app/boot.json used), not always the public bucket -- falls back to no base (the public
        // bucket URL) if `early.base` is absent or itself rejects.
        if (v) {
          const base = early.base ?? Promise.resolve(null);
          base.then((b) => health.probeData(v, b ?? undefined)).catch(() => health.probeData(v));
        }
      })
      .catch(() => {});
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
    // R3-B15: `analytics` was constructed above with `preview: false` (a necessary guess -- the
    // session fetch was still in flight at that point) -- correct it once the real answer lands,
    // same `window.__early.session` result index.html's own early-fetch script already resolved.
    // `.catch(() => {})` matches every other `early.*` read here: a rejected/absent session is
    // simply left at the constructor's public default, never a thrown error.
    early?.session?.then((s) => analytics.updatePreview(s.preview === true)).catch(() => {});
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
    // V1 fix: the species camera's model-bounds fit pads for whatever chrome is covering the map
    // RIGHT NOW (see currentChromePadding's own header, below) instead of a flat 40px on every
    // edge -- a getter, called fresh on every fit, never a value captured at this line.
    chromePadding: () => currentChromePadding(),
    // R3-rr fix 1, round 5: a wide-range species' "US waters"/"Whole range" camera needs the
    // CURRENT viewport dimensions (`phoneAwareWideRangeBounds`/`boundsToCameraView`, both in
    // `lib/map/camera.ts`) -- read fresh on every call, never a captured snapshot. `isPhone` is
    // the SAME `matchMedia` breakpoint state this file already tracks (above), never a second
    // decision.
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    isPhone: () => isPhone,
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

  // P1 fix: hoisted out of the template (it used to be a `{@const}` inline where the legend chip
  // rendered) so BOTH the floating placement and the "full" detent's inline-in-sheet placement can
  // read the SAME value without recomputing it or duplicating the lens/kind branch.
  const phoneLegend = $derived(
    sel.lens === "species" ? speciesLens.mapInputs.legend : (scoresLens?.mapExtra.legend ?? null),
  );

  // UI-1 (round 3): `<Toast>`'s own phone bottom-offset PROP -- see its mount point (below) for why
  // this is a prop, never a wrapping `<div>`. Same "rail row + sheet's real height while floating"
  // formula `.map-attribution`/`.legend-chip-region` already use (shell.css), computed in PX here
  // since Toast.svelte sets it as a literal inline style, not a `calc()` string referencing tokens
  // this component does not import (64/8 mirror `chromePadding.ts#PHONE_RAIL_ROW_PX` and
  // `tokens.css`'s `--space-2`, the SAME "estimate, not import" convention that file's own header
  // explains).
  const toastPhoneBottomOffsetPx = $derived(
    64 +
      (phoneLegend && legendChipMode(sheetGeom.detent) === "floating" ? sheetGeom.height : 0) +
      8,
  );

  // R3-W2: the Download menu's per-lens context -- built from data every lens ALREADY resolves
  // (the current layer row, the active species pill/asset), never a second read of `sel.lyr`/`sel.in`
  // against a different rule than the one that actually painted the map. `effectiveLyr` (never raw
  // `sel.lyr`) is the SAME fallback `state.svelte.ts#lyr` applies -- an unset/unknown `?lyr=` still
  // resolves to the release's own composite default, matching what the raster ACTUALLY paints.
  const downloadLyr = $derived(effectiveLyr(sel.lyr, boot));
  // Fix round (Opus 5.5 eyes-on review, D3): this used to read `layerByKey(...)?.label` directly
  // -- `boot.layers[].label` is the layer's LONG description (~190 chars for `primprod`), not a
  // title. `phoneLegend.title` (below) is the SAME short label the Layer select and the legend
  // chip already show (`mapInputs.ts`'s own `title`, `metricKeyLabel()`/the manifest's short
  // `metricLabels` preferred over the long `layer.label`) -- reused here, never re-derived, so the
  // download title can never drift from what the app is already displaying.
  const downloadTitle = $derived(
    sel.lens === "species"
      ? (speciesLens.card?.sci ?? "Species")
      : (phoneLegend?.title ?? downloadLyr ?? "Score"),
  );
  const downloadLegendStops = $derived(
    phoneLegend && "stops" in phoneLegend ? phoneLegend.stops : [],
  );
  const downloadUnit = $derived(
    sel.lens === "scores"
      ? "score"
      : phoneLegend && "unit" in phoneLegend
        ? phoneLegend.unit
        : undefined,
  );
  const downloadCogUrl = $derived.by(() => {
    if (sel.lens === "species") {
      const asset = speciesLens.mapInputs.asset;
      return asset?.type === "cog" ? asset.url : null;
    }
    const layer = layerByKey(boot, downloadLyr);
    return layer ? (fullSubregion(layer)?.cog ?? null) : null;
  });
  const downloadCogDisabledReason = $derived(
    downloadCogUrl
      ? undefined
      : sel.lens === "species"
        ? (speciesLens.mapInputs.notice ?? "no surface selected for this input")
        : "no COG published for this metric/subregion",
  );
  const downloadMetricOrMdlKey = $derived(
    sel.lens === "species"
      ? (speciesLens.bar?.pills.find((p) => p.active)?.mdlKey ?? null)
      : downloadLyr,
  );
  const downloadPlaces = $derived(placesFromHash(sel.pl));
  // `typeof DownloadMenu` (not `Component<any>`, unlike the other lazy chunks below) -- this is the
  // ONE lazy chunk in this file `bind:this` calls a method on (`downloadMenuRef?.openPhoneModal()`);
  // `Component<any>`'s implicit empty Exports would make `bind:this` yield a shape lacking
  // `openPhoneModal` (svelte-check error, plain `tsc` does not see it -- CLAUDE.md's own note on
  // why `npm run check` is required for a `.svelte` edit), and would also make every prop this
  // component takes (including the inline `track` callback below) implicitly `any`.
  let DownloadMenuComp = $state<typeof DownloadMenu | null>(null);
  let downloadMenuRef = $state<ReturnType<typeof DownloadMenu> | undefined>(undefined);
  let downloadAutoOpen = $state<"desktop" | "phone" | undefined>(undefined);
  // desktop: Shell.svelte's own static placeholder button (below) calls this on its FIRST click
  // only -- once `DownloadMenuComp` loads, the placeholder is gone (`{#if}`-swapped for the real
  // component) and every later desktop click is handled by `Menu.svelte`'s own trigger, inside
  // DownloadMenu.svelte, without ever calling back here. phone: TopBarActions.svelte's ⋯
  // "Download…" item calls this EVERY time (there is no persistent phone trigger to hand off to),
  // so an already-loaded component reopens its Modal directly instead of re-importing.
  function openDownload(mode: "desktop" | "phone") {
    if (DownloadMenuComp) {
      if (mode === "phone") downloadMenuRef?.openPhoneModal();
      return;
    }
    downloadAutoOpen = mode;
    import("./DownloadMenu.svelte")
      .then((mod) => (DownloadMenuComp = mod.default))
      .catch(() => announceChunkFailure("the download menu"));
  }
  // R3-B5 (Opus eyes-on review, 2026-09-25): the scores lens' current layer own long description
  // (`boot.layers[].label`), when the release publishes one that says something `phoneLegend.title`
  // does not already say -- the SAME dedupe rule `LayersPanel.svelte`'s `currentLayerDescription`
  // applies, kept in sync deliberately (both compare against the SAME short-vs-long fallback chain,
  // `mapInputs.ts`'s own `title` derivation). Shown in the phone legend modal instead of leaving
  // that space blank (`LegendChip.svelte`'s `description` prop); `null` for species (no per-model
  // description published) or before a layer has resolved.
  const phoneLegendDescription = $derived.by(() => {
    if (sel.lens !== "scores" || !scoresLens) return null;
    const layer = layerByKey(boot, scoresLens.lyr);
    const desc = layer?.label ?? null;
    if (desc === null) return null;
    return desc === (phoneLegend?.title ?? null) ? null : desc;
  });

  // R3-W2 fix round (Opus 5.5 eyes-on review, D3): the Download menu's footer, optional second
  // line -- reuses `phoneLegendDescription` verbatim (declared just above; it is ALREADY deduped
  // against `phoneLegend.title` there -- `null` when the description would just repeat the title,
  // the release publishes none, or the lens is species). Never a second, independent read of
  // `layer?.label` here -- one place decides "is this description worth showing at all". Declared
  // AFTER `phoneLegendDescription` on purpose: `npm run check` (svelte-aware, unlike plain `tsc`)
  // flags a `const` referenced before its OWN declaration even when the read only happens inside a
  // closure Svelte invokes later (a `$derived` callback) -- the runtime would have been fine, but
  // the static check is not, so source order here matters.
  const downloadDescription = $derived(sel.lens === "scores" ? phoneLegendDescription : null);

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

  // R3 orchestrator audit item 2: the standalone ecoregion outline (black, 3px --
  // `layers/zones.ts#ZONE_LINE_STYLE.ecoregion`, unchanged) drawn on every SCORES view,
  // independent of `sel.unit`/`sel.out` -- `null` when the release's manifest has not loaded yet or
  // does not publish one. Appended AFTER `zoneUnitsWithOutline()` (never fed through it): this is
  // decoration, not the release's one selectable unit, so `sel.out` never hides it. Kept OUT of
  // `zoneUnits`/`zonesForStyle` (Places/pick-mode's own inputs) so drawing it can never make
  // "ecoregion" a pickable zone type by accident.
  //
  // m9 (review round 1): a release whose OWN `boot.units[]` already publishes an "ecoregion"
  // selectable unit (so `zonesForStyle` already carries one, e.g. via `sel.out=ecoregion`) must
  // not ALSO get this manifest-published outline appended -- `composeStyle` keys every zone unit's
  // ids on `unit` (`ecoregion_ln`, …), so two "ecoregion" entries in the same `zones` array collide
  // into duplicate layer ids and break the style. No release does this today (the manifest outline
  // exists precisely BECAUSE no release has an ecoregion `boot` unit), but the guard is cheap and
  // makes the combination structurally safe rather than "currently doesn't happen to occur."
  const ecoregionUnit = $derived(
    sel.lens === "scores" && !zonesForStyle.some((u) => u.unit === "ecoregion")
      ? ecoregionZoneUnitFromManifest(manifest)
      : null,
  );

  // usability M4: "the default camera frames Canada; panel/sheet cover the study area" -- the
  // FALLBACK study area's own center+zoom never accounted for the panel/sheet's own reserved
  // space, so the point it frames could render partly or wholly BEHIND the chrome. Applied only
  // when there is no explicit `?map=` (a real, user-chosen camera is never second-guessed): reads
  // the SAME localStorage keys Panel.svelte/Sheet.svelte themselves read (chromePadding.ts), so it
  // works before either component has mounted, and shifts the center via `paddedStudyAreaCenter`
  // (camera.ts) -- never MapLibre's own persisted `padding` (see that function's own header for
  // why: it would also reshape every LATER flyTo/flyToBounds on top of their own zoom math).
  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function initialChromePadding(): ChromePadding {
    if (isPhone) {
      return phonePadding(loadSheetDetent(storage(), "shell"), window.innerHeight);
    }
    return desktopPanelPadding(
      loadPanelGeometry(storage(), "shell", viewportBucket(window.innerWidth)),
    );
  }

  // V1 fix (Opus eyes-on review, 2026-09-24): "the species camera fit sits under the sheet/legend
  // chip on the phone, and under an open panel on desktop" -- {@link initialChromePadding} above
  // reads a localStorage SNAPSHOT and is only ever called once, before Panel.svelte/Sheet.svelte
  // have even mounted; a species re-fit happens long after that, so it needs the LIVE geometry
  // this file already tracks (`panelGeom`/`sheetGeom`, this file's own `ongeometry` mirrors,
  // above). The actual padding math is `chromePadding.ts#phoneLiveChromePadding` (a plain,
  // testable function -- see its own header); this just feeds it the live state.
  function currentChromePadding(): ChromePadding {
    if (isPhone) {
      const chipShowing = !!phoneLegend && legendChipMode(sheetGeom.detent) === "floating";
      return phoneLiveChromePadding(
        sheetGeom.height,
        sheetGeom.detent,
        window.innerHeight,
        chipShowing,
      );
    }
    // V4 fix (owner phone report, 2026-09-24, desktop-18): `phoneLegend` (despite its name) is
    // already lens-agnostic -- "the legend value the current lens would draw", the same one the
    // desktop `.lens-legend-region` branch reads (species -> speciesLens.mapInputs.legend, scores
    // -> scoresLens?.mapExtra.legend) -- so it doubles as desktop's own "is a legend card actually
    // on screen right now" flag with no new derived state.
    return desktopPanelPadding(panelGeom, !!phoneLegend);
  }

  // P9 (Opus docs re-check appendix finding A2, live-verified on 0.10.48): P2 round 2's fix
  // (boost the zoom of the SAME `FALLBACK_FULL_STUDY_AREA` centroid the desktop camera uses, then
  // shift for chrome) still left the phone's free area on that centroid's own neighbourhood --
  // central North Dakota, on the Canada border, nowhere near a scored ocean cell. Measured live:
  // `lon -101.304, lat 33.509, zoom 3.01`, and the free area showed Canada/the Great Lakes, 0%
  // scored cells. `camera.ts#phoneDefaultCamera`'s own header has the full measurement and why a
  // DIFFERENT anchor (a real, hand-picked Gulf-of-Mexico/south-east-coast bbox), not a bigger boost
  // of the same wrong point, is the fix. Desktop's own free area is tall enough (topbar-only
  // padding, no sheet) that the FULL preset's own unboosted centroid already keeps real coastline
  // in frame, so only the phone branch changes here.
  function initialStudyArea(area: StudyArea): StudyArea {
    if (sel.map) return area; // an explicit URL camera is never second-guessed
    if (isPhone) {
      // this call always resolves to `FALLBACK_FULL_STUDY_AREA` regardless of `sel.area`
      // (`studyAreaFromBoot(null, sel.area)` cannot see a release's real rows before `boot`
      // arrives -- see the "study-area camera" effect's own comment below) -- i.e. this IS always
      // the default first view, never a real `?area=` pick caught mid-flight.
      const viewport: Viewport = { width: window.innerWidth, height: window.innerHeight };
      const fit = phoneDefaultCamera(viewport, initialChromePadding());
      return { ...area, lon: fit.center[0], lat: fit.center[1], zoom: fit.zoom };
    }
    const padded = paddedStudyAreaCenter(area, area.zoom, initialChromePadding());
    return { ...area, ...padded };
  }

  // usability M4's OTHER half: a light loader over the map until the first raster/basemap tile
  // paints (the release's own load time, 8-21s measured, had NO loading indicator at all). Purely
  // an overlay (`pointer-events: none`, see the template) -- it never delays or blocks a click, and
  // being `position: absolute` over `.stage` it never shifts sibling boxes when it appears or
  // disappears (the shell.cls CLS gate's own budget is about elements that MOVE, not ones that are
  // added/removed on top of an unrelated canvas). "idle" is the map's OWN "every source has
  // settled" event -- the same backstop docs/map.md's styleQueue.ts uses elsewhere in this file --
  // plus a fixed safety timeout, so a spec/host that never actually loads a tile (most hermetic
  // e2e fixtures do not route one) still clears the loader rather than leaving it up forever.
  //
  // U1 fix round (CI run 35956406448): this used to announce "Map loading"/"Map ready" through
  // the ONE SHARED region (src/lib/ui/announcer.ts) -- but this loader is PERSISTENT and its own
  // "idle" can fire at any later, unpredictable moment, long after the page first painted,
  // clobbering the shared region's text out from under an unrelated feature's own announcement
  // made in between (a popup's description, a chunk-load failure) -- three real specs
  // (scores.popup, species-popup, shell.chunk-error) read a stale "Map ready" instead of their own
  // text. Fixed with its own DEDICATED `role="status"` region (`.map-loading-status` in the
  // template below, visually hidden) -- `Honeycomb`'s own mount-time announce is opted OUT
  // (`announceOnMount={false}`) so nothing here ever touches the shared region at all.
  let mapLoading = $state(true);
  const MAP_LOADING_TIMEOUT_MS = 8000;
  // the dedicated region's own text -- "Map loading" as soon as this component exists (mirroring
  // what Honeycomb's own mount-time announce used to say), "Map ready" once hidden. A real text
  // CHANGE either way (never re-set to the same value), which is what a polite region needs to
  // fire a screen reader announcement.
  let mapLoadingStatus = $state("Map loading");

  function hideMapLoader() {
    if (!mapLoading) return;
    mapLoading = false;
    mapLoadingStatus = "Map ready";
  }

  // the map's FIRST "idle" fires almost instantly, on the empty/blank style it is constructed
  // with (0.10.20's own basemap fix: the real CARTO style.json arrives later, asynchronously, and
  // recomposes -- see layers/basemap.ts#warmBasemapStyles / this file's own composeStyleInput
  // header). Hiding the loader on THAT idle would clear it before the basemap (or a raster) has
  // painted anything at all -- this listens on every idle and only clears once the CURRENTLY
  // applied style actually carries basemap/raster/range/overlay layers (`layers/basemap.ts`'s own
  // `basemap-` source prefix; `raster`/`range`/`overlay` are this file's own `LAYER_ORDER` roles).
  function onMapIdle(map: { getStyle(): { sources?: Record<string, unknown> } | undefined }) {
    const sources = Object.keys(map.getStyle()?.sources ?? {});
    // the blank CONSTRUCTION style has none; the FIRST composed style already has "background"
    // (style.ts) before the async CARTO fetch resolves -- so ">1" (basemap-* landed) is the real
    // signal, not merely ">0". `BASEMAP_LAYER_PREFIX` is the precise case; the count is the
    // fallback for a raster/range/overlay source (an arbitrary, model-specific id) landing first.
    if (sources.some((id) => id.startsWith(BASEMAP_LAYER_PREFIX)) || sources.length > 1) {
      hideMapLoader();
    }
  }

  onMount(() => {
    if (!mapEl) return;
    // `boot` (read a few lines up) is ALWAYS still `null` here regardless of what is passed below:
    // it settles from `early.boot.then(...)` above, a microtask that cannot run until this whole
    // synchronous mount pass (every `onMount` body in this component) has returned. Passed as `boot`
    // anyway, not a literal `null`, so this stays correct if that ordering ever changes — the
    // effect just below is what actually resolves the real `study_areas` row once `boot` arrives.
    const handle = createMap(mapEl, {
      theme: resolveTheme(sel.theme, prefersDark),
      camera: sel.map,
      // usability M4's padding applies to the FIRST paint only (before `boot` resolves -- see the
      // "study-area camera" effect just below for why `null` is passed here on purpose, and how a
      // later effect corrects an EXPLICIT `?area=` to its real, unpadded boot-resolved camera once
      // boot arrives -- the merged precedence this round's own CHANGELOG entry documents: an
      // explicit `area=` always wins over this padded default fit).
      area: initialStudyArea(studyAreaFromBoot(null, sel.area)),
      projection: sel.proj,
      // URL-is-the-view: the camera goes back through selStore, i.e. history.replaceState, and
      // only for user-driven moves (src/lib/map/camera.ts).
      onCamera: (map) => selStore.set({ map }),
    });
    mapHandle = handle;
    const handleMapIdle = () => onMapIdle(handle.map);
    handle.map.on("idle", handleMapIdle);
    // V3 trigger (b): a raster tile load failure. `health.reportMapError` classifies it itself --
    // a 403/404 (a release-side "no data here" gap, same convention as
    // `analysis/sources.ts#isMissingTileStatus`) is a no-op; anything else (5xx, a network error, a
    // timeout) is a real failure and kicks a backoff-gated re-probe of the tiler service. Every
    // failing tile fires this (dozens at once when the whole host is down), which is exactly why
    // the backoff/single-flight guard lives in the store, not here.
    const onMapError = (e: { error: unknown }) => health.reportMapError(e.error);
    handle.map.on("error", onMapError);
    const loaderTimeout = window.setTimeout(hideMapLoader, MAP_LOADING_TIMEOUT_MS);
    // atlas-5 §6.5: the species click. The shared map's raw click event -- never a second map
    // instance, never a second `on("click")` owner; a non-species lens ignores its own clicks
    // inside `handleMapClick` itself (checks `sel.lens` first).
    // atlas-8 review round 2, item M1: the scores lens' click now wires here too, the SAME shape
    // as species' own click (each self-guards on `sel.lens`) -- a collapsed desktop panel, or the
    // Places tool open, no longer stops a scores click from writing `sel=cell:`/`sel=zone:` and
    // showing its popup, because neither depends on `ScoresLens.svelte` (the PANEL body) being
    // mounted at all. `scoresLens` is null until its lazy chunk resolves (see "lazy lens/panel
    // chunks" below) -- a click in that brief window is a no-op, same as before this fix.
    //
    // Dispatching unconditionally surfaced a SECOND collision while wiring this fix: a scores
    // click during Places' OWN active pick mode / draw session wrote `sel=zone:...` (its own
    // selection) over the top of the pick highlight the SAME click had just set
    // (`placesMap.svelte.ts`'s own header explains why). `placesMap.interactionOwned` is Places'
    // exclusive claim on clicks while one of those is active; the scores lens is skipped while it
    // is true (species never writes `sel` from a click, so it is unaffected either way).
    const onMapClick = (e: {
      lngLat: { lng: number; lat: number };
      point: { x: number; y: number };
    }) => {
      void speciesLens.handleMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat }, e.point);
      if (!placesMap.interactionOwned) {
        void scoresLens?.handleMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat }, e.point);
      }
    };
    handle.map.on("click", onMapClick);
    // the map's public test/automation seam (docs/map.md): the handle plus the CURRENT composeStyle
    // inputs, so e2e/map.spec.ts and scripts/verify.mjs can drive the real map the way a lens will
    // -- compose a style, apply it -- instead of reaching into MapLibre. It exposes nothing a
    // viewer could not already read off the page.
    (window as unknown as { __atlasMap?: unknown }).__atlasMap = {
      handle,
      composeStyle,
      // item m6 (atlas-8 review round 2): `composeStyleInput` (below) is the SAME object the
      // reactive effect below applies -- reading it here (a plain closure, so referencing a
      // `const` declared later in this script is fine: it only runs once called, well after the
      // whole component has initialized) reproduces exactly what is on screen, including whether
      // the basemap has resolved yet (0.10.20), from the ONE place that object is built.
      inputs: () => composeStyleInput,
    };
    // the species lens' own test/automation seam, same spirit as __atlasMap just above: it exposes
    // only `selectSpecies`, exactly what clicking a picker option already does through the UI (used
    // by e2e/species.smoke.spec.ts to drive TWO rapid switches before the map's first "idle" --
    // the exact race styleQueue.ts's regression test covers at the unit level). `zoomToLayer` added
    // (D8 fold-in, orchestrator round 2, 2026-09-24) so e2e/species.camera.spec.ts can drive the
    // manual "re-fit" action the same way a future button will -- state.svelte.ts's own function is
    // the fix; this seam is only how a test reaches it before that button exists.
    (window as unknown as { __atlasSpecies?: unknown }).__atlasSpecies = {
      selectSpecies: (key: string) => speciesLens.selectSpecies(key),
      zoomToLayer: () => speciesLens.zoomToLayer(),
    };
    // no window `resize` listener here: createMap observes the CONTAINER, which also covers a
    // layout-driven resize (a panel opening, the phone sheet changing detent) that no window event
    // reports.
    return () => {
      delete (window as unknown as { __atlasMap?: unknown }).__atlasMap;
      delete (window as unknown as { __atlasSpecies?: unknown }).__atlasSpecies;
      handle.map.off("click", onMapClick);
      handle.map.off("idle", handleMapIdle);
      handle.map.off("error", onMapError);
      window.clearTimeout(loaderTimeout);
      handle.destroy();
      mapHandle = undefined;
    };
  });

  // --- the study-area camera: `sel.area` drives it on LOAD and on CHANGE, never the panel body ---
  // The owner's 2026-09-24 defect: `?area=AK` rendered the default camera, live, in production.
  // Root cause was two bugs stacked. (1) The map's INITIAL camera above (`area:
  // studyAreaFromBoot(null, sel.area)`) is constructed against a literal `null` boot, on purpose —
  // at `onMount` time `boot` (the `$state` a few lines up) has not resolved yet regardless of what
  // is passed here (it settles from `early.boot.then(...)`, a separate microtask), so there was
  // never a way to see the release's real `study_areas` row at construction time; only the baked
  // `FALLBACK_FULL_STUDY_AREA` was ever reachable there. (2) The ONLY place anything called
  // `handle.flyTo(area)` was `LayersPanel.svelte`'s `onchange` handler — the panel BODY (only
  // mounted while a tool is open and, on desktop, the panel is not collapsed) — which never runs for
  // a `sel.area` arriving from the URL on load. `docs/map.md`'s 0.10.21 rule exists for exactly this
  // shape of bug: a map input must live in a lens/shell-level store the shell reads unconditionally,
  // never panel-only UI.
  //
  // This effect is that store, at the shell level (`sel.area` is a top-level `Sel` field, not scores
  // -specific — CLAUDE.md/docs/map.md's own convention: "map inputs are a plain store... independent
  // of which tool/panel is open or collapsed"). It re-runs whenever `boot`, `mapHandle`, `sel.area`
  // or `sel.map` changes and defers the fly/no-fly DECISION to `camera.ts#shouldFlyToArea` (a pure,
  // unit-tested function — read its header for the exact precedence a later round touching the
  // DEFAULT first-view camera must preserve). `LayersPanel.svelte`'s `onAreaChange` still writes
  // `{ area: value, map: undefined }` to `sel` (so a shared link reproduces the choice, and clearing
  // `map` is what lets THIS effect fly for it) — it no longer calls `mapHandle.flyTo` itself.
  let areaCameraState: AreaCameraState = INITIAL_AREA_CAMERA_STATE;
  $effect(() => {
    if (!mapHandle || !boot) return; // nothing to resolve `sel.area` against yet
    if (sel.map) return; // an explicit camera (a user's pan, or a pasted `?map=` link) always wins
    const area = studyAreaFromBoot(boot, sel.area);
    const decision = shouldFlyToArea(area.key, DEFAULT_SEL.area, areaCameraState);
    areaCameraState = decision.next;
    if (decision.fly) mapHandle.flyTo(area);
  });

  // P2 round 2 (orchestrator, real-build eyes-on, 2026-09-24): "the fit must use the free area
  // above the sheet (its measured height at that detent, at load time), not [an estimated]
  // constant... re-fit once when the sheet's initial detent is known" -- `initialStudyArea` (map
  // construction, above) necessarily used `initialChromePadding()`'s pre-mount ESTIMATE of the
  // sheet's height (`phonePadding`'s own 46svh-derived fraction), because Sheet.svelte has not
  // mounted yet at that point. `sheetGeom` (this file's own `ongeometry` binding, P1's addition)
  // reports the sheet's REAL `offsetHeight` shortly after -- this effect re-applies the fit ONCE,
  // with that real number, purely for accuracy (`chromePadding.ts#phonePaddingFromMeasured`'s own
  // header: usually within ~15px of the estimate). Guarded to the DEFAULT area only and to fire at
  // most once, so it can never race or compete with the `sel.area`-driven effect just above (a
  // real `?area=` selection, or a user's own pan, always wins and this never touches either).
  //
  // P9: uses the SAME `phoneDefaultCamera` bbox fit `initialStudyArea` does above (never the old
  // boost-the-desktop-centroid math -- see that function's own comment for why it was replaced) --
  // just with the sheet's real measured height instead of the pre-mount estimate.
  //
  // D5 fix (Opus 5.5 eyes-on review round 2, 2026-09-25): this refit used the SHEET's own measured
  // height but never the floating legend chip's -- at the default "half" detent the ramp legend
  // chip (always showing for the default Scores view, `phoneLegend` below) sat on top of the
  // northern Gulf of Mexico Program Areas, and the sheet's own top edge cut the Florida Keys.
  // `currentChromePadding()` already computes the SAME `chipShowing` boolean for every LATER
  // (post-load) re-fit (V1 fix, above) -- this is the one remaining caller still calling
  // `phonePaddingFromMeasured` bare. Gated additionally on `scoresLens` (the default lens) having
  // loaded: `phoneLegend` reads `scoresLens?.mapExtra.legend`, and `scoresLens` itself is a
  // DYNAMIC IMPORT (this file's own "0.10.21 fix 1" comment) -- firing before it resolves would
  // silently compute `chipShowing: false` and reproduce the exact defect this fixes.
  let refitOnceForMeasuredSheet = false;
  $effect(() => {
    if (refitOnceForMeasuredSheet) return;
    if (!isPhone || !mapHandle || !boot) return;
    if (sheetGeom.height <= 0) return; // Sheet.svelte has not reported a real measurement yet
    if (sel.lens === "scores" && !scoresLens) return; // the legend chip's own source not loaded yet
    if (sel.map || sel.area !== DEFAULT_SEL.area) return; // not the default padded first view
    refitOnceForMeasuredSheet = true;
    const area = studyAreaFromBoot(boot, sel.area);
    const viewport: Viewport = { width: window.innerWidth, height: window.innerHeight };
    const chipShowing = !!phoneLegend && legendChipMode(sheetGeom.detent) === "floating";
    const fit = phoneDefaultCamera(
      viewport,
      phoneLiveChromePadding(sheetGeom.height, sheetGeom.detent, window.innerHeight, chipShowing),
    );
    mapHandle.flyTo({ ...area, lon: fit.center[0], lat: fit.center[1], zoom: fit.zoom });
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

  // item m6 (atlas-8 review round 2): this object used to be built TWICE -- once here for
  // `applyStyle`, once again (nearly identically) as the automation seam's `inputs()` above -- two
  // sites that could silently drift the moment `composeStyle` gained a new input. ONE `$derived`,
  // read at both: this recomputes on exactly the same dependencies the old inline object read
  // (`resolvedTheme`, `basemapStyles[resolvedTheme]`, `sel.proj`, `zonesForStyle`, the raster/
  // range/overlays/selection branches below), and being a `$derived` (not read lazily inside an
  // optional-chain call) means it is ALWAYS evaluated regardless of whether `mapHandle` happens to
  // be null yet -- the same "defensive belt" the old local `raster`/`range` statements existed
  // for, now structural rather than a comment to remember.
  // R3 (round-2 plan §5 U4): resolved ONCE here — `sel.layers` (URL deltas) filled in with the
  // release's default stack (`defaultLayerStackEntries()`, a no-op on `composeStyle`'s own default
  // when nothing has been customized). Both lens panels below and `composeStyleInput` read this
  // SAME value, so the panel's rows and what the map actually draws can never disagree.
  const layerStack = $derived<readonly LayerStackEntry[]>(sel.layers ?? defaultLayerStackEntries());
  function onLayerStackChange(next: readonly LayerStackEntry[]) {
    selStore.set({ layers: isDefaultLayerStack(next) ? undefined : next });
  }

  const composeStyleInput = $derived({
    theme: resolvedTheme,
    // the reactive half of the 0.10.20 basemap fix: reading this is what makes the effect below
    // re-run (and the basemap actually appear) when the CARTO fetch resolves late.
    basemapStyle: basemapStyles[resolvedTheme],
    projection: sel.proj,
    zones: ecoregionUnit ? [...zonesForStyle, ecoregionUnit] : zonesForStyle,
    raster:
      sel.lens === "scores" ? (scoresLens?.mapExtra.raster ?? null) : speciesLens.mapInputs.raster,
    range: sel.lens === "species" ? speciesLens.mapInputs.range : null,
    overlays: sel.lens === "scores" ? (scoresLens?.mapExtra.overlays ?? []) : [],
    selection:
      placesSelection ?? (sel.lens === "scores" ? (scoresLens?.mapExtra.selection ?? null) : null),
    layerStack,
  });

  $effect(() => {
    mapHandle?.applyStyle(composeStyle(composeStyleInput));
  });

  // R2's About popover: "restricted watermark note". A plain inline lookup over the SAME
  // `EarlyVersionRow[]` this file already holds off `window.__early.versions` -- never
  // `src/lib/release/access.ts#accessOf` (tests/shell/shell-invariants.test.ts's source-scan gate:
  // the shell reads the release resolution result off `window.__early`, never `src/lib/release`
  // directly). `undefined`/no matching row/anything but the literal `"public"` reads as restricted,
  // the same fail-closed rule that module's own `accessOf` follows.
  const currentVersionRow = $derived(versions?.find((v) => v.ver === earlyVersion) ?? null);
  const releaseRestricted = $derived(currentVersionRow?.access !== "public");

  // P10: the Help menu's Docs link now points at THIS release's ATLAS CHAPTER of the docs book,
  // not the book root -- Ben's Help > Docs on the live v7 app opened the book's Preface, not the
  // Atlas guide he was looking for. `docs/apps/atlas.qmd` now exists and the docs CI publishes it
  // per release as `apps/atlas.html` inside that release's own book directory: PUBLIC releases to
  // `marinesensitivity.org/docs/{ver}/`, RESTRICTED ones only to the signed-in preview host (the
  // `publish` job never stages a restricted book onto the public branch at all -- see
  // `src/lib/release/docsUrl.ts`'s header). A release absent from `versions` (no matching row, or
  // `earlyVersion` not yet resolved) falls back to the book's ROOT rather than guessing a
  // `{ver}/apps/atlas.html` path that build may never have published.
  //
  // Structurally identical to `src/lib/release/docsUrl.ts`'s tested `atlasDocsUrl()` -- NOT
  // imported from it: this file must never import src/lib/release (tests/shell/shell-invariants
  // .test.ts's source-scan guard; see `releaseRestricted` just above for the same rule applied to
  // access itself).
  const docsHref = $derived(
    !earlyVersion || !currentVersionRow
      ? "https://marinesensitivity.org/docs/"
      : releaseRestricted
        ? `https://preview.marinesensitivity.org/docs/${earlyVersion}/apps/atlas.html`
        : `https://marinesensitivity.org/docs/${earlyVersion}/apps/atlas.html`,
  );

  // UI-16 (round 3, Opus 5.5 eyes-on review): the About modal's "What changed" used to link the
  // APP's own CHANGELOG.md (github.com/MarineSensitivity/atlas) -- the ATLAS CODE's history, not
  // the DATA release the person is actually looking at. Structurally identical to `docsHref` just
  // above (same public/restricted/unknown resolution, same "never import src/lib/release" rule),
  // one chapter path swapped -- `src/lib/release/docsUrl.ts#releaseNotesUrl` is the tested,
  // imported-from-a-test-only twin (`tests/release/docsUrl.test.ts`); this hand duplicate is what
  // `TopBarActions.svelte` actually renders.
  //
  // R3-rr fix 4 (Opus 5.5 eyes-on review round 3, second pass, 2026-09-25): this pointed at
  // `release_notes.html`, a 404 -- the docs book's chapter source is `releases.qmd`
  // (`docs/_quarto.yml`), which quarto renders to `releases.html`
  // (`docsUrl.ts#RELEASE_NOTES_CHAPTER_PATH`'s own header has the verification); `release_notes`
  // was the unrelated `data/release_notes.yml` data file's name, not the chapter's own filename.
  const releaseNotesHref = $derived(
    !earlyVersion || !currentVersionRow
      ? "https://marinesensitivity.org/docs/"
      : releaseRestricted
        ? `https://preview.marinesensitivity.org/docs/${earlyVersion}/releases.html`
        : `https://marinesensitivity.org/docs/${earlyVersion}/releases.html`,
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
  // kept as the anchor's plain `href` below: works with JS disabled/failed, and a middle-click /
  // "open in new tab" still lands on a sensible zero-backend issue link even though a plain left
  // click now opens the dialog instead (onclick below always preventDefault()s it).
  const feedbackHref = $derived(feedbackIssueUrl(feedbackCtx));

  // U3: the resolved release's `access` field, read off the SAME `versions` rows the release
  // picker already resolves (above) -- never `src/lib/release/access.ts`'s `accessOf()`
  // (tests/shell/shell-invariants.test.ts: this file may not import from ../lib/release at all).
  // Only the literal "restricted" ever matters to the dialog (payload.ts's own contract).
  const releaseAccess = $derived(versions?.find((v) => v.ver === earlyVersion)?.access);

  // U3 (round 2): "Send feedback" -- the SAME action, now opening a real dialog
  // (src/lib/feedback/FeedbackDialog.svelte, lazy) instead of navigating straight to the GitHub
  // issue link above. `openFeedback()` is the ONE function every trigger calls (this deliverable's
  // brief) -- until U1 lands its own top-bar "Feedback" control, the existing bottom-left "Report a
  // problem" anchor below is the only caller; U1 wires a second one to the same function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let FeedbackDialogComp = $state<Component<any> | null>(null);
  let feedbackOpen = $state(false);
  // snapshotted at the moment the control is used, never read reactively -- the hash is not
  // tracked anywhere else in this file (nothing needs it continuously; the dialog only needs the
  // value AS OF when it opens). Shell.svelte is allowed to read `location.hash` directly (the ban
  // is on src/lib/feedback/** doing so -- see FeedbackDialog.svelte's own header); this is the
  // exact same pattern `feedbackCtx.pageUrl` above already uses for `location.origin`/`.pathname`.
  let feedbackHash = $state("");
  function openFeedback(): void {
    feedbackHash = location.hash;
    feedbackOpen = true;
    if (!FeedbackDialogComp) {
      import("../lib/feedback/FeedbackDialog.svelte")
        .then((mod) => (FeedbackDialogComp = mod.default))
        .catch(() => announceChunkFailure("the feedback dialog"));
    }
  }

  // --- lazy lens/panel chunks (atlas-4 fix round 2, D13) ----------------------------------------
  // Shell.svelte used to statically import every lens' panel component (ScoresLens,
  // SpeciesLensPanel/Picker/Legend/NotFoundModal, Places, VersionPickerModal, WelcomeModal) --
  // 450.4 KB gzip static, 0.4 KB over budget, and a species-only deep link downloaded the ENTIRE
  // scores lens it never renders. Each becomes its own dynamic `import()` chunk, chosen by
  // `sel.lens` (Places by `activeTool === "report"` instead, R3-W8 item 5 -- it mounts on either
  // lens, as the Report pane's own default tab). This is
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
  // Q1 (atlas-8 P-round, 2026-09-24): the top-bar search field's Scores-lens content (Program Area
  // + coordinate search, `search.ts`/`ScoresSearch.svelte`) -- lazy like every other scores chunk
  // below, so a species-only session never downloads it (`tests/shell/lazy-lens-imports.test.ts`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ScoresSearchComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesLensPanelComp = $state<Component<any> | null>(null);
  // owner review item 7 (live 0.10.62): the species lens' "Table" tool body -- lazy ON-DEMAND
  // (activeTool==="table", below), same convention as PlacesComp/ReportToolComp, not part of the
  // eager species-UI-group effect further down (a species session that never opens Table should
  // not download it).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesInputsTableComp = $state<Component<any> | null>(null);
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
  // P1 (Opus eyes-on assessment, 2026-09-24): the phone-only search modal's own lazy chunk --
  // loaded on first tap of the phone search button (below), the same "load on first open" idiom
  // PlacesComp/ReportToolComp already use, rather than a preemptive `$effect` -- a phone visitor
  // who never opens search never pays for it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ModalComp = $state<Component<any> | null>(null);
  let phoneSearchOpen = $state(false);
  let phoneSearchBodyEl: HTMLDivElement | undefined = $state();

  // item m5 (atlas-8 review round 2): none of the dynamic imports below had a `.catch` -- a chunk
  // -load failure (a flaky network, an ad blocker, a stale service worker) left the promise
  // REJECTED with nothing handling it (an unhandled-rejection console error) and the target
  // `Comp` `$state` null FOREVER, with no word to the user why the lens/tool never rendered (the
  // 0.10.17 symptom, one layer up: back then it was `scoresLens` null from a different cause).
  // `announceChunkFailure()` tells the user; the guard needs no explicit "reset" beyond that --
  // `.then()` never runs on a rejection, so the `Comp`/`scoresLens` state stays null exactly as it
  // started, and the SAME `if (!Comp)` check already retries the next time this effect re-runs
  // (a lens/tool switch away and back, which re-reads `sel.lens`/`activeTool` -- both already this
  // effect's own trigger).
  function announceChunkFailure(what: string): void {
    notify(`Couldn't load ${what}. Try switching tools again.`, { tone: "error" });
  }

  // P1 (Opus eyes-on assessment, 2026-09-24): the topbar `.search-field` -- which also hosts the
  // species picker while the species lens is active -- is `topbar-desktop-only` (shell.css), and
  // the ⋯ menu had nothing in its place: a phone visitor could not search a place at all, and in
  // the species lens could not change species either. This opens the SAME content the desktop
  // field renders, as a near-full-width modal, focused on open. Modal.svelte's native <dialog>
  // `showModal()` only auto-focuses a descendant carrying `autofocus`, which neither the
  // SpeciesPicker's own input nor the plain stub one below sets -- so focus is moved by hand,
  // after `tick()` flushes both this component's OWN re-render (the lazy `ModalComp` arriving)
  // and Modal.svelte's own mount effect that calls `showModal()`.
  async function openPhoneSearch(): Promise<void> {
    phoneSearchOpen = true;
    if (!ModalComp) {
      try {
        const mod = await import("../lib/ui/Modal.svelte");
        ModalComp = mod.default;
      } catch {
        announceChunkFailure("search");
        phoneSearchOpen = false;
        return;
      }
    }
    await tick();
    phoneSearchBodyEl?.querySelector<HTMLInputElement>("input")?.focus();
  }

  function closePhoneSearch(): void {
    phoneSearchOpen = false;
  }

  $effect(() => {
    if (sel.lens !== "scores") return;
    if (!ScoresLensComp) {
      import("../lens/scores/ScoresLens.svelte")
        .then((mod) => (ScoresLensComp = mod.default))
        .catch(() => announceChunkFailure("the scores panel"));
    }
    // the floating legend (atlas-4 defect fix) -- its own chunk, same trigger as the panel's, so
    // a scores deep link downloads both together rather than waiting on the panel to mount first.
    if (!ScoresLegendComp) {
      import("../lens/scores/ScoresLegend.svelte")
        .then((mod) => (ScoresLegendComp = mod.default))
        .catch(() => announceChunkFailure("the scores legend"));
    }
    // Q1: the top-bar search field's scores content -- same trigger as the two chunks above, so a
    // scores deep link/session has it ready by the time the field is first focused.
    if (!ScoresSearchComp) {
      import("../lens/scores/ScoresSearch.svelte")
        .then((mod) => (ScoresSearchComp = mod.default))
        .catch(() => announceChunkFailure("the scores search"));
    }
    // 0.10.21 fix 1 -- the scores lens' MAP-INPUT store, loaded (and instantiated) the SAME way as
    // the two chunks above, so it exists whenever `sel.lens === "scores"` regardless of whether
    // the panel/sheet has ever mounted `ScoresLensComp` (this is the actual fix; the panel chunk
    // above only owns UI). `boot`/`manifest` are read through getters so the lens always sees the
    // CURRENT value, the same reason `createSpeciesLens`'s own deps are getters (above).
    if (!scoresLens) {
      import("../lens/scores/state.svelte")
        .then((mod) => {
          scoresLens = mod.createScoresLens({
            selStore,
            boot: () => boot,
            manifest: () => manifest,
            // item M1's `handleMapClick` needs both, the same getters `createSpeciesLens` above
            // already reads for the identical reason: `ver`/`mapHandle` settle asynchronously,
            // after this call site runs.
            ver: () => earlyVersion,
            mapHandle: () => mapHandle,
            // P3 fix (Opus eyes-on review, 2026-09-24): `selectZone`'s bounds fit (search pick)
            // used a flat 40px padding, blind to the sheet/docked panel actually covering the map
            // — the SAME `currentChromePadding()` getter `createSpeciesLens` above already wires
            // for its own bounds fit (V1/V4 fixes).
            chromePadding: () => currentChromePadding(),
          });
        })
        .catch(() => announceChunkFailure("the scores map layer"));
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
      import("../lens/species/SpeciesLens.svelte")
        .then((mod) => (SpeciesLensPanelComp = mod.default))
        .catch(() => announceChunkFailure("the species panel"));
    }
    if (!SpeciesPickerComp) {
      import("../lens/species/SpeciesPicker.svelte")
        .then((mod) => (SpeciesPickerComp = mod.default))
        .catch(() => announceChunkFailure("species search"));
    }
    if (!SpeciesLegendComp) {
      import("../lens/species/SpeciesLegend.svelte")
        .then((mod) => (SpeciesLegendComp = mod.default))
        .catch(() => announceChunkFailure("the species legend"));
    }
    if (!NotFoundModalComp) {
      import("../lens/species/NotFoundModal.svelte")
        .then((mod) => (NotFoundModalComp = mod.default))
        .catch(() => announceChunkFailure("the species lens"));
    }
  });

  // R3-W8 item 5: Places folded into the Report pane as its own (default) tab -- loaded whenever
  // the Report tool opens, on EITHER tab, so the default "Places" tab never shows a blank flash
  // while its chunk is still in flight the first time a viewer opens Report at all.
  $effect(() => {
    if (activeTool === "report" && !PlacesComp) {
      import("../places/Places.svelte")
        .then((mod) => (PlacesComp = mod.default))
        .catch(() => announceChunkFailure("the Places panel"));
    }
  });

  $effect(() => {
    if (activeTool === "report" && !ReportToolComp) {
      import("./ReportTool.svelte").then((mod) => (ReportToolComp = mod.default));
    }
  });

  // owner review item 7 (live 0.10.62): loaded only once the species lens' Table tool is actually
  // opened -- same on-demand convention as places/report above.
  $effect(() => {
    if (sel.lens === "species" && activeTool === "table" && !SpeciesInputsTableComp) {
      import("../lens/species/SpeciesInputsTable.svelte")
        .then((mod) => (SpeciesInputsTableComp = mod.default))
        .catch(() => announceChunkFailure("the species inputs table"));
    }
  });

  $effect(() => {
    if (!VersionPickerModalComp) {
      import("../lens/scores/VersionPickerModal.svelte")
        .then((mod) => (VersionPickerModalComp = mod.default))
        .catch(() => announceChunkFailure("the release picker"));
    }
  });

  $effect(() => {
    if (!WelcomeModalComp) {
      import("../lens/scores/WelcomeModal.svelte")
        .then((mod) => (WelcomeModalComp = mod.default))
        .catch(() => announceChunkFailure("the welcome dialog"));
    }
  });
</script>

<!-- spec.md §11: the shell's ONE polite live region (SC 4.1.3) -- every component (Rail's
     onAnnounce below, this file's own onShare/onHelp/onVersionClick, Honeycomb's own on-mount
     announcement) calls the shared `announce()` from src/lib/ui/announcer.ts; nothing else in the
     shell renders a region of its own. Mounted FIRST (document order governs onMount order): the
     honeycomb loader (below, inside `.stage`) announces "Map loading" in ITS OWN onMount, and a
     pub-sub subscriber that mounts AFTER a publisher's first call misses it -- announcer.ts's
     `getLastAnnouncerMessage()` covers a LATE mount reading history, never an announce() that
     fires before ANYONE has subscribed at all. -->
<Announcer />

<!-- UI-1 (round 3, Opus 5.5 eyes-on review): "the visible toast component exists but the app never
     mounts it" -- about 60 announce()-only messages (Share's copy confirmation, pick-mode on/off,
     draw hints, every "couldn't..." error) reached only a screen reader. ONE instance here
     (report.html mounts its own, separately -- see Report.svelte); every `notify()` call
     (announcer.ts) reaches it via `toastQueue.ts#subscribeToastPush`, no `bind:this` needed.
     `toastPhoneBottomOffsetPx` (script block) is the SAME "rail row + sheet's real height while
     floating, else just the rail row" formula `.map-attribution`/`.legend-chip-region` already use
     (shell.css) -- "the toast must never cover the phone sheet's buttons or the legend chip" --
     passed as a PROP (Toast.svelte sets it on its own root), never a wrapping `<div>`: an extra
     static block element ahead of the top bar, even with a `position: fixed` child, was found (real
     Playwright run) to intercept pointer events across the WHOLE page -- `elementFromPoint`
     resolved to `#shell.app` itself, nowhere near any toast, and every rail/panel click timed out. -->
<Toast phoneBottomOffsetPx={toastPhoneBottomOffsetPx} />

<header class="topbar" data-tour="topbar">
  <span data-tour="brand" style="display:flex;align-items:center;gap:var(--space-2)">
    <WaveHexMark size={28} />
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
    <!-- D13 (Opus eyes-on assessment, 2026-09-24): the chevron ("version" -> mdiChevronDown, an
         alias, icon-paths.ts) used to render FIRST, so it sat to the LEFT of "v7" -- every other
         select-like control in the app (Select.svelte, the native Layer select) puts its chevron
         AFTER the value, on the right. Text first, chevron last matches that convention; the
         accessible name (this button's flattened text content, including the visually-hidden span
         below) is unaffected by visual order. -->
    <VersionBadge />
    <Icon name="version" size={14} />
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
    {:else if sel.lens === "scores" && ScoresSearchComp && scoresLens}
      <!-- Q1 (owner-reported defect, live 0.10.50): this used to be the SAME plain stub `<input>`
           the final fallback below still is for every other lens -- typing here did nothing at
           all. `scoresLens` (Shell.svelte's own lazily-created `createScoresLens()` instance, see
           the `$effect` above) supplies the map/selection wiring; this field just resolves a match
           into a `selectZone`/`selectCoordinate` call. -->
      {@const SearchComp = ScoresSearchComp}
      <SearchComp
        {boot}
        onSelectZone={(unit: string, key: string) => scoresLens?.selectZone(unit, key)}
        onSelectCoord={(lon: number, lat: number) => void scoresLens?.selectCoordinate(lon, lat)}
        onSelectRegion={(key: string) => scoresLens?.selectRegion(key)}
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

  <!-- owner review item 5 (live 0.10.62, "let's drop words but add tooltip on hover: Share, Help,
       Feedback, Info"): icon-only, matching Help/About/Theme's existing convention -- `aria-label`
       keeps the SAME accessible name the visible text used to give (keyboard/screen-reader users
       see no change), and `data-tooltip` (shell.css) draws a hover/focus tooltip with the same
       text, CSS-only (no JS state), so it shows in a plain headless screenshot too. -->
  <!-- owner review item 3 (live 0.10.62, "Drop Report from upper right utility menu, since
       duplicative with left toolbar"): the desktop Report button (data-control report-top, no
       longer a real attribute anywhere in this file -- tests/shell/shell-invariants.test.ts scans
       for the literal `attr="value"` text, so this comment deliberately never spells it that way)
       that used to sit here is REMOVED -- the rail's own Report tool (data-tour rail-report,
       tour.ts) and the phone ⋯ menu's Report item (TopBarActions.svelte, unchanged) both stay. -->
  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="share"
    data-control="share"
    aria-label="Share"
    data-tooltip="Share"
    onclick={onShare}
  >
    <Icon name="share" size={18} />
  </button>
  <!-- R3-W2: Download -- PNG/SVG of the current map view, GeoTIFF of the current data layer,
       GeoJSON of the current places selection. Lazy (see DownloadMenu.svelte's own header + this
       file's `openDownload()`): until the first click, this is a cheap static placeholder button
       carrying the real `data-tour`/`data-control`/`data-tooltip` (so the skeleton/hydrated
       round-trip and `tests/shell/shell-invariants.test.ts` see it exactly as they do Share);
       DownloadMenu.svelte's OWN `<Menu>`-driven button takes over once loaded, opening itself
       immediately via `autoOpen` so the click that triggered the import is not lost. See that
       file's own header for why the phone route is a Modal (TopBarActions.svelte's "Download…"
       item) rather than a nested Menu. -->
  {#if DownloadMenuComp}
    {@const Comp = DownloadMenuComp}
    <Comp
      bind:this={downloadMenuRef}
      autoOpen={downloadAutoOpen}
      lens={sel.lens}
      ver={earlyVersion}
      {mapHandle}
      {boot}
      title={downloadTitle}
      description={downloadDescription}
      unit={downloadUnit}
      metricOrMdlKey={downloadMetricOrMdlKey}
      cogUrl={downloadCogUrl}
      cogDisabledReason={downloadCogDisabledReason}
      legendStops={downloadLegendStops}
      places={downloadPlaces}
      track={(name, params) => analytics.track(name as never, params as never)}
    />
  {:else}
    <button
      type="button"
      class="tool topbar-desktop-only"
      data-tour="download"
      data-control="download"
      aria-label="Download"
      data-tooltip="Download"
      aria-haspopup="menu"
      aria-expanded="false"
      onclick={() => openDownload("desktop")}
    >
      <Icon name="download" size={18} />
    </button>
  {/if}
  <!-- U6 (round 2): the (?) Help menu -- tour, keyboard shortcuts, a docs link. Always rendered
       (never {#if helpOpen}), toggled with `hidden`, so `aria-controls` on the trigger names an
       element that actually EXISTS in the DOM (SC 4.1.2) -- Popover.svelte's identical fix. -->
  <!-- "topbar-desktop-only" on the WRAPPER too, not just the button inside it -- the skeleton
       (index.html) has no wrapping element around the help tool at all, so at phone width it
       contributes NOTHING to the topbar's flex layout. Without this class here, the wrapper stayed
       `display:inline-flex` (its child hidden, but the span itself still a flex ITEM), adding one
       extra gap the skeleton never has -- the CLS geometry-equality gate's phone-only mismatch.
       R2's phone ⋯ menu (below) therefore does NOT reuse this disclosure at phone width (it would
       be invisible, hidden along with this whole wrapper) -- its own "Help" item opens the docs
       link directly instead (`helpDocsHref`), a simpler but fully phone-visible equivalent. -->
  <span class="help-wrap topbar-desktop-only">
    <button
      type="button"
      class="tool topbar-desktop-only"
      data-tour="help"
      data-control="help"
      aria-expanded={helpOpen}
      aria-controls="help-menu"
      aria-label="Help"
      data-tooltip={helpOpen ? undefined : "Help"}
      bind:this={helpTriggerEl}
      onclick={onHelp}
    >
      <Icon name="help" size={18} />
    </button>
    <!-- an ordinary disclosure region (About.svelte's own aria-expanded/aria-controls pattern),
         NOT role="menu" -- a real ARIA menu widget promises arrow-key/Home/End roving focus this
         does not implement, which would be a WORSE a11y contract than none at all. Tab/Shift+Tab
         reaches "Take a tour" then "Docs" in document order, same as any other disclosure.
         role="group" (axe: aria-prohibited-attr -- a plain <div> has no role that permits
         aria-label at all; "group" is the same role the panel-size control group already uses). -->
    <div
      class="help-menu"
      id="help-menu"
      role="group"
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
          <!-- UI-16 fix (round 3, Opus 5.5 eyes-on review): "lists '= — zoom the map in' but no
               zoom-out key" -- MapLibre's own default keyboard handler binds "-" (zoom out)
               alongside "="/"+" (zoom in); only the in-key was ever documented here. -->
          <li>- — zoom the map out</li>
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
  <!-- P1 (Opus eyes-on assessment, 2026-09-24): the desktop `.search-field` above is
       `topbar-desktop-only`, and nothing replaced it in the ⋯ menu -- a phone visitor could not
       search a place, nor (in the species lens) change species, at all. This phone-only button
       sits right beside the ⋯ trigger below (Feedback/About, TopBarActions.svelte's own first two
       controls, are themselves `topbar-desktop-only`, so nothing else renders between them at
       this width) and opens the SAME search content in a modal -- see `openPhoneSearch`'s own
       header comment. Desktop never renders this (`topbar-phone-only`, the same class the ⋯
       trigger itself carries). -->
  <button
    type="button"
    class="tool topbar-phone-only"
    data-tour="search-phone"
    data-control="search-phone"
    aria-label="Search species and places"
    onclick={openPhoneSearch}
  >
    <Icon name="search" size={18} />
  </button>
  <!-- R2 (docs/usability.md §7): About + Feedback + the phone ⋯ menu -- ONE mount line, per this
       round's own instructions (U5/U6 touch the rail and Report/Help/theme in parallel; see
       TopBarActions.svelte's header for why this stays a separate component). Its "Docs" item
       opens `docsHref` directly (`helpDocsHref`) rather than toggling the desktop Help disclosure
       just above, which is `topbar-desktop-only` and so invisible at the width the ⋯ menu itself
       only exists at -- see that disclosure's own comment. R2 round 2: its "Take a tour" item runs
       the SAME `onHelpTakeTour` the desktop Help menu's own button does (below) -- `closeHelp(false)`
       is a no-op when the desktop disclosure was never open, so this reuses that one function
       unchanged rather than wrapping it. -->
  <TopBarActions
    {earlyVersion}
    restricted={releaseRestricted}
    releaseStatus={currentVersionRow?.status ?? null}
    releaseDate={currentVersionRow?.released ?? null}
    appVersion={__APP_VERSION__}
    {feedbackHref}
    onFeedbackClick={openFeedback}
    {onShare}
    helpDocsHref={docsHref}
    {releaseNotesHref}
    onTakeTour={onHelpTakeTour}
    {resolvedTheme}
    onToggleTheme={toggleTheme}
    onOpenDownload={() => openDownload("phone")}
  />
  <!-- U2a (round 2): sun/moon, CalCOFI's convention (src/App.tsx's `.cc-theme-toggle`) -- the
       icon shown is the DESTINATION theme (a sun while dark invites switching to light, a moon
       while light invites switching to dark), and the accessible name states the action in ONE
       vocabulary (light/dark -- the URL's own words, docs/usability.md p3), never "navy"/"paper"
       (those stay internal token-set names only). R3-W2 fix (R3-B12): mdiBrightness7/mdiBrightness4
       read as a settings gear at 18px (the castellated ring both share) -- swapped for
       mdiWhiteBalanceSunny/mdiMoonWaningCrescent (icon-map.json), unambiguous sun/moon glyphs with
       no gear-like frame. Both pairs are Apache-2.0 (@mdi/js, already a project dependency -- see
       LICENSE.md / node_modules/@mdi/js/LICENSE).
       P5 fix round 2 (coordinator finding, 390px eyes-on evidence): this used to be the ONE
       control with no `topbar-desktop-only` -- with the new P1 search button added beside ⋯, the
       phone topbar's fixed content (mark hidden already, lens switch, search, ⋯, theme) no longer
       fit at 390px OR 360px: this button's own right edge landed ~20px/~2px past the viewport.
       `topbar-desktop-only` here, and a "Switch to light/dark theme" item in the ⋯ menu
       (TopBarActions.svelte, same as Feedback/About's own phone route) reclaims exactly one
       button's width instead of shaving pixels off every other control. -->
  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="theme"
    data-control="theme"
    aria-label={resolvedTheme === "navy" ? "Switch to light theme" : "Switch to dark theme"}
    onclick={toggleTheme}
  >
    <Icon name={resolvedTheme === "navy" ? "themeSun" : "themeMoon"} size={18} />
  </button>
</header>

<main
  class="stage"
  id="stage"
  data-panel-dock={isPhone ? undefined : panelGeom.dock}
  data-panel-maximized={isPhone ? undefined : panelGeom.maximized}
  style={isPhone ? undefined : `--panel-size: ${panelGeom.size}px`}
>
  <!-- P round 2 fix (CI run 36070452831, Ben's report): this used to render OUTSIDE `.stage`, a
       `position: fixed` overlay pinned to the viewport's top edge -- which put it ON TOP of
       `.topbar` (z-index 20) and intercepted every click meant for a topbar control underneath
       (feedback, the lens switch, ⋯, Help > Docs, theme). Moved inside `.stage` (below the topbar
       ENTIRELY -- they are separate CSS Grid rows in `.app`, shell.css, so one can never cover the
       other) and scoped to `.stage`'s own box (HealthBanner.svelte's `position: absolute`, not
       `fixed`): the map may be overlapped, but the topbar/rail/panel/sheet/tab bar never are. -->
  <HealthBanner
    banner={health.banner}
    onretry={() => health.banner && health.retry(health.banner.def.id)}
  />
  <!-- D1 (Opus eyes-on assessment, 2026-09-24): `data-panel-dock`/`data-panel-maximized`/
       `--panel-size` above mirror `panelGeom` the SAME way `#panel-region` itself already does
       (its own comment just below) -- ScoresLegend.svelte/SpeciesLegend.svelte read them off THIS
       ancestor (`.stage`, their own positioned parent) to keep the floating legend clear of
       whichever corner the docked panel currently fills; see those two files' own header comments
       for why the legend used to render invisibly under it. -->
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

  <!-- usability M4: a light loader until the first raster/basemap tile paints (8-21s measured,
       previously with no indicator at all) -- `pointer-events: none` (shell.css) so it never
       blocks a click meant for the map underneath, and being `position: absolute` it never shifts
       a sibling box when it appears/disappears (the shell.cls CLS budget is about elements that
       MOVE, not ones added/removed on top of an unrelated canvas). -->
  {#if mapLoading}
    <div class="map-loading-overlay" data-testid="map-loading">
      <Honeycomb label="Map loading" announceOnMount={false} />
    </div>
  {/if}
  <!-- this loader's OWN dedicated live region (see `hideMapLoader`'s own header for why it is not
       the shared one `src/lib/ui/announcer.ts` provides) -- `data-testid`, not a bare
       `[role="status"]` selector, so a spec can target it unambiguously alongside the SHARED
       Announcer region, which carries the identical role. -->
  <div class="visually-hidden" role="status" aria-live="polite" data-testid="map-loading-status">
    {mapLoadingStatus}
  </div>

  <!-- map-chrome parity audit (2026-09-24): `attributionControl: false` (map.ts) means MapLibre
       injects nothing itself -- Shiny shows "MapLibre | © CARTO, © OpenStreetMap contributors" on
       the map and the Atlas showed neither. DECISION: a labelled region OUTSIDE `#map`, never a
       MapLibre-injected in-map control -- `#map` carries `role="img"` (a leaf image role; ARIA
       forbids a role=img element having any accessible descendants at all, controls included), so
       an attribution control living INSIDE it would itself be an axe violation. A plain sibling
       `<div>` in `.stage`, always visible (no interaction needed, per the audit's own ask), keeps
       `#map` clean. `BASEMAP_ATTRIBUTION` is the SAME string composeStyle()'s own basemap input
       carries (layers/basemap.ts) -- never a second, hand-typed copy of the CARTO/OSM credit. -->
  <div
    class="map-attribution"
    role="group"
    aria-label="Map data attribution"
    data-testid="map-attribution"
    style={`--legend-chip-sheet-height: ${
      legendChipMode(sheetGeom.detent) === "floating" ? sheetGeom.height : 0
    }px`}
  >
    <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>
    <span aria-hidden="true">|</span>
    {BASEMAP_ATTRIBUTION}
  </div>

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
       `tabindex="-1"` remedy as #rail-region above, for the same reason.
       R1: `data-dock`/`data-maximized`/`--panel-size` mirror Panel.svelte's own reported geometry
       (`panelGeom`, above) -- shell.css's `.panel-region[data-dock=...]`/`[data-maximized]` rules
       read them. Absent on the phone (Panel never mounts there; Sheet.svelte keeps its own
       detents), which is also why the desktop-only CSS rules never need an `isPhone` guard of
       their own. -->
  <!-- P1 fix: declared here, as a sibling of BOTH `#panel-region` (below) and the floating legend
       region (further below, after `#panel-region` closes) -- a snippet is only in scope within
       the block it is declared in, so it has to live at THIS level to be referenced from both
       `<Sheet>`'s `headerExtra` prop (inside `#panel-region`) and the floating placement (a
       sibling of `#panel-region`, outside it). Exactly one `<LegendChip>` instance exists no
       matter which placement is active -- switching between them (the sheet crossing the "full"
       boundary) unmounts/remounts it, which simply closes an open modal rather than leaving two
       chips live at once. -->
  {#snippet legendChipContent()}
    {#if phoneLegend}
      <LegendChip title={phoneLegend.title} description={phoneLegendDescription}>
        {#if sel.lens === "species" && SpeciesLegendComp}
          {@const Comp = SpeciesLegendComp}
          <Comp legend={phoneLegend} tilesDown={health.isDown("tiler")} />
        {:else if sel.lens === "scores" && ScoresLegendComp}
          {@const Comp = ScoresLegendComp}
          <Comp legend={phoneLegend} tilesDown={health.isDown("tiler")} />
        {/if}
      </LegendChip>
    {/if}
  {/snippet}
  <div
    class="panel-region"
    id="panel-region"
    tabindex="-1"
    data-tour="panel"
    data-control="panel"
    data-dock={isPhone ? undefined : panelGeom.dock}
    data-maximized={isPhone ? undefined : panelGeom.maximized}
    style={isPhone ? undefined : `--panel-size: ${panelGeom.size}px`}
  >
    <!-- the ONE panel body: report (which now includes Places as its default tab, item 5) owns its
         tool on either lens; otherwise the active lens decides what the tool's panel shows (the
         scores lens takes every tool and falls back to the tool's own text; the species lens takes
         "layers" only). -->
    {#snippet panelBody()}
      {#if activeTool === "report"}
        <!-- R3-W8 item 5: "Places folds into the Report tool as its first tab." "Places" (today's
             Places.svelte, unchanged behaviour) is the DEFAULT tab; "Report" is today's
             ReportTool.svelte. U6 (round 2)'s own note still applies: intercepted here, BEFORE the
             lens branches below, so this is the SAME panel on either lens. -->
        {#snippet placesContent()}
          {#if PlacesComp}
            {@const Comp = PlacesComp}
            <!-- P round deliverable 2 follow-up: `manifest` threads down to ResultsPanel.svelte's
                 own Flower (the SAME flowerMaxComponentScore(manifest) the scores lens' Flower tab
                 uses), so a custom place's/zone's flower ring is never a second, disagreeing
                 source. -->
            <Comp {sel} {selStore} {boot} {manifest} {mapHandle} {zoneUnits} mapStore={placesMap} />
          {:else}
            <p>Select, draw and upload tools arrive in a later phase.</p>
          {/if}
        {/snippet}
        {#snippet reportContent()}
          {#if ReportToolComp}
            {@const Comp = ReportToolComp}
            <Comp
              {sel}
              {boot}
              ver={earlyVersion}
              onOpenPlaces={() => (activeReportTab = "places")}
            />
          {:else}
            <p>The report builder arrives in a later phase.</p>
          {/if}
        {/snippet}
        <ReportPane
          {activeReportTab}
          onActiveReportTabChange={(t) => (activeReportTab = t)}
          places={placesContent}
          report={reportContent}
        />
      {:else if sel.lens === "species" && activeTool === "layers"}
        {#if SpeciesLensPanelComp}
          {@const Comp = SpeciesLensPanelComp}
          <!-- P round deliverable 1 / orchestrator hand-off (2026-09-25): `boot` used to feed
               SpeciesLens.svelte's own disabled "Raster cells | Program Areas" toggle -- that
               toggle is now HIDDEN for species entirely (there is no spatial-unit CHOICE to make
               in this lens), so `boot` is unused there today; kept as a prop rather than a second
               Shell.svelte branch dropping it (SpeciesLens.svelte's own header explains why).
               R3 deliverable 6/7: `sel`/`selStore`/`mapHandle` are new here -- the shared panel's
               "Outlines" and "Sphere" rows are lens-independent (`Sel.out`/`Sel.proj`), and this
               lens previously had no reason to read either. -->
          <Comp
            lens={speciesLens}
            rep={sel.rep}
            {layerStack}
            {onLayerStackChange}
            {boot}
            {sel}
            {selStore}
            {mapHandle}
            {expandedRow}
            onExpandedRowChange={(id: LayerGroupId | null) => (expandedRow = id)}
            tab={activeTab}
            onTabChange={(t: UiTab) => (activeTab = t)}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if sel.lens === "species" && activeTool === "table"}
        <!-- owner review item 7 (live 0.10.62): the placeholder text below used to be the WHOLE
             body here ("The species and zone tables arrive in a later phase.") -- now the selected
             model's own inputs, reshaped from the SAME `speciesLens.bar` the layer bar already
             computes (SpeciesInputsTable.svelte's own header). -->
        {#if SpeciesInputsTableComp}
          {@const Comp = SpeciesInputsTableComp}
          <Comp
            bar={speciesLens.bar}
            loading={speciesLens.loading}
            cardError={!!speciesLens.cardError}
          />
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
            {layerStack}
            {onLayerStackChange}
            compactFlower={isPhone && sheetGeom.detent === "half"}
            {expandedRow}
            onExpandedRowChange={(id: LayerGroupId | null) => (expandedRow = id)}
            tab={activeTab}
            onTabChange={(t: UiTab) => (activeTab = t)}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else}
        <p>{TOOL_BODY[activeTool]}</p>
      {/if}
    {/snippet}
    {#if isPhone}
      <Sheet
        id="shell"
        title={panelTitle}
        ongeometry={(g) => (sheetGeom = g)}
        headerExtra={phoneLegend && legendChipMode(sheetGeom.detent) === "inline"
          ? legendChipContent
          : undefined}
        initialDetentOverride={initialUi?.detent ?? null}
      >
        {@render panelBody()}
      </Sheet>
    {:else}
      <Panel
        id="shell"
        title={panelTitle}
        bind:this={panelRef}
        ongeometry={(g) => (panelGeom = g)}
        initialGeometryOverride={initialUi ? { dock: initialUi.dock, size: initialUi.size } : null}
      >
        {@render panelBody()}
      </Panel>
    {/if}
  </div>

  <!-- atlas-4 defect fix, R2 (usability M14): ONE floating "lens legend" region, keyed on
       `sel.lens` -- spec.md's "one legend on screen at a time". Species used to be the only lens
       with a floating legend at all; the scores lens' copy used to live INSIDE LayersPanel.svelte
       (only visible with that tool open, and never for the zone-choropleth branch) -- both
       branches render here, lazy, the same way every other lens component in this file is. On the
       phone the desktop-only floating legends (`display:none` below 900px, "no room beside the
       sheet") are replaced by ONE compact chip (LegendChip.svelte) sharing the SAME legend object
       -- `isPhone` gates the two branches, so exactly one ever renders, never both.

       P1 fix (Ben's phone report, 2026-09-24): the chip used to float here at a FIXED offset
       regardless of the sheet's detent, which put it on top of the sheet's own header controls at
       "peek" and the last table row at "half"/"full". It now only floats here while
       `legendChipMode` says "floating" (peek/half, or any future drag-resized height in between
       -- see sheetGeometry.ts); at "full" it moves INSIDE the sheet instead (`headerExtra`,
       above), so this region renders nothing then. `--legend-chip-sheet-height` (read by
       shell.css's `.legend-chip-region`) is the sheet's REAL measured height (`sheetGeom.height`),
       so the chip tracks the sheet's actual top edge -- the CSS fallback (`0px`, shell.css) is
       what "no sheet mounted yet" degrades to, the same position the chip has always had. -->
  {#if isPhone}
    {#if phoneLegend && legendChipMode(sheetGeom.detent) === "floating"}
      <div class="legend-chip-region" style={`--legend-chip-sheet-height: ${sheetGeom.height}px`}>
        {@render legendChipContent()}
      </div>
    {/if}
  {:else if sel.lens === "species" && SpeciesLegendComp}
    {@const Comp = SpeciesLegendComp}
    <div class="lens-legend-region">
      <Comp legend={speciesLens.mapInputs.legend} tilesDown={health.isDown("tiler")} />
    </div>
  {:else if sel.lens === "scores" && ScoresLegendComp}
    {@const Comp = ScoresLegendComp}
    <div class="lens-legend-region">
      <Comp legend={scoresLens?.mapExtra.legend ?? null} tilesDown={health.isDown("tiler")} />
    </div>
  {/if}
</main>

{#if FeedbackDialogComp}
  {@const Comp = FeedbackDialogComp}
  <Comp
    open={feedbackOpen}
    onclose={() => (feedbackOpen = false)}
    ver={earlyVersion}
    access={releaseAccess}
    lens={sel.lens}
    appVersion={__APP_VERSION__}
    appSha={__APP_SHA__}
    viewport={`${viewportW}x${viewportH}`}
    theme={resolvedTheme}
    userAgent={typeof navigator === "undefined" ? "" : navigator.userAgent}
    pageUrl={feedbackCtx.pageUrl}
    hash={feedbackHash}
    track={(name: string, params: Record<string, unknown>) =>
      analytics.track(name as never, params as never)}
  />
{/if}

{#if NotFoundModalComp}
  {@const Comp = NotFoundModalComp}
  <Comp
    open={speciesLens.notFound !== null}
    reasons={speciesLens.notFound?.reasons ?? []}
    onclose={() => speciesLens.dismissNotFound()}
  />
{/if}

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
  <Comp
    tour={sel.tour}
    onTakeTour={() => void beginTour()}
    onSwitchToSpecies={() => onLensChange("species")}
    {docsHref}
    ver={earlyVersion}
  />
{/if}

<!-- P1 (Opus eyes-on assessment, 2026-09-24): the phone-only search modal -- see
     `openPhoneSearch`'s own header comment above. Content mirrors the desktop `.search-field`
     exactly (same SpeciesPickerComp instance/props in the species lens, the same plain stub input
     otherwise), just laid out for the modal's own width/touch target (`.search-field-phone` /
     `.search-field-phone-input`, shell.css) instead of the topbar's fixed 32px pill.

     `search-field-phone--species` (species lens only): eyes-on evidence caught Modal.svelte's
     `.modal-body { overflow: auto }` -- entirely reasonable for ordinary text content -- clipping
     SpeciesPicker's own results list, which is `position: absolute` (so it contributes NOTHING to
     the dialog's natural, content-driven height): the dialog shrank to the search row's own ~50px
     and the dropdown rendered past that box's bottom edge. A first fix (a fixed min-height guess)
     still let it render past the dialog's own bottom edge on review -- shell.css's own
     `.search-field-phone--species .picker-dropdown` override forces it into NORMAL FLOW instead
     (`position: static`), so the dialog's real height always includes it, growing/scrolling
     (`.modal-body`'s own `overflow: auto`) to hold whatever it actually is, not a guessed number. -->
{#if ModalComp}
  {@const ModalC = ModalComp}
  <ModalC open={phoneSearchOpen} title="Search" onclose={closePhoneSearch}>
    <div
      class="search-field-phone"
      class:search-field-phone--species={sel.lens === "species"}
      class:search-field-phone--scores={sel.lens === "scores"}
      bind:this={phoneSearchBodyEl}
    >
      <Icon name="search" size={16} />
      <div class="search-field-phone-control">
        {#if sel.lens === "species" && SpeciesPickerComp}
          {@const PickerComp = SpeciesPickerComp}
          <PickerComp
            index={speciesLens.taxaIndex}
            selected={sel.sp}
            usOnly={sel.us}
            onSelect={(key: string) => {
              speciesLens.selectSpecies(key);
              closePhoneSearch();
            }}
            onSetUsOnly={(enabled: boolean) => speciesLens.setUsOnly(enabled)}
            onSearchLogged={(query: string) => analytics.track("search_species", { query })}
            onFocusIndex={() => speciesLens.ensureTaxaIndex()}
          />
        {:else if sel.lens === "scores" && ScoresSearchComp && scoresLens}
          <!-- Q1: the SAME content as the desktop field above, closing the modal once a result is
               picked (mirrors the species branch's own `closePhoneSearch()` call). -->
          {@const SearchComp = ScoresSearchComp}
          <SearchComp
            {boot}
            onSelectZone={(unit: string, key: string) => {
              scoresLens?.selectZone(unit, key);
              closePhoneSearch();
            }}
            onSelectCoord={(lon: number, lat: number) => {
              void scoresLens?.selectCoordinate(lon, lat);
              closePhoneSearch();
            }}
            onSelectRegion={(key: string) => {
              scoresLens?.selectRegion(key);
              closePhoneSearch();
            }}
          />
        {:else}
          <input
            type="search"
            class="search-field-phone-input"
            aria-label="Search species and places"
            placeholder="Search species and places"
          />
        {/if}
      </div>
    </div>
  </ModalC>
{/if}
