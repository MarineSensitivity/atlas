// The `Sel` object — one plain shape, every field a piece of view state that a shared link has to
// reproduce (plan atlas-2 `state/`, master-plan D8's "the URL is the whole view"; key table in
// `../workflows/.claude/plans_todo/atlas-2 core runtime (release, state, grid, engine, OPFS,
// places).md`). No svelte here — see sel.svelte.ts for the one file in this directory that wraps
// this plain shape in a `$state` rune; everything else must stay plain-module testable under Node
// (CLAUDE.md "Testing pyramid" / "keep the parse/format core a plain module").
//
// `ver` is carried here purely so it round-trips structurally; WHETHER to ever write it back to the
// query is a host-mode decision ("release (public host only)") that belongs to whoever wires state/
// to release/ in a later phase — this module does not know if it is running on the public host or
// the preview host.

// R3 layer stack model (round-2 plan §5 U4): `LayerStackEntry`/`LayerGroupId` are the map domain's
// own types (`../map/layerStack.ts` — classification, opacity application, the `layers=` codec all
// live there). Importing them here is the SAME cross-domain precedent `../map/layers/zones.ts`
// already sets in the other direction (it imports `Outline` FROM this file) — this module still has
// no svelte/DOM/MapLibre dependency, only a plain type import.
import type { LayerStackEntry } from "../map/layerStack";
export type { LayerStackEntry } from "../map/layerStack";

export type Lens = "scores" | "species";
export type Palette = "spectral_r" | "viridis" | "cividis" | "magma";
export type Projection = "globe" | "mercator";
export type Representation = "native" | "model";
export type Outline = "programarea" | "ecoregion" | "none";
/** tri-state (fix round 1, atlas-3): `"auto"` is the default — never written to the URL — and
 * follows `prefers-color-scheme` at render time (`resolveTheme`, below); `"light"`/`"dark"` are
 * explicit OVERRIDES, and BOTH must round-trip (before this fix, `theme=light` was silently dropped
 * because "light" was treated as the constant default — a sender on a dark system shared a light
 * view and the recipient saw dark). */
export type Theme = "light" | "dark" | "auto";
export type Tour = "on" | "off";
/** the resolved, renderable theme — plan atlas-3's two brand themes. */
export type ResolvedTheme = "navy" | "paper";

/** `map=lon,lat,zoom[,bearing,pitch]` — bearing/pitch travel together (both present or both absent),
 * matching the compact 3- or 5-field tuple the URL carries (`atlas-refs/"calcofi explore review.md"`
 * §4's `parseCam`/`parseMap` pattern). */
export interface MapView {
  lon: number;
  lat: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface Sel {
  /** release version; public-host-only (see module header). `undefined` = "unset here". */
  ver?: string;
  lens: Lens;
  /** score layer `metric_key` (boot.metrics later); opaque string, no default written to the URL. */
  lyr?: string;
  pal: Palette;
  /** `"cell"` or a drawable unit key from `boot.units` (opaque here — the registry is atlas-1's). */
  unit: string;
  /** study-area camera preset key, applied only when `map` is absent. */
  area: string;
  map?: MapView;
  proj: Projection;
  /** species key. */
  sp?: string;
  /** input `ds_key`. */
  in: string;
  rep: Representation;
  /** `true` = US-only (default, `us` key omitted); `false` = include non-US (`us=0` written). */
  us: boolean;
  out: Outline;
  obis: boolean;
  /** `cell:<id>` | `zone:<unit>:<key>` | `place:<n>`. */
  sel?: string;
  /** panel-visibility deltas against the shipped default (plan: "deltas", not an absolute list). */
  show: string[];
  hide: string[];
  /** R3 (round-2 plan §5 U4): deviations from the release's default layer stack (order + each
   * group's visible/opacity) — `layers=`, `../map/layerStack.ts#parseLayerStack`/`formatLayerStack`.
   * `undefined` = the default stack (never written to the URL), matching every other "deltas, not an
   * absolute list" field on this type (`show`/`hide`). */
  layers?: readonly LayerStackEntry[];
  theme: Theme;
  tour: Tour;
  /** hash only: the place codec (`g1`, opaque here — that codec belongs to another agent). */
  pl?: string;
  /** hash only: the report title. */
  t?: string;
}

/** query keys `formatSel`/`parseSel` know about, in the order they are written (stable, readable
 * URLs — not load-bearing for parsing, which is key-based via URLSearchParams). */
export const QUERY_KEYS = [
  "ver",
  "lens",
  "lyr",
  "pal",
  "unit",
  "area",
  "map",
  "proj",
  "sp",
  "in",
  "rep",
  "us",
  "out",
  "obis",
  "sel",
  "show",
  "hide",
  "layers",
  "theme",
  "tour",
] as const;

/** hash keys: places and the report title only — a fragment is never sent to a server or a
 * referrer, which is exactly why these two (and only these two) live there (plan `state/` header). */
export const HASH_KEYS = ["pl", "t"] as const;

export const PALETTES: readonly Palette[] = ["spectral_r", "viridis", "cividis", "magma"];
export const PROJECTIONS: readonly Projection[] = ["globe", "mercator"];
export const REPRESENTATIONS: readonly Representation[] = ["native", "model"];
export const OUTLINES: readonly Outline[] = ["programarea", "ecoregion", "none"];
/** every value `theme=` may parse from, including `"auto"` (the default, read back identically to
 * an absent key — see `parseSel`). */
export const THEMES: readonly Theme[] = ["light", "dark", "auto"];
export const LENSES: readonly Lens[] = ["scores", "species"];

/**
 * `lens`'s context-dependent default: `"species"` when a species key is present in the URL,
 * `"scores"` otherwise (key table: "`scores` (or `species` when `sp` is present)"). Shared between
 * `parseSel` and `formatSel` so a value that equals its OWN default is omitted symmetrically in both
 * directions — the property under test by the URL round-trip test.
 */
export function defaultLens(sp: string | undefined): Lens {
  return sp ? "species" : "scores";
}

/**
 * `out`'s context-dependent default: "per lens" (key table). Scores' primary spatial unit is the
 * Program Area, so outlines default on there; species maps default to none. This exact mapping is a
 * documented interpretation for this phase (no UI yet to confirm against) — pinned by a regression
 * test (tests/state/codec.test.ts) so a later, deliberate change to it is visible in a diff rather
 * than silent drift.
 *
 * ONE exported table (fix round 1): both `parseSel` (the contextual default when `out` is absent)
 * and `formatSel` (the "is this a default?" comparison) call `defaultOut`, which reads only this
 * table — so atlas-4/5 change the mapping in exactly one place, and
 * tests/state/codec.test.ts asserts parse and format agree with it for every `Lens`.
 */
export const DEFAULT_OUT_BY_LENS: Record<Lens, Outline> = {
  scores: "programarea",
  species: "none",
};

export function defaultOut(lens: Lens): Outline {
  return DEFAULT_OUT_BY_LENS[lens];
}

/**
 * The renderable theme (plan atlas-3): `"dark"` -> navy, `"light"` -> paper, `"auto"` follows
 * `prefersDark` (the live `matchMedia("(prefers-color-scheme: dark)").matches` value, injected so
 * this stays a pure function) and resolves to **navy** when that signal is unavailable (`null`) —
 * i.e. only an explicit `prefersDark === false` ever yields paper from `"auto"`.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean | null): ResolvedTheme {
  if (theme === "dark") return "navy";
  if (theme === "light") return "paper";
  return prefersDark === false ? "paper" : "navy";
}

/**
 * Layers pane R3-W1 fix round (Ben: "dim Selection if there is none to display, otherwise its
 * presence can cause confusion"). `Sel.sel` unifies every kind of PICK this app has ("cell:<id>" |
 * "zone:<unit>:<key>" | "place:<n>", this file's own header) into one optional string — a
 * picked/drawn/uploaded place and a clicked cell/zone all write it, and nothing else does.
 *
 * R3-rr fix 3 (Opus 5.5 eyes-on review round 3, 2026-09-25): `sel.sel` is not the only thing the
 * Selection row draws — a loaded PLACES LIST (the `pl=` hash token, decoded by
 * `places/model.ts#placesFromHash`) shows on its own even with no `sel` pick at all (`?pl=z.pa.GAA`
 * loads a place with no cell/zone SELECTED yet, and the Places panel + Download menu both treat
 * that as "places present"). The row used to dim on `?pl=` alone because this predicate only ever
 * checked `sel`. `placeCount` is the second thing that must ALSO be empty (0, the default) — a
 * pure predicate over both so both lenses' `rowState` and this file's own test agree on the one
 * definition, exactly as before.
 */
export function isPlacesSelectionEmpty(sel: string | undefined, placeCount = 0): boolean {
  return !sel && placeCount === 0;
}

/** every field's context-INDEPENDENT default (see `defaultLens`/`defaultOut` for the two that are
 * not constants). Used both to seed a fresh `Sel` and as the "is this a default?" comparison for
 * every other field when formatting. */
export const DEFAULT_SEL: Sel = {
  ver: undefined,
  lens: "scores",
  lyr: undefined,
  pal: "spectral_r",
  unit: "cell",
  area: "FULL",
  map: undefined,
  proj: "globe",
  sp: undefined,
  in: "merged",
  rep: "native",
  us: true,
  out: "programarea",
  obis: false,
  sel: undefined,
  show: [],
  hide: [],
  layers: undefined,
  // U2a (round 2): the default is DARK, not "auto" -- matching both Shiny apps and the brand's
  // dark lockup, regardless of the OS's prefers-color-scheme. "auto" stays a legal, explicit
  // Theme value (an old `?theme=auto` link, or a future auto-follow control, still resolves
  // through prefers-color-scheme via resolveTheme()) -- it is simply no longer what an absent or
  // malformed `?theme=` falls back to. See docs/usability.md p3 and "Ben's items" (theme default).
  theme: "dark",
  tour: "on",
  pl: undefined,
  t: undefined,
};
