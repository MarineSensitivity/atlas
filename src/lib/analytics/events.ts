// The event vocabulary: the union of the scores app's and the species app's event names
// (atlas-refs/"parity scores app.md" §10 and atlas-refs/"parity species app.md" §10) plus the six
// atlas-only events the atlas-2 plan adds (places and reports have no Shiny precedent). Kept as one
// exhaustive union so `track()` (analytics.ts) rejects an unknown event name at compile time —
// nothing here performs a network call; see transport.ts for that seam.
export const EVENT_NAMES = [
  // scores app (parity scores app.md §10, app.R:1710-1740, 2840-2845, 3152, 3192-3199, 3239-3261)
  "select_tab",
  "select_subregion",
  "select_unit",
  "select_layer",
  "select_palette",
  "open_about",
  "start_tour",
  "open_table_info",
  "report_add_area",
  "download_species_csv",
  "report_submit",
  "report_result",
  // species app (parity species app.md §10, app.R:1186-1226, 1388-1392, 951-970)
  "select_species",
  "select_representation",
  "select_outlines",
  "toggle_us_only",
  "zoom_to_layer",
  "toggle_obis",
  "deeplink_mdl_key",
  "search_species",
  // atlas-only (plan atlas-2 `analytics/` contract: places and reports have no Shiny precedent)
  "place_draw",
  "place_upload",
  "place_share",
  "report_open",
  "report_export",
  "opfs_fallback",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Per-event param shapes. Only the params the source apps (or the plan) actually document are
 * typed strictly; `place_draw`/`place_upload`/`place_share`/`report_open` have no documented shape
 * (places and reports land in later phases) so they stay an open bag — which is exactly why
 * `sanitize.ts` strips `pl`/`t` at runtime rather than relying on the type system alone to keep
 * place geometry out of these events.
 */
export interface EventParamsMap {
  select_tab: { tab: string };
  select_subregion: { subregion: string };
  select_unit: { unit: string };
  select_layer: { layer: string; subregion?: string; unit?: string; mdl_key?: string };
  select_palette: { palette: string };
  open_about: Record<string, never>;
  start_tour: Record<string, never>;
  open_table_info: Record<string, never>;
  report_add_area: { area_type: string };
  download_species_csv: {
    n_rows: number;
    area: string;
    subregion?: string;
    unit?: string;
    layer?: string;
  };
  report_submit: {
    status: string;
    rpt_ver: string;
    format: string;
    n_areas: number;
    area_kinds: string;
    areas: string;
    title?: string;
  };
  report_result: {
    status: string;
    ms: number;
    rpt_ver: string;
    format: string;
    n_areas: number;
    report_url?: string;
    error?: string;
  };
  select_species: {
    mdl_key: string;
    scientific_name: string;
    common_name?: string;
    sp_cat?: string;
    taxon_id?: string;
    n_datasets?: number;
    redlist_code?: string;
    us_only?: boolean;
  };
  select_representation: { representation: string; mdl_key: string };
  select_outlines: { outlines: string };
  toggle_us_only: { enabled: boolean };
  zoom_to_layer: Record<string, never>;
  toggle_obis: { enabled: boolean };
  deeplink_mdl_key: { mdl_key: string; resolution: "input_model" | "merged_model" | "not_found" };
  search_species: { query: string };
  place_draw: Record<string, unknown>;
  place_upload: Record<string, unknown>;
  place_share: Record<string, unknown>;
  report_open: Record<string, unknown>;
  report_export: { format: string };
  opfs_fallback: { reason: string };
}
