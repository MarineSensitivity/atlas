// atlas-4/0.10.21 fix 1 — the scores lens' MAP-INPUT ownership, split out of `ScoresLens.svelte`
// (the panel body) so it does not depend on the panel being open. Mirrors the species lens' own
// split (`src/lens/species/state.svelte.ts`): this is the ONE `.svelte.ts` wiring module — plain
// runes, no `.svelte` component imported — that derives `mapExtra` (the `composeStyle()`
// contribution: zones/raster/overlays/selection/legend) from `sel`/`boot`/`manifest`, so
// Shell.svelte can read it whenever `sel.lens === "scores"` REGARDLESS of whether the panel/sheet
// happens to have mounted `ScoresLens.svelte` at all.
//
// The bug this fixes (owner's report, live 0.10.17): `Panel.svelte` renders its children only
// while `!geometry.collapsed` (desktop only — `Sheet.svelte`'s phone body always renders, just
// CSS-hidden at "peek"), and the scores panel's body used to be the ONLY place `scoresMapInputs()`
// ever ran (a `$effect` inside `ScoresLens.svelte` writing a `bind:mapExtra` prop). Collapse the
// desktop panel and that component is never mounted at all, so `mapExtra` stays `{}` forever and
// `composeStyle()` gets `raster: null` — the score raster (and the floating legend) never paints,
// even though the map itself is fully visible.
//
// Shell.svelte loads this module the SAME way it loads `ScoresLens.svelte`/`ScoresLegend.svelte` —
// a dynamic `import()` triggered by `sel.lens === "scores"`, never by the panel/tool — so a
// species-only session still never downloads a byte of this (`tests/shell/lazy-lens-imports.test.ts`'s
// spirit, even though that scan only polices `.svelte` SFCs by name: this module pulls in
// `mapInputs.ts`/`boot.ts`/`raster.ts`/`zoneFill.ts`, which is exactly the weight D13's fix moved
// OUT of the static bundle in the first place).
//
// atlas-8 review round 2, item M1 (the SAME class of bug, moved one layer down): the click
// handler, the `sel=` selection write and the popup lived in `ScoresLens.svelte` too — mounted
// ONLY inside the panel body, so a click did nothing with the desktop panel collapsed or the
// Places tool open (species wires its click at Shell level; scores did not). `handleMapClick`
// below is that same fix applied to clicks: a lens-level owner Shell.svelte calls from its ONE
// `map.on("click", ...)` listener (mirroring `src/lens/species/state.svelte.ts#handleMapClick`),
// regardless of which tool/panel is open. usability M9: the popup opens AT ONCE with a "Loading
// value…" line (`popup.ts#cellPopupLoadingText`) and is filled in once the engine answers, rather
// than staying invisible for however long the click-to-value round trip takes (observed: no
// popup for > 3.5s).
//
// `ScoresLens.svelte` still owns everything that needs the PANEL to exist at all — the clicked
// cell's flower fetch, the species/zones table — it just READS this module's `unit`/`lyr`/
// `selection`/`mapSelection`/`showOutsidePra`/`mapExtra` instead of recomputing them, and writes
// user choices back through `selStore` exactly as before (every choice is already in the URL —
// `showOutsidePra` is the one exception, ephemeral chrome same as `Panel.svelte`'s own geometry,
// so it lives here as plain `$state` rather than round-tripping through `sel`).
import type { Popup } from "maplibre-gl";
import type { SelStore } from "../../lib/state/sel.svelte";
import type { MapHandle } from "../../lib/map/map";
import { mapClick, type QueryableMap } from "../../lib/map/interaction";
import { createPopup } from "../../lib/map/popup";
import { announce } from "../../lib/ui/announcer";
import { gridFromBoot, tileOf } from "../../lib/grid/grid";
import { effectiveLyr, effectiveUnit } from "./fallback";
import {
  cellRing,
  formatCellToken,
  formatZoneToken,
  parseScoresSelection,
  type ScoresSelection,
} from "./selection";
import { scoresMapInputs, type ScoresMapInputs, type ScoresMapState } from "./mapInputs";
import type { ManifestOverlayRow } from "./raster";
import { layerByKey, metricLabelsFromManifest, zoneRows } from "./boot";
import { fetchCellValue } from "./cellClick";
import { getAnalysisSources } from "./engine";
import {
  cellPopupAnnounceText,
  cellPopupLoadingText,
  cellPopupText,
  zonePopupAnnounceText,
  zonePopupText,
} from "./popup";

/** the map ring's own shape — a cell's centre + half-extents (pure arithmetic on the release's
 * grid) or a zone key to outline; `ScoresMapState["selection"]`'s own type, named here so
 * `ScoresLens.svelte` does not need to import it out of `mapInputs.ts` just for this. */
export type ScoresMapSelection = ScoresMapState["selection"];

export interface ScoresLensDeps {
  selStore: SelStore;
  boot: () => unknown;
  manifest: () => unknown;
  /** the resolved release version, once `window.__early.version` settles — `handleMapClick`'s own
   * engine-backed value fetch needs it (mirrors `src/lens/species/state.svelte.ts`'s `ver` dep). */
  ver: () => string | null;
  mapHandle: () => MapHandle | undefined;
}

export interface ScoresLens {
  /** the release's own drawable unit type, or `"cell"` — `sel.unit` already fallen back
   * (`fallback.ts#effectiveUnit`) for an unrecognized/stale value. */
  readonly unit: string;
  /** the resolved `metric_key` — `sel.lyr` already fallen back (`fallback.ts#effectiveLyr`); never
   * `undefined` once a release's `boot` has loaded. */
  readonly lyr: string | null;
  /** `manifest.overlays`, read once here so `ScoresLens.svelte`/`LayersPanel.svelte` never derive
   * it a second time. */
  readonly manifestOverlays: readonly ManifestOverlayRow[] | null;
  /** R3 orchestrator audit item 3: `metric_key` -> the manifest's own SHORT label
   * (`boot.ts#metricLabelsFromManifest`) — read once here for the SAME reason as
   * `manifestOverlays`, so the legend title and the layer picker's `<select>` never disagree. */
  readonly metricLabels: Record<string, string>;
  /** `sel.sel` parsed (`selection.ts#parseScoresSelection`) — the selection AS THE FLOWER/SPECIES/
   * TABLE panels see it (`cell:<id>` keeps the raw cell id). */
  readonly selection: ScoresSelection;
  /** the SAME selection, reshaped into what `scoresMapInputs` needs for the map ring. */
  readonly mapSelection: ScoresMapSelection;
  /** the "cells outside Program Areas" overlay switch — ephemeral chrome (module header), never
   * written to `sel`. */
  readonly showOutsidePra: boolean;
  setShowOutsidePra(value: boolean): void;
  /** this lens' `composeStyle()` contribution — `scoresMapInputs()` is null-`boot`-safe (an empty
   * `zones`/`raster: null`/an "unavailable" legend, same as `ScoresLens.svelte`'s own effect
   * produced before this fix, before `boot` has ever loaded), so this is never `undefined`. */
  readonly mapExtra: ScoresMapInputs;
  /** item M1's fix: the click → selection → popup path, owned here so it runs with no panel
   * mounted at all (a collapsed desktop panel, or the Places tool open). Shell.svelte calls this
   * from its ONE `map.on("click", ...)` listener; self-guards on `sel.lens !== "scores"`, same as
   * `src/lens/species/state.svelte.ts#handleMapClick`. */
  handleMapClick(
    lngLat: { lng: number; lat: number },
    point: { x: number; y: number },
  ): Promise<void>;
}

export function createScoresLens(deps: ScoresLensDeps): ScoresLens {
  let showOutsidePra = $state(false);

  const manifestOverlays = $derived(
    (deps.manifest() as { overlays?: ManifestOverlayRow[] } | null)?.overlays ?? null,
  );
  const metricLabels = $derived(metricLabelsFromManifest(deps.manifest()));

  const unit = $derived(effectiveUnit(deps.selStore.sel.unit, deps.boot()));
  const lyr = $derived(effectiveLyr(deps.selStore.sel.lyr, deps.boot()));

  const selection: ScoresSelection = $derived(parseScoresSelection(deps.selStore.sel.sel));

  const mapSelection: ScoresMapSelection = $derived.by(() => {
    if (!selection) return null;
    if (selection.kind === "zone") return selection;
    try {
      return { kind: "cell" as const, ...cellRing(selection.cellId, gridFromBoot(deps.boot())) };
    } catch {
      return null; // no boot.grid yet (Tier 0 hasn't loaded) — draw no ring rather than throw
    }
  });

  const mapExtra: ScoresMapInputs = $derived.by(() =>
    scoresMapInputs({
      boot: deps.boot(),
      overlays: manifestOverlays,
      unit,
      lyr,
      palette: deps.selStore.sel.pal,
      showOutsidePra,
      selection: mapSelection,
      metricLabels,
    }),
  );

  // --- item M1 / usability M9: the click -> selection -> popup path, owned here so it runs with
  // no panel mounted at all -- plain module state (a MapLibre popup is DOM/MapLibre state, not
  // something a template reads; mirrors species' `state.svelte.ts` own `mapLibrePopup`).
  let mapLibrePopup: Popup | null = null;
  let popupToken = 0;

  function clearPopup(): void {
    mapLibrePopup?.remove();
    mapLibrePopup = null;
  }

  function showPopup(
    lngLat: { lng: number; lat: number },
    html: string,
    announceText: string,
  ): void {
    const handle = deps.mapHandle();
    clearPopup();
    if (!handle) return;
    mapLibrePopup = createPopup()
      .setLngLat([lngLat.lng, lngLat.lat])
      .setHTML(html)
      .addTo(handle.map);
    announce(announceText);
  }

  /** usability M9: replaces the CURRENT popup's content in place (no flicker of remove+add) when
   * it is still the one this click opened; falls back to a fresh `showPopup` if it was cleared
   * meanwhile (Esc, or a later click already superseded it and cleared it first). */
  function updatePopup(
    lngLat: { lng: number; lat: number },
    html: string,
    announceText: string,
  ): void {
    if (mapLibrePopup) {
      mapLibrePopup.setHTML(html);
      announce(announceText);
    } else {
      showPopup(lngLat, html, announceText);
    }
  }

  // the Esc-closes-the-popup shortcut (fix list #12's own rule, moved here so it works with no
  // panel mounted) -- a plain, app-lifetime listener: this factory runs exactly ONCE per page load
  // (Shell.svelte instantiates it once, whenever `sel.lens` first becomes "scores", and never
  // discards it -- see this module's own header), the same lifetime `document` itself has.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") clearPopup();
  });

  async function showCellPopup(
    cellId: number,
    lngLat: { lng: number; lat: number },
    token: number,
    prevSel: string | undefined,
  ): Promise<void> {
    const bootObj = deps.boot() as Record<string, unknown>;
    const ver = deps.ver();
    let value: number | null = null;
    try {
      if (ver && lyr) {
        const grid = gridFromBoot(bootObj);
        const tile = tileOf(cellId, grid);
        const sources = await getAnalysisSources(ver, bootObj);
        value = await fetchCellValue(sources, { cellId, tile, metricKey: lyr });
        console.log("DIAG2 value resolved:", value, "cellId", cellId, "lyr", lyr);
      } else {
        console.log("DIAG2 skipped: ver=", ver, "lyr=", lyr);
      }
    } catch (err) {
      console.log(
        "DIAG2 caught:",
        err instanceof Error ? err.message + " " + err.stack : String(err),
      );
      value = null; // no engine / no tile for this cell (off-grid, unscored) — "no value", not a throw
    }
    if (token !== popupToken) return; // a later click superseded this one
    // R3/D4 (Opus 5.5 eyes-on, 2026-09-24): the manifest's own SHORT per-metric label
    // (`metricLabels`, `boot.ts#metricLabelsFromManifest`) — `boot.layers[].label` is the LONG
    // description text ("Primary productivity: Oregon State Vertically Generalized Production
    // Model (VGPM)..."), which used to print verbatim in a one-line popup. Falls back to the long
    // label, then the bare metric_key, exactly as before, when a release's manifest has not
    // published a short name for this metric yet.
    const label = (lyr && metricLabels[lyr]) || layerByKey(bootObj, lyr)?.label || lyr || "value";
    const input = { cellId, lon: lngLat.lng, lat: lngLat.lat, layerLabel: label, value };
    // D3(a) round 2 (orchestrator, 2026-09-24 -- fixes a regression the FIRST D3 fix introduced):
    // `handleMapClick` below now writes `sel` EAGERLY, synchronously, on click -- exactly the
    // pre-D3 behaviour -- so the URL/selection updates at once regardless of how long (or whether
    // at all) this async value confirmation takes. Gating the WRITE itself on that confirmation
    // (the original D3(a) design) coupled two different things that do not fail together: "is this
    // click on a scored cell" (fast, should never depend on the analysis engine succeeding) and
    // "what value does the popup show" (genuinely needs the engine). `e2e/scores.collapsed-panel.
    // spec.ts`'s M1 tests click a genuinely scored ocean cell in a fixture that permanently blocks
    // `.wasm` (no panel/engine can ever boot there) and still expect `sel=cell:` promptly -- the
    // ORIGINAL design could never satisfy that, panel-mounted or not (verified: the same fixture's
    // OTHER M1 variant, "Places tool open", failed identically, with no panel involved at all).
    //
    // The D3 UX contract survives via RETRACTION instead of a gated write: once the fetch
    // genuinely CONFIRMS no value (resolves null, or throws -- a real, prompt answer either way),
    // and nothing has changed the selection since this click's own eager write, roll `sel` back to
    // whatever it was immediately before this click (`prevSel`) -- so a no-value click still never
    // PERMANENTLY becomes the selection, matching `e2e/scores.popup.novalue.spec.ts`'s own
    // "previously selected cell stays selected" / "nothing becomes selected" assertions (both read
    // the URL only AFTER polling for the popup's own settled text, i.e. after this retraction has
    // already run). A confirmed VALUE needs no action: the eager write was already correct.
    if (value === null && deps.selStore.sel.sel === formatCellToken(cellId)) {
      deps.selStore.set({ sel: prevSel });
    }
    updatePopup(lngLat, cellPopupText(input), cellPopupAnnounceText(input));
  }

  return {
    get unit() {
      return unit;
    },
    get lyr() {
      return lyr;
    },
    get manifestOverlays() {
      return manifestOverlays;
    },
    get metricLabels() {
      return metricLabels;
    },
    get selection() {
      return selection;
    },
    get mapSelection() {
      return mapSelection;
    },
    get showOutsidePra() {
      return showOutsidePra;
    },
    setShowOutsidePra(value: boolean) {
      showOutsidePra = value;
    },
    get mapExtra() {
      return mapExtra;
    },

    async handleMapClick(
      lngLat: { lng: number; lat: number },
      point: { x: number; y: number },
    ): Promise<void> {
      if (deps.selStore.sel.lens !== "scores") return;
      const handle = deps.mapHandle();
      if (!handle) return;
      let grid;
      try {
        grid = gridFromBoot(deps.boot());
      } catch {
        return; // no boot.grid yet
      }
      // maplibre-gl's own .d.ts wants a `Point` class instance where `QueryableMap`
      // (interaction.ts, deliberately narrow for testability) accepts a plain `{x,y}` — a real Map
      // satisfies it at runtime (this IS how `queryRenderedFeatures` is documented to be called),
      // so this is a type-shape cast, not a behaviour change.
      const queryable = handle.map as unknown as QueryableMap;
      const result = mapClick(queryable, lngLat, point, { grid, units: mapExtra.zones ?? [] });
      const token = ++popupToken;
      clearPopup(); // closes on the next click, whatever it resolves to
      if (unit === "cell") {
        if (result.cellId !== null) {
          // D3(a) round 2 (orchestrator, 2026-09-24): `sel` is written EAGERLY here, before the
          // click's value is even known — restored to the pre-D3 behaviour, and for the same
          // reason: the URL/selection must never depend on the analysis engine settling (see
          // `showCellPopup`'s own header for the regression this fixes and why). `prevSel` is
          // captured first so `showCellPopup` can retract cleanly to exactly what was selected
          // before, not just clear it, once it confirms this cell carries no value.
          // usability M9: open at once, never wait on the engine — showCellPopup replaces this in
          // place once it answers.
          const prevSel = deps.selStore.sel.sel;
          deps.selStore.set({ sel: formatCellToken(result.cellId) });
          showPopup(
            lngLat,
            cellPopupLoadingText({ cellId: result.cellId, lon: lngLat.lng, lat: lngLat.lat }),
            "Loading value…",
          );
          void showCellPopup(result.cellId, lngLat, token, prevSel);
        }
      } else if (result.zone) {
        deps.selStore.set({ sel: formatZoneToken(result.zone.unit, result.zone.key) });
        const zRows = zoneRows(deps.boot(), result.zone.unit);
        showPopup(
          lngLat,
          zonePopupText(zRows, lyr, result.zone),
          zonePopupAnnounceText(zRows, lyr, result.zone),
        );
      }
    },
  };
}
