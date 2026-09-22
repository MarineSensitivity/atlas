// Tile URL TEMPLATES for MapLibre raster sources (plan D4: rasters are *displayed* through stock
// titiler; numbers never come from it).
//
// MapLibre wants one template string carrying literal `{z}/{x}/{y}`; `src/lib/raster/tiles.ts`
// formats one concrete tile URL. Rather than writing the query string a second time here — the
// exact failure mode the "byte-for-byte contract" comment in tiles.ts warns about, since
// titiler/Varnish key their cache on the literal string — this module calls the SAME formatter with
// the placeholders as its z/x/y. There is still exactly one place a titiler URL is built.
import {
  titilerMaskTileUrl,
  titilerTileUrl,
  DEFAULT_TITILER_CONFIG,
  type RasterMaskTileParams,
  type RasterTileParams,
  type TitilerConfig,
} from "../../raster/tiles";
import { OUTSIDE_PRA_RGBA } from "../colors";

/** MapLibre's own placeholders, passed through `titilerTileUrl` verbatim. */
const Z = "{z}";
const X = "{x}";
const Y = "{y}";

/**
 * The score/metric tile template: `rescale` verbatim from the manifest (never re-rounded — the
 * legend rounds for display, the URL does not) and the chosen `colormap_name`.
 */
export function titilerTileTemplate(
  params: RasterTileParams,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): string {
  return titilerTileUrl(config, Z, X, Y, params);
}

/** the binary-mask overlay template (`_outside_pra`: `{"1":[34,34,34,255]}`), atlas-4 §6.2 step 5. */
export function titilerMaskTileTemplate(
  params: RasterMaskTileParams,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): string {
  return titilerMaskTileUrl(config, Z, X, Y, params);
}

/** `manifest.overlays._outside_pra`'s colormap, exactly as `msens::cog_tile_url(color = <the dark
 * grey in colors.ts's OUTSIDE_PRA_RGBA>)`
 * emits it (atlas-4 §6.2/§6.3). */
export const OUTSIDE_PRA_COLORMAP: Record<string, readonly [number, number, number, number]> = {
  "1": OUTSIDE_PRA_RGBA,
};

/** the five study-area keys (`msens::study_areas()`, atlas-4 §5.3). They are a CAMERA, never a
 * filter — apps#13/#14 — so none of them may ever reach a tile or data URL. */
export const STUDY_AREA_KEYS: readonly string[] = ["FULL", "AK", "AT", "GA", "PA"];

/** query-parameter names that would mean "the server filtered by study area". */
const STUDY_AREA_PARAM_RE = /^(area|study_area|studyarea|sr|subregion)$/i;

/**
 * Does `url` leak a study-area key? Returns the offending `name=value` pair, or `null` when clean.
 *
 * "The study area is a camera, never a filter" (atlas-4, plan apps#13/#14): the raster is ALWAYS
 * the `FULL` COG and `area` only flies the camera, so a study-area key appearing in a request is a
 * regression that silently changes what the numbers mean. Two rules, both on the query string only:
 * a parameter *named* like a study-area filter, and any parameter whose *value* is exactly a
 * study-area key. The `url=` parameter's own value is deliberately exempt from the second rule — it
 * is an opaque, content-addressed COG URL whose hash could contain the letters `AK` by chance, and
 * a false positive in a gate is worse than no gate.
 */
export function tileUrlLeaksStudyArea(
  url: string,
  keys: readonly string[] = STUDY_AREA_KEYS,
): string | null {
  const q = url.indexOf("?");
  if (q === -1) return null;
  // parsed by hand, not with URLSearchParams: the template's literal `{z}` braces are not a legal
  // URL and `new URL()` would re-encode the very string under test.
  for (const pair of url.slice(q + 1).split("&")) {
    const eq = pair.indexOf("=");
    const name = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (STUDY_AREA_PARAM_RE.test(name)) return pair;
    if (name === "url") continue;
    if (keys.includes(decodeURIComponent(value))) return pair;
  }
  return null;
}
