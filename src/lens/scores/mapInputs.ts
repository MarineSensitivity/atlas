// atlas-4 step 1/2 — the scores lens' contribution to the ONE composed style (docs/map.md): given
// the release + the current `Sel`, produce the `zones`/`raster`/`overlays`/`selection` fields of
// `ComposeStyleInput`. Shell.svelte merges this with its own `theme`/`projection`/base `zones` and
// calls `composeStyle()` + `applyStyle()` — this module never touches MapLibre or calls either.
import { zoneUnitsFromBoot, zoneLabelsFromBoot } from "../../lib/map/layers/zones";
import type { RasterLayerSpec, SelectionSpec, ZoneUnitSpec } from "../../lib/map/types";
import { SELECTION_COLOR } from "../../lib/map/colors";
import { layerByKey, zoneRows, type BootLayerRow } from "./boot";
import { outsidePraOverlaySpec, scoreRasterSpec, type ManifestOverlayRow } from "./raster";
import { zoneChoropleth, zoneValuesFor } from "./zoneFill";
import type { PaletteName } from "../../lib/raster/ramps";

export interface ScoresMapInputs {
  zones: ZoneUnitSpec[];
  raster: RasterLayerSpec | null;
  overlays: RasterLayerSpec[];
  selection: SelectionSpec | null;
}

export interface ScoresMapState {
  boot: unknown;
  overlays: readonly ManifestOverlayRow[] | null | undefined;
  unit: string; // "cell" or the release's one drawable unit's type
  lyr: string | null; // resolved metric_key (never undefined at call time — the caller defaults it)
  palette: PaletteName;
  showOutsidePra: boolean;
  /** a cell ring (lon/lat centre + half-cell size) or a zone key to outline, or null. */
  selection:
    | { kind: "cell"; lon: number; lat: number; halfW: number; halfH: number }
    | { kind: "zone"; unit: string; key: string }
    | null;
}

/** the currently-selected zone's boundary as a `SelectionSpec`, resolved from the vector tile the
 * map already has loaded — the lens does not refetch geometry for a highlight, it filters the
 * existing zone layer via `map/style.ts`'s selection-line role over a synthetic point placeholder.
 * A cell ring is drawn directly (a tiny square polygon), which this module CAN build without the
 * map, since it is pure arithmetic on the grid. */
function cellRingSelection(
  sel: NonNullable<ScoresMapState["selection"]> & { kind: "cell" },
): SelectionSpec {
  const { lon, lat, halfW, halfH } = sel;
  const ring = [
    [lon - halfW, lat - halfH],
    [lon + halfW, lat - halfH],
    [lon + halfW, lat + halfH],
    [lon - halfW, lat + halfH],
    [lon - halfW, lat - halfH],
  ];
  return {
    features: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
      ],
    },
    color: SELECTION_COLOR,
  };
}

/**
 * Build this lens' `composeStyle` contribution. `zoneUnits` are always outline-only from
 * `zoneUnitsFromBoot` UNLESS `unit` (the current spatial-unit selection) matches, in which case the
 * unit's `fill` is filled in from the current layer's values (the choropleth branch). The raster +
 * overlay are populated only on the `cell` branch (parity doc §6.4: the two branches are mutually
 * exclusive — a zone choropleth clears the raster, and vice versa).
 */
export function scoresMapInputs(state: ScoresMapState): ScoresMapInputs {
  const layer: BootLayerRow | null = layerByKey(state.boot, state.lyr);
  const baseUnits = zoneUnitsFromBoot(state.boot).map((u) => ({
    ...u,
    labels: zoneLabelsFromBoot(state.boot, u.unit) ?? undefined,
  }));

  const isCellBranch = state.unit === "cell";
  const zones: ZoneUnitSpec[] = baseUnits.map((u) => {
    let out = u;
    if (!isCellBranch && u.unit === state.unit) {
      const values = zoneValuesFor(zoneRows(state.boot, u.unit), state.lyr ?? "");
      const choro = zoneChoropleth(
        u.unit,
        values,
        state.boot as { palettes?: unknown } | null | undefined,
        state.palette,
      );
      if (choro.fill) out = { ...out, fill: choro.fill };
    }
    if (state.selection?.kind === "zone" && state.selection.unit === u.unit) {
      out = { ...out, highlightKey: state.selection.key };
    }
    return out;
  });

  const raster = isCellBranch ? scoreRasterSpec(layer, state.palette) : null;
  const overlay = isCellBranch ? outsidePraOverlaySpec(state.overlays, state.showOutsidePra) : null;

  const selection: SelectionSpec | null =
    state.selection?.kind === "cell" ? cellRingSelection(state.selection) : null;

  return { zones, raster, overlays: overlay ? [overlay] : [], selection };
}
