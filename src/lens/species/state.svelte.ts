// The species lens' reactive orchestration (atlas-5 steps 1-3). This is the ONE file in
// `src/lens/species/**` that imports svelte — every rule it applies (shard loading, deep-link
// resolution, the layer bar/card view models, the camera, the click popup) lives in the plain,
// Node-testable modules beside it (`data/*.ts`, `mapInputs.ts`, `popup.ts`); this file is wiring
// only, the same division `src/lib/state/sel.svelte.ts` documents for itself.
//
// THE JIGGER GUARD (§11.12): a deep link to a specific INPUT must never flash the merged surface
// first. `resolving` stays true from mount until the initial deep-link resolution (if any) has
// fully settled — including the `selStore.set` that writes the FINAL `sp`/`in` — and every other
// effect here refuses to run while it is true. So the very first taxon fetch this module ever makes
// already carries the resolved `in`, not the URL's naive default.
import { untrack } from "svelte";
import { Popup } from "maplibre-gl";
import { gridFromBoot } from "../../lib/grid/grid";
import type { MapHandle } from "../../lib/map/map";
import type { CameraBoundsInput } from "../../lib/map/camera";
import { mapClick, type LngLat, type QueryableMap } from "../../lib/map/interaction";
import { createTitilerValueSource, type ValueSource } from "../../lib/raster/point";
import { paletteStopsFromBoot, type PaletteName } from "../../lib/raster/ramps";
import type { SelStore } from "../../lib/state/sel.svelte";
import type { Representation } from "../../lib/state/types";
import type { SessionLike } from "../../lib/release/dataBase";
import {
  cameraFor,
  refitNeeded,
  studyAreaView,
  FULL_STUDY_AREA,
  DEFAULT_CAMERA_PADDING,
  type Camera,
  type CameraKey,
} from "./data/camera";
import { documentTitle, speciesCard, type SpeciesCard } from "./data/card";
import { datasetIndex, layerBar, type DatasetIndex, type LayerBar } from "./data/layerBar";
import {
  deepLinkKey,
  resolveDeepLink,
  targetOf,
  MERGED_IN,
  type DeepLinkEvent,
} from "./data/resolve";
import { defaultSpecies, loadTaxa, type TaxaIndex } from "./data/picker";
import { builtinFetchJson, loadTaxon, type ShardError, type TaxonCard } from "./data/shards";
import { DEFAULT_SPECIES_COLORMAP, speciesMapInputs, type SpeciesMapInputs } from "./mapInputs";
import { popupContent, popupHtml, type PopupContent } from "./popup";

const EMPTY_MAP_INPUTS: SpeciesMapInputs = {
  raster: null,
  range: null,
  legend: null,
  notice: null,
  asset: null,
};

export interface NotFoundModalState {
  key: string;
  reasons: string[];
}

export interface SpeciesLensDeps {
  selStore: SelStore;
  /** the resolved release version, once `window.__early.version` settles. */
  ver: () => string | null;
  boot: () => unknown;
  session?: () => SessionLike | null;
  mapHandle: () => MapHandle | undefined;
  /** `Analytics["track"]`, injected so this module never imports `analytics.ts` directly and stays
   * testable without a GA4/gtag stack. */
  track?: (event: string, params: unknown) => void;
  fetchJson?: (url: string) => Promise<unknown>;
  valueSource?: ValueSource;
}

export interface SpeciesLens {
  readonly loading: boolean;
  readonly card: TaxonCard | null;
  readonly cardError: ShardError | null;
  readonly bar: LayerBar | null;
  readonly info: SpeciesCard | null;
  readonly mapInputs: SpeciesMapInputs;
  readonly docTitle: string | null;
  readonly notFound: NotFoundModalState | null;
  readonly popup: { lngLat: LngLat; content: PopupContent } | null;
  readonly taxaIndex: TaxaIndex | null;
  readonly datasets: DatasetIndex;

  dismissNotFound(): void;
  closePopup(): void;
  ensureTaxaIndex(): Promise<TaxaIndex | null>;
  selectSpecies(key: string): void;
  selectLayer(inKey: string): void;
  setRepresentation(rep: Representation): void;
  setUsOnly(enabled: boolean): void;
  zoomToLayer(): void;
  handleMapClick(lngLat: LngLat, point: { x: number; y: number }): Promise<void>;
}

/** the `Sel.in` <-> "was the click resolvable at all" pairing the camera needs (data/camera.ts). */
function cameraKeyOf(sel: { sp?: string; in: string; rep: Representation }): CameraKey {
  return { sp: sel.sp, in: sel.in, rep: sel.rep };
}

function boundsInputOf(cam: Camera): CameraBoundsInput | null {
  return cam.kind === "bounds" ? cam.bounds : null;
}

export function createSpeciesLens(deps: SpeciesLensDeps): SpeciesLens {
  const { selStore } = deps;
  const fetchJson = deps.fetchJson ?? builtinFetchJson;
  const valueSource = deps.valueSource ?? createTitilerValueSource(fetchJson);
  const track = deps.track ?? (() => {});

  let bootStarted = false;
  let loggedFirstSpecies = false;
  let resolving = $state(true);
  let loading = $state(false);
  let card = $state<TaxonCard | null>(null);
  let cardError = $state<ShardError | null>(null);
  let notFound = $state<NotFoundModalState | null>(null);
  let popup = $state<{ lngLat: LngLat; content: PopupContent } | null>(null);
  let taxaIndex = $state<TaxaIndex | null>(null);
  let prevCameraKey: CameraKey | null = null;
  let taxaLoadPromise: Promise<TaxaIndex | null> | null = null;
  /** the real MapLibre popup (§6.5 step 6: "opens immediately", MapLibre's own re-anchors it on
   * pan/zoom) — plain, not `$state`: it is DOM/MapLibre state, not something a template reads. */
  let mapLibrePopup: Popup | null = null;

  function clearMapPopup(): void {
    mapLibrePopup?.remove();
    mapLibrePopup = null;
    popup = null;
  }

  const datasets: DatasetIndex = $derived(
    datasetIndex((deps.boot() as { datasets?: unknown } | null)?.datasets),
  );

  const bar: LayerBar | null = $derived.by(() => {
    const ver = deps.ver();
    if (!card || !ver) return null;
    return layerBar(card, { ver, selectedInput: selStore.sel.in, datasets });
  });

  const info: SpeciesCard | null = $derived.by(() => {
    const ver = deps.ver();
    if (!card || !ver) return null;
    return speciesCard(card, { ver, selectedInput: selStore.sel.in, datasets });
  });

  const mapInputs: SpeciesMapInputs = $derived.by(() => {
    const ver = deps.ver();
    if (!bar || !ver || !card) return EMPTY_MAP_INPUTS;
    return speciesMapInputs(bar, {
      rep: selStore.sel.rep,
      boot: deps.boot() as { palettes?: unknown } | null,
      ver,
      legendTitle: card.sci,
    });
  });

  const docTitle: string | null = $derived.by(() => {
    if (!card) return null;
    // documentTitle only needs {selectedInput, datasets} — it derives the layer's own key/label
    // from `card` itself, so it stays correct even for a residual (merged: null) taxon.
    return documentTitle(card, { selectedInput: selStore.sel.in, datasets });
  });

  async function ensureTaxaIndex(): Promise<TaxaIndex | null> {
    if (taxaIndex) return taxaIndex;
    if (taxaLoadPromise) return taxaLoadPromise;
    const ver = deps.ver();
    if (!ver) return null;
    taxaLoadPromise = loadTaxa(ver, { fetchJson, session: deps.session?.() ?? null }).then(
      (res) => {
        if (res.ok) {
          taxaIndex = res.value;
          return res.value;
        }
        return null;
      },
    );
    return taxaLoadPromise;
  }

  // the release's ecoregion extent (§6.3's `er_bbox`) is not yet published anywhere this lens can
  // read (atlas-1 has not shipped it) — every `cameraFor()` call below passes `fallbackBbox: null`;
  // the fallback chain still holds without it, ending at the study-area view.

  function applyCamera(cam: Camera | null): void {
    const handle = deps.mapHandle();
    if (!handle || !cam) return;
    if (cam.kind === "bounds") {
      handle.flyToBounds(boundsInputOf(cam)!, { padding: cam.padding });
    } else {
      handle.flyTo({ key: cam.source, lon: cam.center[0], lat: cam.center[1], zoom: cam.zoom });
    }
  }

  async function bootstrap(ver: string): Promise<void> {
    try {
      // a throwaway, write-once parse of the page's INITIAL query string (never mutated again, and
      // never read by a template) — no template/effect needs Svelte's reactive wrapper to track it.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const initialParams = new URLSearchParams(location.search);
      const asked = deepLinkKey(initialParams);
      // ONLY a legacy id (mdl_key/mdl_seq) needs resolving through the alias shard. A modern
      // `sp=`(+`in=`) link is already canonical — codec.ts's parseSel (which ran before this
      // module even mounted) already put the right values in `selStore.sel`. Resolving it anyway
      // would be wrong, not just redundant: a merged key's alias entry always maps to itself with
      // `ds_key = "ms_merge"`, so re-running this for a plain `sp=` link would silently clobber an
      // already-correct `?sp=X&in=someInput` link's `in` back to "merged" on every load.
      if (asked?.legacy) {
        const result = await resolveDeepLink(ver, initialParams, {
          index: taxaIndex,
          fetchJson,
          session: deps.session?.() ?? null,
        });
        if (result.kind !== "none" && result.event) {
          track(result.event.name, result.event.params satisfies DeepLinkEvent["params"]);
        }
        if (result.kind === "species") {
          const target = targetOf(result, selStore.sel);
          if (target)
            selStore.set({ sp: target.sp, in: target.in, us: target.us, rep: target.rep });
        } else if (result.kind === "not-found") {
          notFound = { key: result.key, reasons: result.reasons };
        }
      }
      if (!selStore.sel.sp) {
        const idx = await ensureTaxaIndex();
        if (idx) {
          const key = defaultSpecies(idx);
          if (key) selStore.set({ sp: key });
        }
      }
    } finally {
      resolving = false;
    }
  }

  // --- effects --------------------------------------------------------------------------------

  $effect(() => {
    const ver = deps.ver();
    const lens = selStore.sel.lens;
    if (!ver || lens !== "species" || bootStarted) return;
    bootStarted = true;
    void bootstrap(ver);
  });

  $effect(() => {
    if (resolving) return; // the jigger guard (§11.12) — see module header
    const ver = deps.ver();
    const sp = selStore.sel.sp;
    if (!ver || !sp || selStore.sel.lens !== "species") return;
    loading = true;
    clearMapPopup(); // §6.2 step 1: `clear_markers()` at the start of every render observer run
    let cancelled = false;
    loadTaxon(ver, sp, { fetchJson, session: deps.session?.() ?? null }).then((res) => {
      if (cancelled) return;
      loading = false;
      if (res.ok) {
        card = res.value;
        cardError = null;
        // §10: "de-duplicated and SEEDED WITH THE DEFAULT SPECIES so the opening taxon is not
        // logged as a user choice" — the first species this session ever loads is exactly that
        // seed, whether it came from a deep link or the picker's own default; only a SUBSEQUENT
        // load (a real choice) logs.
        if (loggedFirstSpecies) {
          track("select_species", {
            mdl_key: card.key,
            scientific_name: card.sci,
            common_name: card.common ?? undefined,
            sp_cat: card.spCat,
            taxon_id: card.taxonId ?? undefined,
            n_datasets: card.inputs.length,
            redlist_code: card.rl ?? undefined,
            us_only: selStore.sel.us,
          });
        }
        loggedFirstSpecies = true;
      } else {
        card = null;
        cardError = res.error;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (docTitle) document.title = docTitle;
  });

  $effect(() => {
    if (resolving || !card) return;
    const key = cameraKeyOf(selStore.sel);
    // read-only comparison, not a dependency the effect should re-run for on its own — prevCameraKey
    // is plain (non-reactive) state precisely so switching `in`/`rep` alone (no species change)
    // does not retrigger this effect a second time once the camera has already been applied.
    const needsFit = untrack(() => refitNeeded(prevCameraKey, key));
    prevCameraKey = key;
    if (!needsFit) return;
    const boot = deps.boot();
    const cam = cameraFor(card, selStore.sel.in, {
      rep: selStore.sel.rep,
      fallbackBbox: null,
      studyArea: studyAreaView(boot, FULL_STUDY_AREA),
      padding: DEFAULT_CAMERA_PADDING,
    });
    applyCamera(cam);
  });

  return {
    get loading() {
      return loading;
    },
    get card() {
      return card;
    },
    get cardError() {
      return cardError;
    },
    get bar() {
      return bar;
    },
    get info() {
      return info;
    },
    get mapInputs() {
      return mapInputs;
    },
    get docTitle() {
      return docTitle;
    },
    get notFound() {
      return notFound;
    },
    get popup() {
      return popup;
    },
    get taxaIndex() {
      return taxaIndex;
    },
    get datasets() {
      return datasets;
    },

    dismissNotFound() {
      notFound = null;
    },
    closePopup() {
      clearMapPopup();
    },
    ensureTaxaIndex,

    selectSpecies(key: string) {
      selStore.set({ sp: key, in: MERGED_IN, rep: "native" });
    },
    selectLayer(inKey: string) {
      track("select_layer", { layer: inKey, mdl_key: card?.key ?? "" });
      selStore.set({ in: inKey });
    },
    setRepresentation(rep: Representation) {
      track("select_representation", { representation: rep, mdl_key: card?.key ?? "" });
      selStore.set({ rep });
    },
    setUsOnly(enabled: boolean) {
      track("toggle_us_only", { enabled });
      selStore.set({ us: enabled });
    },
    zoomToLayer() {
      track("zoom_to_layer", {});
      if (!card) return;
      const boot = deps.boot();
      const cam = cameraFor(card, selStore.sel.in, {
        rep: selStore.sel.rep,
        fallbackBbox: null,
        studyArea: studyAreaView(boot, FULL_STUDY_AREA),
        padding: DEFAULT_CAMERA_PADDING,
      });
      applyCamera(cam);
    },

    async handleMapClick(lngLat: LngLat, point: { x: number; y: number }): Promise<void> {
      if (selStore.sel.lens !== "species" || !card) return;
      // §6.5 step 6: opens on the FIRST click, immediately (not the second, as mapgl's own marker
      // popup would need) — set right away, one popup instance at a time.
      function show(content: PopupContent): void {
        popup = { lngLat, content };
        const handle = deps.mapHandle();
        mapLibrePopup?.remove();
        mapLibrePopup = handle
          ? new Popup({ closeButton: true, closeOnClick: true, maxWidth: "260px" })
              .setLngLat([lngLat.lng, lngLat.lat])
              .setHTML(popupHtml(content))
              .addTo(handle.map)
          : null;
      }

      const boot = deps.boot();
      let cellId: number | null = null;
      const handle = deps.mapHandle();
      if (boot && handle) {
        try {
          // `QueryableMap` (map/interaction.ts) is deliberately narrower than MapLibre's real `Map`
          // (built so a plain fake satisfies it in a test); the real map always satisfies it at
          // runtime — `queryRenderedFeatures`'s stricter `PointLike` param type is TS-only friction.
          cellId = mapClick(handle.map as unknown as QueryableMap, lngLat, point, {
            grid: gridFromBoot(boot),
            units: [],
          }).cellId;
        } catch {
          cellId = null;
        }
      }
      const asset = mapInputs.asset;
      const base = { sci: card.sci, lon: lngLat.lng, lat: lngLat.lat, cellId };
      if (!asset) {
        show(popupContent({ ...base, kind: "no-value" }));
        return;
      }
      if (asset.type === "pmtiles") {
        show(popupContent({ ...base, kind: "presence" }));
        return;
      }
      if (!asset.rescale) {
        show(popupContent({ ...base, kind: "no-value" }));
        return;
      }
      const value = await valueSource.pointValue({
        domain: "species",
        lon: lngLat.lng,
        lat: lngLat.lat,
        cogUrl: asset.url,
      });
      const stops = paletteStopsFromBoot(
        boot as { palettes?: unknown } | null,
        (asset.colormap ?? DEFAULT_SPECIES_COLORMAP) as PaletteName,
      );
      show(
        value === null
          ? popupContent({ ...base, kind: "no-value" })
          : popupContent({ ...base, kind: "value", value, rescale: asset.rescale, stops }),
      );
    },
  };
}
