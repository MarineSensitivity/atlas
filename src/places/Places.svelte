<script lang="ts">
  // atlas-6 step 1: the Places panel (Deliverable 1) + pick mode (Deliverable 2, Tier 0 -- zone
  // places only; draw/upload/results land in later steps' commits and extend this same file). Core
  // logic lives in the plain modules beside this component (model.ts, zoneStats.ts, recents.ts,
  // camera.ts, pick.ts, pickInstall.ts, zoneOutline.ts, download.ts) -- this file only renders their
  // output and wires events, per CLAUDE.md ("keep core logic in an exported function ... a
  // component just calls it").
  //
  // Every place mutation goes through `selStore.set({ pl: hashFromPlaces(next) })` -- NEVER a local
  // copy of the list -- so `#pl=` and what's rendered can never disagree (CLAUDE.md
  // "URL-is-the-view"). Status text goes through the shell's ONE shared `announce()`; this
  // component renders no live region of its own (e2e/shell.a11y.spec.ts's "exactly one live region"
  // walk clicks through every rail tool, including this one).
  import { onDestroy, onMount } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Pill from "../lib/ui/Pill.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import Accordion from "../lib/ui/Accordion.svelte";
  import Select from "../lib/ui/Select.svelte";
  import { announce } from "../lib/ui/announcer";
  import { encodePlace, type Place } from "../lib/geo/placeCodec";
  import type { Sel } from "../lib/state/types";
  import type { SelStore } from "../lib/state/sel.svelte";
  import type { MapHandle } from "../lib/map/map";
  import type { ZoneUnitSpec } from "../lib/map/types";
  import type { PlacesMapStore } from "./placesMap.svelte";
  import {
    addPlace,
    addZonePlace,
    duplicatePlaceAt,
    fallbackZoneLabel,
    featureCollectionOf,
    hashFromPlaces,
    isGeomOrUpload,
    MAX_PLACES,
    placesFromHash,
    removePlaceAt,
    renamePlaceAt,
    reportHash,
    selectedPlaceIndex,
    unitForZoneSet,
    zoneSetForUnit,
  } from "./model";
  import {
    allZoneStats,
    paLabel,
    summarizeZoneStats,
    zoneCellsAvailable,
    zoneCenterFromBoot,
    zoneDisplayName,
    zoneStatsFor,
    ZONE_CELLS_UNAVAILABLE_REASON,
  } from "./zoneStats";
  import { approxAreaKm2 } from "./area";
  import { centerZoomForGeometry } from "./camera";
  import { clearPick, type PickState } from "./pick";
  import { installPickMode, type PickMapLike, type PickModeHandle } from "./pickInstall";
  import { renderedZoneOutline, type RenderedFeatureMap } from "./zoneOutline";
  import { clearRecents, loadRecents, pushRecent, recentPlace } from "./recents";
  import { downloadGeoJson, placesToGeoJson } from "./download";
  import {
    createDrawSession,
    loadTerraDraw,
    type DrawSession,
    type DrawShape,
    type FeatureId,
    type TerraDrawModules,
  } from "./draw";
  import {
    drawFeaturePlaceIndex,
    emptyDrawFeatureIndex,
    withDrawFeature,
    withoutDrawPlace,
    type DrawFeatureIndex,
  } from "./drawFeatures";
  import { densifyGeometry } from "./densify";
  import { geomPlaceFrom } from "./geomPlace";
  import { cellsFeatureCollection, MAX_ANALYSIS_CELLS } from "./cellSquares";
  import CoordinateDialog from "./CoordinateDialog.svelte";
  import UploadPanel from "./UploadPanel.svelte";
  import ResultsPanel from "./ResultsPanel.svelte";
  import ShareDialog from "./ShareDialog.svelte";
  import { cellsInPolygon } from "../lib/geo/coverage";
  import { gridFromBoot } from "../lib/grid/grid";
  import { getDataEngine } from "./dataEngine";
  import {
    computeScoreResults,
    describeAnalysisError,
    placeCellsInStudyArea,
    placeRowAnalysis,
    type PlaceScoreState,
  } from "./results";
  import { noopTrack, placeDrawParams, placeShareParams, type Track } from "./analytics";
  import type { AreaGeometry } from "../lib/geo/types";
  import type { NormalizedPlace } from "../lib/geo/upload/normalize";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    mapHandle: MapHandle | undefined;
    zoneUnits: ZoneUnitSpec[];
    mapStore: PlacesMapStore;
    /** Deliverable 7: place_draw/place_upload/place_share, counts and buckets only. Defaults to a
     * no-op -- see analytics.ts's own header for why nothing here sends anything until the GA4
     * loader is wired app-wide. */
    track?: Track;
  }

  let { sel, selStore, boot, mapHandle, zoneUnits, mapStore, track = noopTrack }: Props = $props();

  const places = $derived(placesFromHash(sel.pl));
  const selectedIndex = $derived(selectedPlaceIndex(sel.sel));

  /**
   * The raw MapLibre `Map` (`docs/map.md`: "for `on`/`off` and `queryRenderedFeatures`; never for
   * `addLayer`") bridged to the narrow, test-double-friendly shapes `pickInstall.ts`/`zoneOutline.ts`
   * declare. MapLibre's real `PointLike` is a class with ~30 methods; a plain `{x, y}` literal is
   * what those two structural interfaces (and their unit tests, which pass exactly that) use
   * instead -- correct at RUNTIME (MapLibre only ever reads `.x`/`.y`), but not something `tsc` can
   * verify across the boundary, hence the one explicit cast here rather than widening either
   * interface to import maplibre-gl's types (which would make them need a real Map to test against).
   */
  function rawMap(): (PickMapLike & RenderedFeatureMap) | undefined {
    return mapHandle && (mapHandle.map as unknown as PickMapLike & RenderedFeatureMap);
  }

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function writePlaces(next: Place[], selectIndex?: number) {
    selStore.set({
      pl: hashFromPlaces(next),
      sel: selectIndex === undefined ? sel.sel : `place:${selectIndex}`,
    });
  }

  function remember(p: Place) {
    try {
      pushRecent(storage(), encodePlace(p));
    } catch {
      /* an encode failure here must never block the mutation that already succeeded */
    }
  }

  // --- pick mode (Deliverable 2, Tier 0) ---------------------------------------------------------
  let pickOn = $state(false);
  let pickState = $state<PickState>({ unit: null, keys: [] });
  let pickHandle: PickModeHandle | undefined;

  function refreshOutline() {
    const map = rawMap();
    if (!map || !pickState.unit || !pickState.keys.length) {
      mapStore.setOutline(null);
      return;
    }
    mapStore.setOutline(renderedZoneOutline(map, pickState.unit, pickState.keys));
  }

  function stopPickMode() {
    pickHandle?.uninstall();
    pickHandle = undefined;
    pickOn = false;
    pickState = clearPick();
    mapStore.setOutline(null);
  }

  function togglePickMode() {
    if (pickOn) {
      stopPickMode();
      announce("Pick mode off.");
      return;
    }
    const map = rawMap();
    if (!map) {
      announce("The map isn't ready yet.");
      return;
    }
    // pick mode and drawing both use map clicks for different purposes -- never both at once.
    if (drawMode) {
      drawSession?.stop();
      drawSession = undefined;
      drawMode = null;
    }
    pickOn = true;
    pickHandle = installPickMode(map, zoneUnits, (next) => {
      pickState = next;
      refreshOutline();
    });
    announce(
      "Pick mode on. Click a Program Area to select it; Ctrl-click, Cmd-click or long-press to add more.",
    );
  }

  // item m4 (atlas-8 review round 2): a pick-mode highlight used to persist on the map after this
  // panel unmounted (a rail tool switch mid pick-session) -- `pickHandle?.uninstall()` alone only
  // stops the click listener, not what it had already painted. Releasing the interaction override
  // is always safe (falls straight back to the store's own baseline, `placesMap.svelte.ts`), so
  // this runs unconditionally, not just while `pickOn` was true.
  onDestroy(() => {
    pickHandle?.uninstall();
    mapStore.setOutline(null);
  });

  function addPicked() {
    if (!pickState.unit || !pickState.keys.length) return;
    const set = zoneSetForUnit(pickState.unit);
    if (!set) {
      announce(`"${pickState.unit}" isn't a place-able zone unit.`);
      return;
    }
    const result = addZonePlace(places, set, pickState.keys);
    if (!result.ok) {
      announce(result.reason ?? "Couldn't add that selection.");
      return;
    }
    const added = result.places[result.places.length - 1];
    remember(added);
    writePlaces(result.places, result.places.length - 1);
    pickState = clearPick();
    mapStore.setOutline(null);
    announce("Added to places.");
  }

  // --- "Add a Program Area" (orchestrator-directed, 2026-09-24: Places had NO Program Area list
  // at all, only map-based Pick mode -- unreachable without a pointer, and unreachable on a phone
  // where the map is often off-screen behind the panel) -------------------------------------------
  // every Program Area the release publishes, full-name-sorted (`allZoneStats`, zoneStats.ts);
  // `[]` (the section below hides) for a release with none published, or before boot has loaded.
  const programAreas = $derived(allZoneStats(boot, "programarea"));
  let paPickValue = $state("");

  /** adds the chosen Program Area exactly as a map-picked one would -- the SAME `addZonePlace()` +
   * `writePlaces()` path `addPicked()` (above) uses, so the resulting place, URL hash and undo
   * behaviour are identical regardless of which route added it. */
  function addProgramAreaByKey(key: string) {
    if (!key) return;
    const set = zoneSetForUnit("programarea");
    if (!set) return; // structurally unreachable (programarea always maps to "pa"); never a throw
    const result = addZonePlace(places, set, [key]);
    if (!result.ok) {
      announce(result.reason ?? "Couldn't add that Program Area.");
      return;
    }
    const added = result.places[result.places.length - 1];
    remember(added);
    writePlaces(result.places, result.places.length - 1);
    paPickValue = "";
    announce("Added to places.");
  }

  // --- draw (Deliverable 3): terra-draw is a LAZY chunk, loaded once per panel lifetime ----------
  let drawSession: DrawSession | undefined;
  let drawModules: TerraDrawModules | undefined;
  let drawMode = $state<DrawShape | "select" | null>(null);
  let drawBusy = $state(false);
  // P9: terra-draw's own `finish` event fires on an EDIT of an already-drawn feature too (drag a
  // corner, resize, drag the whole shape), not only on a fresh draw (`draw.ts`'s own `onFinish`
  // comment) -- this maps THIS session's feature ids to the place index each one created, so
  // `onDrawFinish` can tell "a new shape" from "the same shape moved" instead of appending a
  // duplicate row every time. Scoped to one session: `ensureDrawSession` starts it fresh, `stopDraw`
  // drops it (`drawFeatures.ts`'s own header explains why nothing needs to survive past a session).
  let drawFeatures: DrawFeatureIndex = emptyDrawFeatureIndex();

  // item M1's regression (placesMap.svelte.ts's own header): keep the store's "who owns map
  // clicks" flag in sync with local pick/draw state, so Shell.svelte's click dispatch can skip the
  // scores lens' own handler while THIS panel has an active pick/draw session claiming clicks.
  $effect(() => {
    mapStore.setInteractionOwned(pickOn || drawMode !== null);
  });

  /** Deliverable 7's `place_draw` param -- counts a vertex, never carries a coordinate. */
  function vertexCountOf(geometry: AreaGeometry): number {
    const rings = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return rings.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
  }

  // P9: an edit of a feature THIS session already turned into a place (`onDrawFinish` below,
  // keyed by terra-draw's own feature id) updates that SAME row -- same index, same name,
  // re-analysed through `geomPlaceFrom` -- never appends a new one (the "dragging a drawn shape's
  // corner adds a duplicate place" bug, live-verified on 0.10.48).
  function editDrawnPlace(index: number, rawGeometry: AreaGeometry) {
    const existing = places[index];
    if (!existing || existing.kind !== "geom") return; // the row moved/vanished under us -- drop it
    const place = geomPlaceFrom(rawGeometry, existing.name);
    const next = places.slice();
    next[index] = place;
    writePlaces(next, index);
    mapStore.setOutline(featureCollectionOf(densifyGeometry(place.geometry)));
    announce("Place updated.");
  }

  function onDrawFinish(featureId: FeatureId, rawGeometry: AreaGeometry, isNewFeature: boolean) {
    const editIndex = isNewFeature ? undefined : drawFeaturePlaceIndex(drawFeatures, featureId);
    if (editIndex !== undefined) {
      editDrawnPlace(editIndex, rawGeometry);
      return;
    }
    const place = geomPlaceFrom(rawGeometry, `Drawn place ${places.length + 1}`);
    const result = addPlace(places, place);
    if (!result.ok) {
      announce(result.reason ?? "Couldn't add that shape.");
      return;
    }
    const index = result.places.length - 1;
    drawFeatures = withDrawFeature(drawFeatures, featureId, index);
    remember(place);
    writePlaces(result.places, index);
    track(
      "place_draw",
      placeDrawParams(vertexCountOf(place.geometry), approxAreaKm2(place.geometry)),
    );
    // Deliverable 3: "the outline is redrawn from the decoded geometry densified along lon/lat
    // lines" -- what is displayed from here on is the SAME (already analysed) geometry stored
    // above, never the raw shape terra-draw just handed back.
    mapStore.setOutline(featureCollectionOf(densifyGeometry(place.geometry)));
    drawSession?.setMode("select"); // straight into edit, so the just-drawn shape can be adjusted
    drawMode = "select";
    announce(
      "Place drawn. Drag its corners to adjust, or turn on Pick mode / Enter coordinates for another.",
    );
  }

  async function ensureDrawSession(): Promise<DrawSession | undefined> {
    const map = rawMap();
    if (!map) {
      announce("The map isn't ready yet.");
      return undefined;
    }
    if (drawSession) return drawSession;
    drawBusy = true;
    try {
      drawModules ??= await loadTerraDraw();
      drawSession = createDrawSession({ map, onFinish: onDrawFinish }, drawModules);
      drawFeatures = emptyDrawFeatureIndex(); // a fresh TerraDraw instance -> a fresh id namespace
      return drawSession;
    } catch {
      announce("Couldn't load the drawing tools — try Enter coordinates instead.");
      return undefined;
    } finally {
      drawBusy = false;
    }
  }

  async function startDraw(shape: DrawShape) {
    // drawing and pick mode both use map clicks for different purposes -- never both at once.
    if (pickOn) stopPickMode();
    const session = await ensureDrawSession();
    if (!session) return;
    session.setMode(shape);
    drawMode = shape;
  }

  // P8 item 9 (P7 handback): `drawMode = drawMode ? "select" : null` was a no-op wherever it can
  // actually be called -- the "Done" button only renders while `{#if drawMode}` (line ~784) is
  // true, so at the one call site that matters `drawMode` is ALWAYS truthy, and the ternary always
  // reassigned it back to `"select"`. `drawMode` could therefore never become `null` again: "Done"
  // never disappeared, and `mapStore.setInteractionOwned(pickOn || drawMode !== null)` (the effect
  // above) never released ownership of map clicks back to the rest of the app. Fixed to the SAME
  // full teardown `togglePickMode()` already does when switching away from draw mode (above): stop
  // the session, drop the reference, and actually clear `drawMode`.
  function stopDraw() {
    drawSession?.stop();
    drawSession = undefined;
    drawMode = null;
  }

  onDestroy(() => drawSession?.stop());

  // --- "Enter coordinates" (Deliverable 3's keyboard/screen-reader path) -------------------------
  let coordDialogOpen = $state(false);

  function addEnteredPlaces(entered: NormalizedPlace[]) {
    let current = places;
    let lastIndex = -1;
    for (const e of entered) {
      const place = geomPlaceFrom(e.geometry, e.name);
      const result = addPlace(current, place);
      if (!result.ok) {
        announce(result.reason ?? "Couldn't add every place — the 20-place cap was reached.");
        break;
      }
      current = result.places;
      lastIndex = current.length - 1;
      remember(place);
    }
    if (lastIndex >= 0) {
      writePlaces(current, lastIndex);
      announce(entered.length > 1 ? `Added ${entered.length} places.` : "Place added.");
    }
  }

  // --- upload (Deliverable 4's UI half) -----------------------------------------------------------
  // `window.__early.version` is the SAME global VersionBadge.svelte/Shell.svelte already read
  // (never `src/lib/release` imported here directly, matching Shell.svelte's own restriction --
  // this component is not restricted from it, but there is no reason to duplicate that plumbing).
  interface Early {
    version: Promise<string | null>;
  }
  let ver = $state<string | null>(null);
  onMount(() => {
    (window as unknown as { __early?: Early }).__early?.version
      .then((v) => (ver = v))
      .catch(() => {});
  });

  /** `undefined` when no release is resolved yet -- the study-area check then simply does not run
   * (normalize.ts's own documented behaviour for an absent hook). */
  const dataEngineFn = $derived(
    ver
      ? () => getDataEngine({ ver: ver as string, boot: (boot ?? {}) as Record<string, unknown> })
      : undefined,
  );

  // --- P7 fix: a drawn/entered place is analysed automatically, the row shows numbers --------------
  // ("the same path a Program-Area pick uses" -- a zone row's composite/coverage read straight off
  // `boot` with no async step at all, `rowFigures()` below; a geom place has no such precomputed
  // row to read, so getting the SAME "numbers, not a placeholder" outcome means actually RUNNING the
  // analysis, same as `ResultsPanel.svelte` already does for whichever ONE place is selected).
  // `rowFigures()` used to hard-code `composite: null` for every `kind: "geom"` row, unconditionally
  // -- Deliverable 5's own comment called this out as a placeholder ("...show as 'not analysed yet'
  // until then") that nothing ever came back to wire up once the SQL twins existed. Keyed by the
  // geometry itself (`JSON.stringify`, the SAME key `ResultsPanel.svelte`'s own `placeKey` uses) so
  // a rename/duplicate/reorder never re-triggers a query for a geometry already analysed, and a
  // duplicated place (identical geometry) gets its cached result for free. Every `computeScoreResults`
  // call already runs through `exclusive()` (`lib/analysis/exclusive.ts`'s own per-db FIFO), so
  // analysing several places back to back -- including the one `ResultsPanel` is independently
  // analysing for its own flower/species view -- is queued, never raced or corrupted.
  //
  // P7 addendum: a place can cover ground this release never published a tile for (land, or past
  // the populated footprint) -- `results.ts#describeAnalysisError`'s own header has the live
  // reproduction (a missing `app/cell/tile=*` object, S3 403). The cache keeps the DESCRIBED
  // failure, not a bare "error" flag, so the row can say what actually went wrong
  // (`results.ts#PlaceScoreState`/`placeRowAnalysis`).
  let placeScores = $state<Record<string, PlaceScoreState>>({});

  $effect(() => {
    if (!dataEngineFn) return; // no release resolved yet -- nothing to analyse against
    const engine = dataEngineFn;
    for (const p of places) {
      if (p.kind !== "geom") continue;
      const key = JSON.stringify(p.geometry);
      if (key in placeScores) continue; // already analysed, loading, or errored -- never re-run
      const geometry = p.geometry;
      placeScores = { ...placeScores, [key]: "loading" };
      (async () => {
        try {
          const ctx = await engine();
          const result = await computeScoreResults(ctx, boot, geometry);
          placeScores = { ...placeScores, [key]: result };
        } catch (err) {
          placeScores = { ...placeScores, [key]: { error: describeAnalysisError(err) } };
        }
      })();
    }
  });

  // --- "show analysis cells" (Deliverable 2/3): places <= MAX_ANALYSIS_CELLS only ----------------
  // item m4 (atlas-8 review round 2): the toggle's own on/off state now lives in `mapStore`
  // (`mapStore.showCells`/`setShowCells`), not local `$state` -- it used to read "off" after a
  // collapse/tool-switch/remount while `mapStore.cells` stayed painted underneath it.

  function gridOrNull() {
    try {
      return gridFromBoot(boot);
    } catch {
      return null;
    }
  }

  let loadingCells = $state(false);

  // item 3b (atlas-8 review round 2): "Show analysis cells" could paint the PREVIOUS place's cells
  // when the selection changed mid-load -- `toggleAnalysisCells()` snapshots `p` before its two
  // `await`s, and used to apply whatever came back unconditionally. `cellsToken` keys the load on
  // the place, the SAME pattern `ResultsPanel.svelte`'s own `run` uses: a fresh call (or a
  // selection change, the effect below) invalidates any earlier one in flight, which then drops
  // its result silently instead of landing it on a place that is no longer selected.
  let cellsToken = 0;
  $effect(() => {
    void selectedIndex; // any selection change invalidates an in-flight "show analysis cells" load
    cellsToken++;
    // the invalidated call's own `finally` no longer owns `loadingCells` (its `token !==
    // cellsToken` check skips it) -- without resetting it here, the toggle's label would be stuck
    // reading "Loading analysed cells..." forever once the selection moves on, even though nothing
    // is loading for the place now selected.
    loadingCells = false;
  });

  // Fix round 1 (Opus review): paint the D7b-CLIPPED cell set (`placeCellsInStudyArea`, the
  // engine-backed `place_cell_sa` rows), never the raw, unclipped `cellsInPolygon()` -- a place
  // straddling the study-area edge would otherwise paint land/foreign-water squares the analysis
  // itself never counts (measured: GAA would paint 14,238 for 14,165 analysed cells).
  async function toggleAnalysisCells() {
    if (mapStore.showCells) {
      mapStore.setShowCells(false);
      mapStore.setCells(null);
      return;
    }
    const p = selectedIndex !== null ? places[selectedIndex] : null;
    if (!p || p.kind !== "geom") {
      announce("Select a drawn or uploaded place first.");
      return;
    }
    const grid = gridOrNull();
    if (!grid) {
      announce("No release grid loaded yet.");
      return;
    }
    if (!dataEngineFn) {
      announce("No release is resolved yet.");
      return;
    }
    // an upper bound BEFORE the engine round trip, from the UNCLIPPED count -- clipping can only
    // ever SHRINK the set, so this cheaply rejects an already-too-large place without booting the
    // engine at all, and never itself decides what gets painted.
    const unclipped = cellsInPolygon(p.geometry, grid);
    if (unclipped.length > MAX_ANALYSIS_CELLS) {
      announce(
        `This place covers ${unclipped.length.toLocaleString("en-US")} cells — too many to paint (limit ${MAX_ANALYSIS_CELLS.toLocaleString("en-US")}).`,
      );
      return;
    }
    const token = ++cellsToken;
    loadingCells = true;
    try {
      const ctx = await dataEngineFn();
      const cells = await placeCellsInStudyArea(ctx, p.geometry);
      // item 2 (P round Q3): a test-only hook so e2e/places.spec.ts's item-3b test can hold the
      // load RIGHT HERE -- after the real fetch resolves, before its result is applied -- move the
      // selection, then release it, proving the `token !== cellsToken` check below actually drops
      // what would otherwise paint the wrong place's cells. `window.__atlasTest` mirrors how
      // `__atlasMap`/`__atlasSpecies` (Shell.svelte) expose their own test/automation seams, but is
      // NEVER assigned outside a test -- `?.holdCells` is `undefined` in every real session, so
      // `await undefined` resolves on the next microtask and this line changes nothing in
      // production. Previously the ONLY way to force this race was a real network delay
      // (`page.route()`), which measurably could not force the overlap (this test's own former
      // `test.fixme` comment, e2e/places.spec.ts) -- this hook is what makes it deterministic.
      await (window as unknown as { __atlasTest?: { holdCells?: Promise<void> } }).__atlasTest
        ?.holdCells;
      if (token !== cellsToken) return; // the selection moved on while this was loading -- drop it
      mapStore.setShowCells(true);
      mapStore.setCells(cellsFeatureCollection(cells, grid));
    } catch (err) {
      // P7: same honest-sentence helper the score/species panels use -- this reads `app/cell`
      // tiles too, so the SAME missing-release-object class can fail it.
      if (token === cellsToken) announce(describeAnalysisError(err));
    } finally {
      if (token === cellsToken) loadingCells = false;
    }
  }

  // turning the toggle off (or losing the selected place) always clears the painted cells, so a
  // stale "show analysis cells" layer can never survive past the place it described.
  $effect(() => {
    if (mapStore.showCells && (selectedIndex === null || places[selectedIndex]?.kind !== "geom")) {
      mapStore.setShowCells(false);
      mapStore.setCells(null);
    }
  });

  // item m3 (atlas-8 review round 2): the selected row's outline used to need ITS OWN effect here
  // ("persists on the map while nothing more specific already owns the highlight"), gated on
  // `!pickOn && !drawMode` so it never fought `placesMap.svelte.ts`'s own baseline effect over the
  // SAME `outline` state -- two writers of one bucket, ordered only by Svelte's own scheduling.
  // `placesMap.svelte.ts` now composes `interaction ?? baseline` itself: every `mapStore.
  // setOutline(...)` call in this file (pick mode's highlight, a draw's live preview) sets the
  // INTERACTION override, and `setOutline(null)` (pick/draw ending, below) releases it straight
  // back to the store's own baseline -- which already recomputes from `sel.pl`/`sel.sel` alone, so
  // nothing here needs to re-derive or re-assert it. Removing this effect changes no behaviour:
  // grep this file for `mapStore.setOutline` to see every remaining write, unchanged.

  // --- the list -----------------------------------------------------------------------------------
  function kindIcon(p: Place): "places" | "draw" | "upload" {
    return p.kind === "zone" ? "places" : p.kind === "geom" ? "draw" : "upload";
  }

  function rowName(p: Place): string {
    if (p.kind === "geom" || p.kind === "upload") return p.name;
    const stats = zoneStatsFor(boot, unitForZoneSet(p.set), p.keys);
    const name = zoneDisplayName(stats);
    return name || fallbackZoneLabel(p);
  }

  interface RowFigures {
    areaKm2: number | null;
    coveragePct: number | null;
    composite: number | null;
    /** P7: `"loading"`/`"error"`/`"outside"` only ever apply to a `kind: "geom"` row -- what to
     * say in place of a composite chip while `placeScores` above doesn't (yet, or ever) have a
     * real number for it. `errorMessage` is `describeAnalysisError()`'s own sentence (results.ts)
     * -- a missing release object names itself, so the chip's `title` can say exactly what failed,
     * not just that something did. P8 item 2: `"unpublished"` is a `kind: "zone"` row's own state
     * -- read synchronously off `boot` (`zoneStats.ts#summarizeZoneStats`), so a missing composite
     * there is a permanent fact about the release, never "not yet". */
    status?: "loading" | "error" | "outside" | "unpublished";
    errorMessage?: string;
  }

  function rowFigures(p: Place): RowFigures {
    if (p.kind === "zone") {
      const stats = zoneStatsFor(boot, unitForZoneSet(p.set), p.keys);
      return summarizeZoneStats(stats);
    }
    if (p.kind === "geom") {
      // area is a fast client-side estimate (area.ts); coverage/composite/status come from
      // `placeRowAnalysis()` (results.ts) over `placeScores` (above) -- the SAME SQL twins
      // `ResultsPanel.svelte` runs for the selected place, now run for every geom place as soon as
      // it exists, not only the one row currently selected.
      const areaKm2 = approxAreaKm2(p.geometry);
      return { areaKm2, ...placeRowAnalysis(placeScores[JSON.stringify(p.geometry)]) };
    }
    return { areaKm2: null, coveragePct: null, composite: null }; // upload: geometry not held here
  }

  function fmt(n: number | null, digits = 0): string {
    return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function selectRow(i: number) {
    selStore.set({ sel: sel.sel === `place:${i}` ? undefined : `place:${i}` });
  }

  function zoomTo(p: Place) {
    if (!mapHandle) return;
    if (p.kind === "geom") {
      const cz = centerZoomForGeometry(p.geometry);
      mapHandle.flyTo({ key: "place", lon: cz.lon, lat: cz.lat, zoom: cz.zoom });
      return;
    }
    if (p.kind === "zone") {
      const c = zoneCenterFromBoot(boot, unitForZoneSet(p.set), p.keys);
      if (!c) {
        announce("No location known for this selection yet.");
        return;
      }
      mapHandle.flyTo({ key: "place", lon: c.lon, lat: c.lat, zoom: 6 });
      return;
    }
    announce("This place's geometry isn't in this session — ask for the GeoJSON to zoom to it.");
  }

  function rename(i: number, name: string) {
    const result = renamePlaceAt(places, i, name);
    if (!result.ok) {
      if (result.reason) announce(result.reason);
      return;
    }
    remember(result.places[i]);
    writePlaces(result.places);
  }

  function duplicate(i: number) {
    const result = duplicatePlaceAt(places, i);
    if (!result.ok) {
      announce(result.reason ?? "Couldn't duplicate that place.");
      return;
    }
    remember(result.places[result.places.length - 1]);
    writePlaces(result.places, result.places.length - 1);
  }

  function remove(i: number) {
    remember(places[i]);
    const next = removePlaceAt(places, i);
    // P9: a row this DRAW SESSION mapped to `i` no longer exists -- drop it and shift every later
    // mapped index down, so a later edit of an active drawn feature lands on the row it actually
    // drew instead of whatever now sits at a stale index (drawFeatures.ts's own header).
    drawFeatures = withoutDrawPlace(drawFeatures, i);
    selStore.set({
      pl: hashFromPlaces(next),
      sel: sel.sel === `place:${i}` ? undefined : sel.sel,
    });
    announce("Place removed.");
  }

  // "Open in report" (Deliverable 1's stub link): a plain <a href> to the report.html entry
  // carrying the SAME query + hash state (release/lens/etc. plus `#pl=`), so the report page,
  // once atlas-7 builds it, opens on exactly this place -- nothing here is $state/$derived, so
  // there's no reactive value a mutable URL could go stale under (Toast.svelte's own
  // internal-bookkeeping exception to this rule, same reasoning).
  //
  // P8 item 3 (Opus docs review, app finding #4): this used to pass the FULL `sel.pl` (every place
  // in the panel) plus a `sel=place:${i}` token that `report.html`'s `Report.svelte` never reads
  // (it just `decodePlaces(sel.pl)`s -- confirmed, that file has no other reference to `sel.sel`
  // anywhere) -- so a row's own "Open in report" silently reported every place, never just the row
  // it was clicked on. `report.html` needs no change: building `pl` from ONLY this row's own place
  // makes "every place in `pl`" mean exactly this one.
  function reportHref(i: number): string {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const url = new URL("report.html", location.href);
    url.search = location.search;
    url.hash = reportHash(hashFromPlaces([places[i]]), sel.t);
    return url.toString();
  }

  // --- footer: share / download / report ----------------------------------------------------------
  // Deliverable 6: the footer's Share opens the SAME dialog that shows the link's length and, over
  // budget, the simplification ladder -- not a bare clipboard copy (that stays the top bar's own
  // one-line convenience for the whole view, unrelated to a place's own geometry).
  let shareDialogOpen = $state(false);

  function onShareTracked(linkLength: number) {
    track("place_share", placeShareParams(linkLength));
  }

  function onDownload() {
    if (!places.length) {
      announce("No places to download yet.");
      return;
    }
    downloadGeoJson(placesToGeoJson(places));
    announce(`Downloaded ${places.length} place${places.length === 1 ? "" : "s"} as GeoJSON.`);
  }

  // atlas-7 step 4: "Report" opens report.html for every place currently in the panel.
  // `window.open()` MUST run SYNCHRONOUSLY inside the click handler -- no `await` before it -- or
  // every browser's popup blocker treats the call as no longer user-initiated (the exact bug the
  // legacy Shiny app's own placeholder-tab workaround, `apps/scores/app.R:1311-1326`, existed to
  // route around; a static link needs no such workaround as long as this rule holds). `sel.pl` is
  // already this panel's own encoding of `places` (`placesFromHash`/`hashFromPlaces`, model.ts) --
  // reused verbatim, never re-derived, so the report's `#pl=` is byte-identical to what a Share
  // link for the same view would carry. `ver` is the release THIS panel is actually viewing
  // (`window.__early.version`, read above) -- included explicitly so the report reproduces this
  // exact release even if `latest.txt` changes between the click and report.html's own load.
  function onReport() {
    if (!places.length) {
      announce("No places to report on yet.");
      return;
    }
    // B2 fix: build the hash with the SAME encoder `reportHref()` (above) and `formatSel`
    // (lib/state/codec.ts) use -- `reportHash()`, model.ts -- instead of the old
    // `#pl=${sel.pl}`, which spliced `sel.pl` in with zero layers of percent-encoding while
    // report.html's `parseSel` reads the hash back through `URLSearchParams` (one layer of
    // decoding). That mismatch silently turned a g1 token's own internal "%20" escape back into
    // a literal space, corrupting every place whose name contains one.
    const hash = reportHash(sel.pl, sel.t);
    const query = ver ? `?ver=${encodeURIComponent(ver)}` : "";
    window.open(`./report.html${query}${hash}`, "_blank", "noopener");
  }

  // --- "Recent" accordion (Deliverable 1: last ten tokens, localStorage, never the only copy) -----
  let recentTokens = $state<string[]>(loadRecents(storage()));

  function refreshRecents() {
    recentTokens = loadRecents(storage());
  }

  function addBackRecent(token: string) {
    const p = recentPlace(token);
    if (!p) {
      announce("That recent place can no longer be read.");
      return;
    }
    if (places.length >= MAX_PLACES) {
      announce(`Up to ${MAX_PLACES} places at a time — remove one to add another.`);
      return;
    }
    const next = [...places, p];
    writePlaces(next, next.length - 1);
    announce("Added back from Recent.");
  }

  function onClearRecents() {
    clearRecents(storage());
    refreshRecents();
  }
</script>

<div class="places">
  <section class="pick-bar" aria-label="Pick from the map">
    <Pill
      label="Pick mode"
      pressed={pickOn}
      disabled={!mapHandle}
      disabledReason={mapHandle ? undefined : "The map isn't ready yet."}
      onclick={togglePickMode}
    />
    <button type="button" class="add-picked" disabled={!pickState.keys.length} onclick={addPicked}>
      <Icon name="places" size={16} />
      Add to places{pickState.keys.length ? ` (${pickState.keys.length})` : ""}
    </button>
  </section>

  {#if programAreas.length}
    <!-- orchestrator finding (2026-09-24): a keyboard/phone-reachable alternative to map Pick
         mode above -- "Aleutian Arc (ALA)" style options (`paLabel`), full-name sorted
         (`allZoneStats`). Adds through the IDENTICAL `addZonePlace`/`writePlaces` path a map pick
         uses, so the resulting place/URL hash cannot differ by route. -->
    <!-- the landmark's own name is deliberately DIFFERENT from the Select's (below) -- two
         controls/regions sharing one accessible name is ambiguous for anything that looks a
         control up "by its label" (Playwright's own `getByLabel`, a screen reader's forms list). -->
    <section class="pa-picker" aria-label="Program Area picker">
      <Select
        label="Add a Program Area"
        value={paPickValue}
        onchange={(v) => (paPickValue = v)}
        options={[
          { value: "", label: "Choose a Program Area…" },
          ...programAreas.map((pa) => ({ value: pa.key, label: paLabel(pa.key, pa.name) })),
        ]}
      />
      <button
        type="button"
        class="add-picked"
        disabled={!paPickValue}
        onclick={() => addProgramAreaByKey(paPickValue)}
      >
        <Icon name="places" size={16} />
        Add this Program Area
      </button>
    </section>
  {/if}

  <section class="draw-bar" aria-label="Draw a place" role="group">
    <button
      type="button"
      class="draw-tool"
      class:draw-tool--active={drawMode === "polygon"}
      disabled={drawBusy}
      onclick={() => startDraw("polygon")}
    >
      <Icon name="draw" size={16} />
      Polygon
    </button>
    <button
      type="button"
      class="draw-tool"
      class:draw-tool--active={drawMode === "rectangle"}
      disabled={drawBusy}
      onclick={() => startDraw("rectangle")}
    >
      Rectangle
    </button>
    <button
      type="button"
      class="draw-tool"
      class:draw-tool--active={drawMode === "circle"}
      disabled={drawBusy}
      onclick={() => startDraw("circle")}
    >
      Circle
    </button>
    {#if drawMode}
      <button type="button" class="draw-tool" onclick={stopDraw}>Done</button>
    {/if}
    <button type="button" class="draw-tool" onclick={() => (coordDialogOpen = true)}>
      Enter coordinates
    </button>
    {#if selectedIndex !== null && places[selectedIndex]?.kind === "zone" && !zoneCellsAvailable(boot)}
      <!-- Q3 item 1: "the button is absent for zones with a one-line reason" -- the OLD disabled
           Pill here read "Select a drawn or uploaded place first," which is actively wrong once a
           zone place CAN be selected (P3's "Add a Program Area" picker); `zoneCellsAvailable()`
           (zoneStats.ts) is the one place that flips true the day a `zone_cell` data path lands, so
           nothing here needs to change when it does. -->
      <span class="cells-unavailable" title={ZONE_CELLS_UNAVAILABLE_REASON}>
        Show analysis cells: not available for Program Areas yet
      </span>
    {:else}
      <Pill
        label={loadingCells ? "Loading analysed cells…" : "Show analysis cells"}
        pressed={mapStore.showCells}
        disabled={loadingCells || selectedIndex === null || places[selectedIndex]?.kind !== "geom"}
        disabledReason="Select a drawn or uploaded place first."
        onclick={toggleAnalysisCells}
      />
    {/if}
  </section>

  <UploadPanel {mapHandle} dataEngine={dataEngineFn} onAdd={addEnteredPlaces} {track} />

  {#if !places.length}
    <p class="empty">
      No places yet. Choose a Program Area above, turn on pick mode and click one on the map, draw a
      shape, enter coordinates, or drop a file on the map.
    </p>
  {:else}
    <ul class="place-list" aria-label="Places">
      {#each places as place, i (i)}
        {@const figures = rowFigures(place)}
        <li class="place-row" class:place-row--selected={selectedIndex === i}>
          <button
            type="button"
            class="row-select"
            aria-pressed={selectedIndex === i}
            onclick={() => selectRow(i)}
          >
            <Icon name={kindIcon(place)} size={18} title={place.kind} />
            {#if isGeomOrUpload(place)}
              <input
                class="row-name"
                type="text"
                maxlength="60"
                value={rowName(place)}
                aria-label="Rename place"
                onclick={(e) => e.stopPropagation()}
                onchange={(e) => rename(i, e.currentTarget.value)}
              />
            {:else}
              <span class="row-name row-name--readonly">{rowName(place)}</span>
            {/if}
          </button>

          <span class="row-stat" title="Area">{fmt(figures.areaKm2)} km²</span>
          <span
            class="row-stat"
            title={figures.coveragePct === null
              ? "Data coverage: not published for this release"
              : "Data coverage"}
            >{figures.coveragePct === null ? "—" : `${fmt(figures.coveragePct)}%`}</span
          >
          {#if figures.composite !== null}
            <Chip label={`${fmt(figures.composite, 1)} composite`} variant="accent" />
          {:else if figures.status === "loading"}
            <Chip label="analysing…" />
          {:else if figures.status === "error"}
            <!-- P7: Chip itself forwards no `title` -- a plain wrapper carries the FULL honest
                 message (results.ts#describeAnalysisError) so hovering/inspecting the row shows
                 exactly what failed, not just that something did. -->
            <span title={figures.errorMessage}><Chip label="couldn't analyse" /></span>
          {:else if figures.status === "outside"}
            <Chip label="outside the study area" />
          {:else if figures.status === "unpublished"}
            <!-- P8 item 2: this release genuinely carries no composite for this zone -- a
                 permanent fact, never "not analysed yet" (which implies a later step fills it in;
                 there is none for a zone row, read synchronously off `boot`). -->
            <Chip label="not published for this release" />
          {:else}
            <Chip label="not analysed yet" />
          {/if}

          <span class="row-actions" role="group" aria-label="Place actions">
            <button type="button" aria-label="Zoom to place" onclick={() => zoomTo(place)}>
              <Icon name="search" size={16} />
            </button>
            {#if isGeomOrUpload(place)}
              <button type="button" aria-label="Duplicate place" onclick={() => duplicate(i)}>
                <Icon name="copy" size={16} />
              </button>
            {/if}
            <button type="button" aria-label="Delete place" onclick={() => remove(i)}>
              <Icon name="close" size={16} />
            </button>
            <a class="chip" href={reportHref(i)}>
              <Icon name="report" size={14} />
              Open in report
            </a>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if selectedIndex !== null}
    {@const selectedPlace = places[selectedIndex]}
    <!-- Q3 item 1: a `kind: "zone"` (Program Area) place now gets the SAME results panel a
         drawn/uploaded place does -- ResultsPanel.svelte's own header explains why its
         coverage/flower/components branch differs (published, synchronous) while species still
         goes through the engine. -->
    {#if selectedPlace?.kind === "geom" || selectedPlace?.kind === "zone"}
      <ResultsPanel place={selectedPlace} {boot} {ver} dataEngine={dataEngineFn} />
    {/if}
  {/if}

  <p class="cap-note">{places.length} / {MAX_PLACES} places</p>

  <!-- orchestrator finding (2026-09-24): these three actions all operate on the CURRENT place
       list -- with zero places, Share opened an empty-list dialog and Download/Report merely
       announced a rejection AFTER the click (their own internal guards, unchanged, below). They
       are disabled outright now, matching the panel's own draw-tool/pick-mode buttons' existing
       `:disabled` convention, so the empty state is visible before a click rather than after. -->
  <footer class="places-footer">
    <button type="button" disabled={!places.length} onclick={() => (shareDialogOpen = true)}>
      <Icon name="share" size={16} />
      Share
    </button>
    <button type="button" disabled={!places.length} onclick={onDownload}>
      <Icon name="download" size={16} />
      Download places
    </button>
    <button type="button" disabled={!places.length} onclick={onReport}>
      <Icon name="report" size={16} />
      Report
    </button>
  </footer>

  <Accordion title="Recent">
    {#if !recentTokens.length}
      <p class="empty">No recent places yet.</p>
    {:else}
      <ul class="recent-list">
        {#each recentTokens as token (token)}
          {@const p = recentPlace(token)}
          {#if p}
            <li class="recent-row">
              <span>{p.kind === "zone" ? fallbackZoneLabel(p) : p.name}</span>
              <button type="button" onclick={() => addBackRecent(token)}>Add back</button>
            </li>
          {/if}
        {/each}
      </ul>
      <button type="button" class="clear-recents" onclick={onClearRecents}>Clear</button>
    {/if}
  </Accordion>

  <CoordinateDialog
    open={coordDialogOpen}
    onclose={() => (coordDialogOpen = false)}
    onAccept={addEnteredPlaces}
    dataEngine={dataEngineFn}
  />

  <ShareDialog
    open={shareDialogOpen}
    onclose={() => (shareDialogOpen = false)}
    {sel}
    {selStore}
    {places}
    grid={gridOrNull()}
    onShare={onShareTracked}
  />
</div>

<style>
  .places {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .pick-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .pa-picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .add-picked {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .add-picked:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .draw-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .draw-tool {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .draw-tool--active {
    background: var(--fill-accent);
    border-color: var(--border-accent);
    color: var(--text-on-accent);
  }

  .draw-tool:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Q3 item 1: the one-line reason shown IN PLACE of the "Show analysis cells" Pill for a
     selected zone place -- see the template's own comment for why this replaces the button rather
     than disabling it. */
  .cells-unavailable {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .empty {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .place-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .place-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    flex-wrap: wrap;
  }

  .place-row--selected {
    border-color: var(--border-accent);
  }

  .row-select {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-width: 120px;
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .row-name {
    font-size: var(--text-sm);
  }

  .row-name--readonly {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  input.row-name {
    border: 1px solid transparent;
    background: none;
    color: inherit;
    padding: var(--space-1);
    border-radius: var(--radius-control);
  }

  input.row-name:hover,
  input.row-name:focus {
    border-color: var(--border-control);
  }

  .row-stat {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }

  .row-actions button {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .row-actions button:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .cap-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .places-footer {
    display: flex;
    gap: var(--space-2);
    border-top: 1px solid var(--divider);
    padding-top: var(--space-2);
  }

  .places-footer button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    cursor: pointer;
  }

  .places-footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-2);
    padding: 0;
    list-style: none;
  }

  .recent-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .recent-row button {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
  }

  .clear-recents {
    border: 0;
    background: none;
    color: var(--text-secondary);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
</style>
