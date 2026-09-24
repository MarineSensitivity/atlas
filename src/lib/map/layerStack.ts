// R3 (2026-09-24, Ben's decision, `docs/usability.md` §7 R3 / round-2 plan §5 U4/§10): "one Layers
// panel that IS the stack, the data row expanding into today's controls — PLUS the ability to
// change the stacking of data layers (Program Areas, the score raster) relative to map layers
// (place names, bathymetry): some map layers belong on top of, some underneath, a semi-transparent
// data layer."
//
// This module is the pure, unit-tested stack MODEL — no MapLibre, no Svelte, no DOM. `style.ts`
// consumes it (composeStyle still returns ONE style object, one `setStyle(diff:true)` — CLAUDE.md's
// "one MapLibre style" rule; this is a REORDER/opacity input to that one call, never a second style
// or a second `setLayoutProperty` after the fact). `state/codec.ts` consumes its parse/format pair
// for the `layers=` URL key (plan D8/U4 Deliverable 2 — "deviations from the default stack live in
// the query"). `src/lib/ui/LayersPanel.svelte` (both lenses) renders it.
//
// Borrows CalCOFI explore's shape (`src/layers.tsx`/`src/state.ts`'s `LayerStyle[]`/`layers=`) —
// see `atlas-refs/"calcofi explore review.md"` and the round-2 plan §10 — adapted to this app's
// CARTO-merged-whole-style basemap (`style.ts#mergeCartoStyle`) instead of CalCOFI's own
// per-dataset PMTiles registry: there is no per-basemap-FEATURE registry here, only five coarse
// ROLES a merged CARTO layer is classified into (`classifyBasemapLayer`, below).

/** the basemap's five roles, bottom-to-top as CARTO's OWN style.json already draws them (land under
 * water under boundaries under roads under labels — every real vector basemap style is already
 * ordered this way; this module only gives that existing order NAMES a user can move relative to
 * the data). `basemap-bathymetry` has no CARTO layer today (CARTO ships no relief/depth/contour
 * layer) — the group exists, EMPTY and disabled (`LAYER_GROUP_ENABLED`), ready for a GEBCO PMTiles
 * source later (round-2 plan §5 U4's own words) without a second stack-model change. */
export const BASEMAP_GROUPS = [
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
] as const;
export type BasemapGroupId = (typeof BASEMAP_GROUPS)[number];

/** the lens's data, in draw order today: the score/species raster (+ its species range fill —
 * folded into ONE row, "the lens's data", per the deliverable's own "raster (score or species)"
 * wording), the Program-Area choropleth/outlines, and the places/selection highlight. `data-places`
 * folds in what the deliverable lists separately as "places (outline, cells, pick highlight)" AND
 * "selection": both draw through the SAME `selection-fill`/`selection-line` pair in `style.ts`
 * (one GeoJSON source, `SELECTION_SOURCE_ID`) — there is no second source/layer pair to split them
 * across two independently-orderable rows without a deeper refactor of `places/` and the click/pick
 * wiring, which is out of R3's scope. Flagged for the Opus review, per this task's own instructions. */
export const DATA_GROUPS = ["data-raster", "data-zones", "data-places"] as const;
export type DataGroupId = (typeof DATA_GROUPS)[number];

export type LayerGroupId = BasemapGroupId | DataGroupId;

/** every group id, in the STACK's own canonical listing order (not draw order — `DEFAULT_LAYER_STACK`
 * is the draw order). Used to validate a parsed `layers=` token names only real groups. */
export const ALL_LAYER_GROUPS: readonly LayerGroupId[] = [...BASEMAP_GROUPS, ...DATA_GROUPS];

export function isLayerGroupId(v: string): v is LayerGroupId {
  return (ALL_LAYER_GROUPS as readonly string[]).includes(v);
}

/** the panel's row label for each group — plain title case, not a release-derived string (unlike
 * `style.ts#layersControlLabel`, which reads real layer ids): the STACK is chrome the app defines,
 * not data the release publishes. */
export const LAYER_GROUP_LABEL: Record<LayerGroupId, string> = {
  "basemap-land": "Land & water",
  "basemap-bathymetry": "Bathymetry",
  "basemap-boundaries": "Boundaries",
  "basemap-roads": "Roads & buildings",
  "basemap-labels": "Place labels",
  "data-raster": "Data",
  "data-zones": "Program Areas",
  // "Selection", never a label containing the word "Places" -- the tool rail already has a
  // button named exactly "Places" (`src/shell/tools.ts`), and this row's own move buttons carry
  // its label INSIDE their aria-label ("Move {label} up/down…"); a label containing "Places" made
  // `getByRole("button", {name: "Places"})` (an existing e2e locator, substring-matched by
  // default) resolve to three buttons instead of one (measured:
  // e2e/scores.collapsed-panel.spec.ts went red the moment this row existed).
  "data-places": "Selection",
};

/** `basemap-bathymetry` renders nothing today (no GEBCO source yet) — the panel shows it disabled
 * rather than hiding it, so the row's PRESENCE documents "this is coming," per the deliverable. */
export const LAYER_GROUP_ENABLED: Record<LayerGroupId, boolean> = {
  "basemap-land": true,
  "basemap-bathymetry": false,
  "basemap-boundaries": true,
  "basemap-roads": true,
  "basemap-labels": true,
  "data-raster": true,
  "data-zones": true,
  "data-places": true,
};

/**
 * The default stack, bottom (index 0) to top (last) — draw order, the same convention
 * `style.ts#LAYER_ORDER` already used. This is EXACTLY today's rendering (every basemap sub-role
 * sits where the old single "basemap" role sat, all of it under the raster): moving `basemap-labels`
 * above `data-raster` is a NEW capability this stack adds, not a change to what a fresh page shows.
 */
export const DEFAULT_LAYER_STACK: readonly LayerGroupId[] = [
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "data-raster",
  "data-zones",
  "data-places",
];

export interface LayerStackEntry {
  id: LayerGroupId;
  visible: boolean;
  /** 0..1. `1` is the no-op default — `style.ts` never touches a layer's own paint when a group's
   * opacity is exactly 1, so a release's zoom-dependent CARTO paint expression is only overridden
   * once the viewer actually moves the slider (this module's own `applyLayerGroupStyling`). */
  opacity: number;
}

export function defaultLayerStackEntries(): LayerStackEntry[] {
  return DEFAULT_LAYER_STACK.map((id) => ({ id, visible: true, opacity: 1 }));
}

/** true iff `entries` is draw-order-and-value identical to `defaultLayerStackEntries()` — the
 * "is this a default?" comparison `state/codec.ts#formatSel` needs (mirrors every other field's own
 * `!== DEFAULT_SEL.x` check) and what "Reset layers" restores. */
export function isDefaultLayerStack(entries: readonly LayerStackEntry[]): boolean {
  const def = defaultLayerStackEntries();
  return (
    entries.length === def.length &&
    entries.every(
      (e, i) => e.id === def[i].id && e.visible === def[i].visible && e.opacity === def[i].opacity,
    )
  );
}

// --- classifying a merged CARTO layer into one of the five basemap roles -----------------------

/** the slice of a (post-`mergeCartoStyle` prefixed) layer this needs to classify it — deliberately
 * NOT the real `LayerSpecification` union, so this stays a plain function `tests/map/layerStack.test.ts`
 * can call with a two-field object, no `maplibre-gl` import needed. */
export interface ClassifiableLayer {
  id: string;
  type: string;
}

const BOUNDARY_RE = /boundary/i;
const ROADS_RE = /road|street|bridge|tunnel|building|railway|rail|aeroway|path|ferry/i;
const BATHYMETRY_RE = /bathy|hillshade|relief|contour|depth/i;

/**
 * Which of the five basemap roles a real CARTO layer belongs in — a TOTAL function (never throws,
 * never returns "none of these"): every layer this app has ever merged from CARTO's dark-matter/
 * positron style.json lands in exactly one bucket, which is the property
 * `tests/map/layerStack.test.ts` asserts over a representative sample of CARTO's real
 * (openmaptiles-schema) layer ids covering every bucket, plus an arbitrary unknown id (falls to
 * `basemap-land`, the "everything else" bucket — water/landuse/landcover/park/background, same as
 * today's undifferentiated "basemap" role).
 *
 * Order matters: a symbol layer is ALWAYS a label (CARTO's road-shield and POI-icon symbol layers
 * carry text too, and text is exactly the thing a viewer wants to promote above a semi-transparent
 * raster — Ben's example), checked before the id-keyword rules so a symbol layer named e.g.
 * "road_major_label" is not miscaught by the roads pattern first.
 */
export function classifyBasemapLayer(layer: ClassifiableLayer): BasemapGroupId {
  if (layer.type === "symbol") return "basemap-labels";
  if (BOUNDARY_RE.test(layer.id)) return "basemap-boundaries";
  if (ROADS_RE.test(layer.id)) return "basemap-roads";
  if (BATHYMETRY_RE.test(layer.id)) return "basemap-bathymetry";
  return "basemap-land";
}

// --- applying a group's visible/opacity onto one composed layer ---------------------------------

/** the paint propert(y/ies) each MapLibre layer TYPE uses for "how opaque" — `applyLayerGroupStyling`
 * sets these DIRECTLY (never multiplies an existing expression: CARTO's own paint can be a
 * zoom-dependent `interpolate` expression, and this app has no general expression-algebra to fold a
 * flat opacity into one correctly) whenever a group's opacity is not the default `1`. A `symbol`
 * layer may carry an icon, text, or both — both keys are set; MapLibre ignores a paint property a
 * layer's `layout` never uses (e.g. `icon-opacity` on a text-only symbol layer costs nothing). */
const OPACITY_PAINT_KEYS: Record<string, readonly string[]> = {
  background: ["background-opacity"],
  raster: ["raster-opacity"],
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  circle: ["circle-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
};

/** `layout`/`paint` are typed `unknown` here, deliberately looser than `Record<string, unknown>`:
 * MapLibre's real per-layer-type `LayerSpecification.layout`/`.paint` interfaces (no index
 * signature) are NOT assignable to `Record<string, unknown>` in TypeScript ("index signature is
 * missing"), so a stricter field type here would reject every real caller (`style.ts` passes a real
 * `LayerSpecification`). `unknown` accepts anything on the way IN; the function's own body narrows
 * with a cast before spreading, and the generic `<L extends StyleLikeLayer>` preserves the caller's
 * EXACT concrete type on the way OUT (so `style.ts` gets back the same `LayerSpecification` variant
 * it passed in, not this loose shape). */
export interface StyleLikeLayer {
  type: string;
  layout?: unknown;
  paint?: unknown;
}

/**
 * Applies one stack entry's `visible`/`opacity` onto one already-built layer — never by removing it
 * or by calling `setLayoutProperty` after the fact (CLAUDE.md: "one composed style"; the SAME
 * technique `layers/zones.ts#zoneUnitsWithOutline` already uses for `out=`'s line visibility). Pure:
 * returns a new object, never mutates `layer`.
 *
 * `entry.visible === false` sets `layout.visibility: "none"` regardless of type (every MapLibre
 * layer type honours it). `entry.opacity !== 1` overrides that type's opacity paint key(s) — a type
 * this table does not name (there is none among what this app composes today) is left untouched
 * rather than throwing: an opacity slider that silently does nothing for a layer type nobody has
 * added yet is a smaller failure than a group row that crashes the map.
 */
export function applyLayerGroupStyling<L extends StyleLikeLayer>(
  layer: L,
  entry: Pick<LayerStackEntry, "visible" | "opacity">,
): L {
  let out: StyleLikeLayer = layer;
  if (!entry.visible) {
    out = {
      ...out,
      layout: { ...(out.layout as Record<string, unknown> | undefined), visibility: "none" },
    };
  }
  if (entry.opacity !== 1) {
    const keys = OPACITY_PAINT_KEYS[out.type];
    if (keys && keys.length > 0) {
      const paint: Record<string, unknown> = {
        ...(out.paint as Record<string, unknown> | undefined),
      };
      for (const k of keys) paint[k] = entry.opacity;
      out = { ...out, paint };
    }
  }
  return out as L;
}

// --- URL codec: `layers=` -------------------------------------------------------------------------
//
// Grammar (documented again, verbatim, in `docs/map.md`):
//   layers=<id>[:h][:oNN],<id>[:h][:oNN],...
//   order = draw order, bottom to top; a KNOWN group missing from the token is appended at its
//   default relative position (forward-compat: a release that adds a group later never orphans an
//   old link); an unknown id is ignored; `:h` = hidden (visible=false); `:oNN` = opacity NN percent,
//   01-99 (100/opacity 1 is the default and is never written); omitted key = the default stack.

const OPACITY_TOKEN_RE = /^o([0-9]{2})$/;

function parseOneToken(token: string): { id: string; visible: boolean; opacity: number } | null {
  const parts = token.split(":");
  const id = parts[0];
  if (!id) return null;
  let visible = true;
  let opacity = 1;
  for (const flag of parts.slice(1)) {
    if (flag === "h") {
      visible = false;
      continue;
    }
    const m = OPACITY_TOKEN_RE.exec(flag);
    if (m) {
      const pct = Number(m[1]);
      if (pct >= 1 && pct <= 99) opacity = pct / 100;
    }
    // an unrecognized flag is ignored, never thrown (codec.ts's "never throws" convention).
  }
  return { id, visible, opacity };
}

/**
 * `layers=` -> `LayerStackEntry[]`, or `null` (the default stack) for an absent/empty/fully-default
 * value. Never throws: an unknown group id is dropped, a KNOWN group missing from the token is
 * appended at the end in `DEFAULT_LAYER_STACK`'s own relative order among the missing ones (so a
 * link written before a new group existed still names every group once that group ships), and a
 * garbage flag is ignored on that one entry rather than failing the whole parse.
 */
export function parseLayerStack(v: string | null): LayerStackEntry[] | null {
  if (v === null || v.trim() === "") return null;
  const seen = new Set<LayerGroupId>();
  const out: LayerStackEntry[] = [];
  for (const token of v.split(",")) {
    const parsed = parseOneToken(token.trim());
    if (!parsed || !isLayerGroupId(parsed.id) || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push({ id: parsed.id, visible: parsed.visible, opacity: parsed.opacity });
  }
  for (const id of DEFAULT_LAYER_STACK) {
    if (!seen.has(id)) out.push({ id, visible: true, opacity: 1 });
  }
  if (out.length === 0) return null;
  return isDefaultLayerStack(out) ? null : out;
}

function formatOneToken(e: LayerStackEntry): string {
  const flags: string[] = [];
  if (!e.visible) flags.push("h");
  if (e.opacity !== 1) {
    const pct = Math.min(99, Math.max(1, Math.round(e.opacity * 100)));
    flags.push(`o${String(pct).padStart(2, "0")}`);
  }
  return flags.length > 0 ? `${e.id}:${flags.join(":")}` : e.id;
}

/** `LayerStackEntry[]` -> `layers=`'s value, or `null` (omit the key) when `entries` is `null`/
 * `undefined`/exactly the default stack — the same "write only a deviation" rule every other `Sel`
 * field follows (`state/codec.ts#formatSel`). */
export function formatLayerStack(
  entries: readonly LayerStackEntry[] | null | undefined,
): string | null {
  if (!entries || entries.length === 0 || isDefaultLayerStack(entries)) return null;
  return entries.map(formatOneToken).join(",");
}

// --- reordering (the panel's ▲▼ / drag) -----------------------------------------------------------

/** move the entry at `from` to `to` (clamped), returning a NEW array — the panel's ▲/▼ buttons and
 * drag-reorder both funnel through this one function, so there is exactly one reorder rule to test. */
export function moveLayerStackEntry(
  entries: readonly LayerStackEntry[],
  from: number,
  to: number,
): LayerStackEntry[] {
  if (from < 0 || from >= entries.length) return [...entries];
  const clampedTo = Math.min(Math.max(to, 0), entries.length - 1);
  const out = [...entries];
  const [moved] = out.splice(from, 1);
  out.splice(clampedTo, 0, moved);
  return out;
}
