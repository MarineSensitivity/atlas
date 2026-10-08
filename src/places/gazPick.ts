// places/gazPick.ts -- "Pick from gazetteer": click a polygon of the gazetteer PMTiles layer
// (composeStyle's `gazetteer` input) and get its `place_id`, which Places.svelte turns into a `p.`
// token via model.ts#addGazPlace. Like pickInstall.ts this is the hit-test only; the highlight and
// the add are the caller's.
//
// The tiles are built from each collection's parquet, so a feature carries `place_id` and `name`
// as properties (the collection's own columns). A feature without a `place_id` cannot be a
// reference, so it is ignored rather than guessed at.
import { GAZETTEER_FILL_ID } from "../lib/map/layers/gazetteer";

export interface GazPick {
  id: string;
  name: string;
}

export interface GazPickMapLike {
  queryRenderedFeatures(
    point: { x: number; y: number },
    options: { layers: string[] },
  ): readonly { properties?: Record<string, unknown> | null }[];
  on(type: string, listener: (e: unknown) => void): unknown;
  off(type: string, listener: (e: unknown) => void): unknown;
}

/** the first feature of the gazetteer fill under a screen point that carries a `place_id`. */
export function gazPickAtPoint(
  map: Pick<GazPickMapLike, "queryRenderedFeatures">,
  point: { x: number; y: number },
): GazPick | null {
  let features: ReturnType<GazPickMapLike["queryRenderedFeatures"]>;
  try {
    features = map.queryRenderedFeatures(point, { layers: [GAZETTEER_FILL_ID] });
  } catch {
    return null; // the layer is not in the style yet (a click racing the style swap)
  }
  for (const f of features) {
    const id = f.properties?.place_id;
    if (typeof id === "string" && id) {
      const name = f.properties?.name;
      return { id, name: typeof name === "string" ? name : "" };
    }
  }
  return null;
}

export interface GazPickHandle {
  uninstall(): void;
}

/** listen for map clicks and report the gazetteer feature under each one (if any). */
export function installGazPick(
  map: GazPickMapLike,
  onPick: (pick: GazPick) => void,
  onMiss?: () => void,
): GazPickHandle {
  const onClick = (raw: unknown) => {
    const e = raw as { point: { x: number; y: number } };
    const pick = gazPickAtPoint(map, e.point);
    if (pick) onPick(pick);
    else onMiss?.();
  };
  map.on("click", onClick);
  return {
    uninstall() {
      map.off("click", onClick);
    },
  };
}
