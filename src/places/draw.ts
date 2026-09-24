// places/draw.ts -- terra-draw as a LAZY chunk (Deliverable 3): polygon, rectangle, circle (a
// 64-gon) and a select/edit mode with midpoints, wired onto the shared map. CLAUDE.md: "terra-draw*
// is a forbidden static marker ... it MUST be a lazy chunk" -- nothing here is imported anywhere
// except through {@link loadTerraDraw}'s own dynamic `import()`, so it never reaches index.html's
// static graph (tests/places/lazyImports.test.ts is this pair's version of the upload pipeline's
// own lazy-import gate).
//
// terra-draw manages its OWN MapLibre sources/layers below this app's `composeStyle` stack (its
// adapter calls `addSource`/`addLayer` directly, by design) -- the one sanctioned exception to
// "a lens never touches MapLibre directly" (docs/map.md), because drawing/editing vertices live
// entirely inside terra-draw's own interaction model and re-deriving that on top of composeStyle
// would duplicate a library whose whole job is exactly this.
import type { AreaGeometry } from "../lib/geo/types";
// `import type` is erased under `verbatimModuleSyntax` (tests/geo/upload/lazyImports.test.ts's own
// regex explicitly excludes it, and `parsers/index.ts` relies on the identical exception) -- so
// this costs nothing at runtime and does not defeat the dynamic-only rule the module header states.
import type { TerraDrawEventListeners } from "terra-draw";

/** terra-draw's `FeatureId` is not re-exported at the package's top level (only used internally
 * and inside `TerraDrawEventListeners`'s own signatures) -- derived rather than duplicated.
 * Exported so a caller (Places.svelte) can key its own feature-id -> place-index map on it. */
export type FeatureId = Parameters<TerraDrawEventListeners["finish"]>[0];

/** same derivation, same reason: terra-draw's `OnFinishContext` (`{ mode, action }`) is not
 * re-exported at the package's top level either. `action` is what distinguishes a FRESH draw
 * (`"draw"`) from every EDIT of a feature that already exists (`"dragCoordinate"`,
 * `"dragCoordinateResize"`, `"dragFeature"`, `"insertMidpoint"`, `"deleteCoordinate"`) -- terra-draw
 * fires the SAME `finish` event for both (P9, the "editing a drawn shape duplicates it" bug; see
 * `onFinish`'s own comment below). */
type OnFinishContext = Parameters<TerraDrawEventListeners["finish"]>[1];

export type DrawShape = "polygon" | "rectangle" | "circle";

/** the loaded module pair -- injectable so a test never has to load the real (heavy) library. */
export type TerraDrawModules = {
  core: typeof import("terra-draw");
  adapter: typeof import("terra-draw-maplibre-gl-adapter");
};

export function loadTerraDraw(): Promise<TerraDrawModules> {
  return Promise.all([import("terra-draw"), import("terra-draw-maplibre-gl-adapter")]).then(
    ([core, adapter]) => ({ core, adapter }),
  );
}

/** Deliverable 3: "circle (stored as a 64-gon)". */
export const CIRCLE_SEGMENTS = 64;

export interface DrawSessionOptions {
  /** the raw MapLibre `Map`. Typed `unknown` here so this module makes no static import of
   * `maplibre-gl` beyond what `map/map.ts` already does app-wide; the one cast this needs lives at
   * the adapter construction below, next to the comment explaining it. */
  map: unknown;
  /**
   * Fires once per finished polygon (Deliverable 3: "on finish the outline is redrawn from the
   * decoded geometry"), and once per finished EDIT too -- terra-draw's `finish` event covers both a
   * fresh draw and leaving select/edit mode on an existing feature (drag a corner, resize, drag the
   * whole shape, add/remove a midpoint), and Deliverable 3 asks for the same redraw-from-decoded
   * rule either way. `featureId` is the SAME id across a feature's fresh draw and every later edit
   * of it (terra-draw's own identity, stable for the store's lifetime), and `isNewFeature` is true
   * only when this finish IS the fresh draw (`action === "draw"`) -- the caller MUST NOT treat an
   * edit finish as a new shape (P9: that duplicated a place on every corner drag). The geometry
   * handed back is the RAW drawn/edited shape, unnormalized; the caller runs it through
   * `analysis/place.ts`'s `analysisGeometry()` before doing anything else with it (never analyse
   * what terra-draw drew directly).
   */
  onFinish: (featureId: FeatureId, geometry: AreaGeometry, isNewFeature: boolean) => void;
}

export interface DrawSession {
  /** switch to a drawing shape, or "select" to move/edit an existing feature (with midpoints). */
  setMode(mode: DrawShape | "select"): void;
  /** remove every drawn feature from terra-draw's own store (not from `#pl=` -- the caller already
   * holds the analysed geometry once `onFinish` has fired). */
  clear(): void;
  /** unregister every listener and tear down the adapter; safe to call once. */
  stop(): void;
}

function isAreaGeometry(g: unknown): g is AreaGeometry {
  const t = (g as { type?: unknown } | null)?.type;
  return t === "Polygon" || t === "MultiPolygon";
}

/** Start a terra-draw session on the shared map (Deliverable 3). `modules` is
 * {@link loadTerraDraw}'s resolved pair -- pass a fake pair in a test. */
export function createDrawSession(
  opts: DrawSessionOptions,
  modules: TerraDrawModules,
): DrawSession {
  const { core, adapter } = modules;

  // terra-draw's edit affordances (Deliverable 3: "select/edit with midpoints, touch works"),
  // identical for every drawable shape -- a drawn rectangle or circle is just a polygon once it
  // exists, so there is no reason to give it fewer edit handles than a freehand polygon gets.
  const editFlags = {
    feature: {
      draggable: true,
      coordinates: { midpoints: true, draggable: true, deletable: true },
    },
  };

  const draw = new core.TerraDraw({
    // the adapter's own `MapType` generic is whatever concrete Map class the host library passes;
    // this module deliberately never imports maplibre-gl's types (see the module header), so the
    // bridge from `unknown` is one explicit, narrow cast here rather than a wider one throughout.
    adapter: new adapter.TerraDrawMapLibreGLAdapter({
      map: opts.map,
    } as ConstructorParameters<typeof adapter.TerraDrawMapLibreGLAdapter>[0]),
    modes: [
      new core.TerraDrawPolygonMode(),
      new core.TerraDrawRectangleMode(),
      new core.TerraDrawCircleMode({ segments: CIRCLE_SEGMENTS }),
      new core.TerraDrawSelectMode({
        flags: { polygon: editFlags, rectangle: editFlags, circle: editFlags },
      }),
    ],
  });
  draw.start();

  const onFinish = (id: FeatureId, context: OnFinishContext) => {
    const feature = draw.getSnapshotFeature(id);
    if (feature && isAreaGeometry(feature.geometry)) {
      opts.onFinish(id, feature.geometry, context.action === "draw");
    }
  };
  draw.on("finish", onFinish);

  return {
    setMode(mode) {
      draw.setMode(mode);
    },
    clear() {
      draw.clear();
    },
    stop() {
      draw.off("finish", onFinish);
      draw.stop();
    },
  };
}
