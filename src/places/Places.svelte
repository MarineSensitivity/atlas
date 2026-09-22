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
  import { onDestroy } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Pill from "../lib/ui/Pill.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import Accordion from "../lib/ui/Accordion.svelte";
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
    hashFromPlaces,
    isGeomOrUpload,
    MAX_PLACES,
    placesFromHash,
    removePlaceAt,
    renamePlaceAt,
    unitForZoneSet,
    zoneSetForUnit,
  } from "./model";
  import {
    summarizeZoneStats,
    zoneCenterFromBoot,
    zoneDisplayName,
    zoneStatsFor,
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
    type TerraDrawModules,
  } from "./draw";
  import { densifyGeometry } from "./densify";
  import { geomPlaceFrom } from "./geomPlace";
  import { cellsFeatureCollection, MAX_ANALYSIS_CELLS } from "./cellSquares";
  import CoordinateDialog from "./CoordinateDialog.svelte";
  import { cellsInPolygon } from "../lib/geo/coverage";
  import { gridFromBoot } from "../lib/grid/grid";
  import type { AreaGeometry } from "../lib/geo/types";
  import type { NormalizedPlace } from "../lib/geo/upload/normalize";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    mapHandle: MapHandle | undefined;
    zoneUnits: ZoneUnitSpec[];
    mapStore: PlacesMapStore;
  }

  let { sel, selStore, boot, mapHandle, zoneUnits, mapStore }: Props = $props();

  const places = $derived(placesFromHash(sel.pl));
  const selectedIndex = $derived(
    sel.sel && /^place:\d+$/.test(sel.sel) ? Number(sel.sel.slice("place:".length)) : null,
  );

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

  onDestroy(() => pickHandle?.uninstall());

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

  // --- draw (Deliverable 3): terra-draw is a LAZY chunk, loaded once per panel lifetime ----------
  let drawSession: DrawSession | undefined;
  let drawModules: TerraDrawModules | undefined;
  let drawMode = $state<DrawShape | "select" | null>(null);
  let drawBusy = $state(false);

  function featureCollectionOf(geometry: AreaGeometry) {
    return {
      type: "FeatureCollection" as const,
      features: [{ type: "Feature" as const, geometry, properties: {} }],
    };
  }

  function onDrawFinish(rawGeometry: AreaGeometry) {
    const place = geomPlaceFrom(rawGeometry, `Drawn place ${places.length + 1}`);
    const result = addPlace(places, place);
    if (!result.ok) {
      announce(result.reason ?? "Couldn't add that shape.");
      return;
    }
    remember(place);
    writePlaces(result.places, result.places.length - 1);
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

  function stopDraw() {
    drawSession?.setMode("select");
    drawMode = drawMode ? "select" : null;
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

  // --- "show analysis cells" (Deliverable 2/3): places <= MAX_ANALYSIS_CELLS only ----------------
  let showCells = $state(false);

  function gridOrNull() {
    try {
      return gridFromBoot(boot);
    } catch {
      return null;
    }
  }

  function toggleAnalysisCells() {
    if (showCells) {
      showCells = false;
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
    const cells = cellsInPolygon(p.geometry, grid);
    if (cells.length > MAX_ANALYSIS_CELLS) {
      announce(
        `This place covers ${cells.length.toLocaleString("en-US")} cells — too many to paint (limit ${MAX_ANALYSIS_CELLS.toLocaleString("en-US")}).`,
      );
      return;
    }
    showCells = true;
    mapStore.setCells(cellsFeatureCollection(cells, grid));
  }

  // turning the toggle off (or losing the selected place) always clears the painted cells, so a
  // stale "show analysis cells" layer can never survive past the place it described.
  $effect(() => {
    if (showCells && (selectedIndex === null || places[selectedIndex]?.kind !== "geom")) {
      showCells = false;
      mapStore.setCells(null);
    }
  });

  // the selected row's outline persists on the map while nothing more specific (pick mode, an
  // active draw) already owns the highlight -- e.g. after a reload, re-picking `sel=place:n` off
  // the URL alone still shows what that place actually covers.
  $effect(() => {
    if (pickOn || drawMode) return;
    const p = selectedIndex !== null ? places[selectedIndex] : null;
    mapStore.setOutline(
      p && p.kind === "geom" ? featureCollectionOf(densifyGeometry(p.geometry)) : null,
    );
  });

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
  }

  function rowFigures(p: Place): RowFigures {
    if (p.kind === "zone") {
      const stats = zoneStatsFor(boot, unitForZoneSet(p.set), p.keys);
      return summarizeZoneStats(stats);
    }
    if (p.kind === "geom") {
      // area is a fast client-side estimate (area.ts); coverage/composite need the SQL twins
      // (Deliverable 5, a later step's commit) and show as "not analysed yet" until then.
      return { areaKm2: approxAreaKm2(p.geometry), coveragePct: null, composite: null };
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
  function reportHref(i: number): string {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const url = new URL("report.html", location.href);
    url.search = location.search;
    const hash = new URLSearchParams({ pl: sel.pl ?? "", t: sel.t ?? "", sel: `place:${i}` });
    url.hash = `#${hash.toString()}`;
    return url.toString();
  }

  // --- footer: share / download / report ----------------------------------------------------------
  async function onShare() {
    try {
      await navigator.clipboard.writeText(location.href);
      announce("Link copied to your clipboard.");
    } catch {
      announce("Couldn't copy the link automatically — copy it from the address bar.");
    }
  }

  function onDownload() {
    if (!places.length) {
      announce("No places to download yet.");
      return;
    }
    downloadGeoJson(placesToGeoJson(places));
    announce(`Downloaded ${places.length} place${places.length === 1 ? "" : "s"} as GeoJSON.`);
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
    <Pill
      label="Show analysis cells"
      pressed={showCells}
      disabled={selectedIndex === null || places[selectedIndex]?.kind !== "geom"}
      disabledReason="Select a drawn or uploaded place first."
      onclick={toggleAnalysisCells}
    />
  </section>

  {#if !places.length}
    <p class="empty">
      No places yet. Turn on pick mode and click a Program Area, or draw and upload arrive in the
      next steps.
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
          <span class="row-stat" title="Data coverage"
            >{figures.coveragePct === null ? "—" : `${fmt(figures.coveragePct)}%`}</span
          >
          {#if figures.composite !== null}
            <Chip label={`${fmt(figures.composite, 1)} composite`} variant="accent" />
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

  <p class="cap-note">{places.length} / {MAX_PLACES} places</p>

  <footer class="places-footer">
    <button type="button" onclick={onShare}>
      <Icon name="share" size={16} />
      Share
    </button>
    <button type="button" onclick={onDownload}>
      <Icon name="download" size={16} />
      Download places
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
    border-color: var(--fill-accent);
    color: var(--text-on-accent);
  }

  .draw-tool:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
    border-color: var(--fill-accent);
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
