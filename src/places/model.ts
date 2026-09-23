// places/model.ts -- pure place-list operations over the g1 codec's `Place` union
// (src/lib/geo/placeCodec.ts, atlas-2): the list Deliverable 1 renders and every mutation that
// writes back to `#pl=`. No DOM, no svelte: Places.svelte calls these and writes the result
// through `selStore.set({ pl })`, so the URL and the rendered list can never observably disagree
// (CLAUDE.md "URL-is-the-view").
//
// This is also THE ZONES-TABLE HOOK the scores lens (atlas-4) calls: "Add to places" needs nothing
// from Places.svelte, only `addZonePlace()` below plus `placesFromHash`/`hashFromPlaces` -- a lens
// that holds `selStore` and a picked key set can add a place without importing any UI from here.
//
// ZonePlace (placeCodec.ts) carries KEYS, never a name -- its identity is `set` + `keys`, resolved
// against `boot.zones` by zoneStats.ts. So rename/duplicate, which need a place's OWN name field,
// only apply to `geom`/`upload` kinds; a zone place offers zoom/reselect/delete only. That is a
// property of the codec's own schema (atlas-2, not ours to change), not an oversight here.
import type { FeatureCollection } from "geojson";
import {
  clampName,
  decodePlaces,
  encodePlaces,
  type GeomPlace,
  type Place,
  type UploadPlace,
  type ZonePlace,
  type ZoneSet,
} from "../lib/geo/placeCodec";
import type { AreaGeometry } from "../lib/geo/types";

/** Deliverable 1: "up to 20 places". */
export const MAX_PLACES = 20;

export interface MutationResult {
  places: Place[];
  ok: boolean;
  /** a short, user-facing reason when `ok` is false (Toast.push() text). */
  reason?: string;
}

const AT_CAP = `Up to ${MAX_PLACES} places at a time — remove one to add another.`;

/** `#pl=` -> `Place[]`; an absent/empty hash is zero places, never an error. */
export function placesFromHash(pl: string | undefined): Place[] {
  return pl ? decodePlaces(pl) : [];
}

/** `Place[]` -> `#pl=`'s value; an empty list clears the key (`undefined`, never `""` -- `Sel.pl`
 * is `string | undefined` and `formatSel` already omits an undefined field). */
export function hashFromPlaces(places: readonly Place[]): string | undefined {
  const hash = encodePlaces([...places]);
  return hash.length > 0 ? hash : undefined;
}

/** `Sel.sel` -> the place index it names, or `null` when it does not name one (`place:<n>`, the
 * ONE token shape a row selection ever writes -- `Places.svelte`'s own `selectedIndex` and, 0.10.21,
 * `placesMap.svelte.ts`'s baseline outline restore both derive from this, so the token shape lives
 * in exactly one place. */
export function selectedPlaceIndex(sel: string | undefined): number | null {
  return sel && /^place:\d+$/.test(sel) ? Number(sel.slice("place:".length)) : null;
}

/** a single-feature `FeatureCollection` wrapping `geometry` -- the shape both the selection layer
 * (`map/style.ts`) and `cellsFeatureCollection()`'s own sibling helpers expect. Shared by
 * `Places.svelte` (the interactive pick/draw-mode-aware outline) and `placesMap.svelte.ts` (the
 * 0.10.21 baseline restore, below) so the two never drift on what "a place's outline" looks like. */
export function featureCollectionOf(geometry: AreaGeometry): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry, properties: {} }],
  };
}

/**
 * 0.10.21 Places same-class fix (mirrors the scores lens' fix 1): the SELECTED place's geometry,
 * resolved from `sel.pl`/`sel.sel` ALONE -- no `boot`, no pick/draw-mode context, nothing that
 * requires `Places.svelte` to be mounted. `null` for anything but a `kind: "geom"` place (a zone
 * place's highlight is drawn elsewhere; an upload place carries no geometry to draw at all, see
 * `UploadPlace`'s own doc comment in placeCodec.ts) -- the SAME restriction `Places.svelte`'s own
 * "the selected row's outline persists" `$effect` already applies.
 */
export function selectedGeomPlaceGeometry(
  pl: string | undefined,
  sel: string | undefined,
): AreaGeometry | null {
  const idx = selectedPlaceIndex(sel);
  if (idx === null) return null;
  const p = placesFromHash(pl)[idx];
  return p && p.kind === "geom" ? p.geometry : null;
}

function ok(places: Place[]): MutationResult {
  return { places, ok: true };
}
function refused(places: readonly Place[], reason: string): MutationResult {
  return { places: [...places], ok: false, reason };
}

/** append one place, enforcing the 20-place cap (Deliverable 1). */
export function addPlace(places: readonly Place[], place: Place): MutationResult {
  if (places.length >= MAX_PLACES) return refused(places, AT_CAP);
  return ok([...places, place]);
}

export function removePlaceAt(places: readonly Place[], index: number): Place[] {
  return places.filter((_, i) => i !== index);
}

/** rename a `geom`/`upload` place in place; a `zone` place has no name field to rename (see the
 * module header) and this returns the list unchanged with `ok: false`. */
export function renamePlaceAt(
  places: readonly Place[],
  index: number,
  name: string,
): MutationResult {
  const p = places[index];
  if (!p) return refused(places, "no such place");
  if (p.kind === "zone") {
    return refused(places, "a zone selection is named from its Program Areas, not renamed");
  }
  const clamped = clampName(name.trim());
  if (!clamped) return refused(places, "a place needs a name");
  const next = [...places];
  next[index] = { ...p, name: clamped } as Place;
  return ok(next);
}

/** duplicate a `geom`/`upload` place (a second, identical zone selection is not a useful copy --
 * see the module header), enforcing the 20-place cap. The copy's name gets " copy" appended,
 * clamped to 60 chars. */
export function duplicatePlaceAt(places: readonly Place[], index: number): MutationResult {
  const p = places[index];
  if (!p) return refused(places, "no such place");
  if (p.kind === "zone") return refused(places, "duplicate a zone selection by picking it again");
  const copy: Place = { ...p, name: clampName(`${p.name} copy`) } as Place;
  return addPlace(places, copy);
}

/** "Add to places" from the zones-table hook / pick mode (Deliverable 2): one NEW zone place
 * carrying every key currently picked (`z.pa.GAA,WGA`) -- the caller clears the pick afterward. */
export function addZonePlace(
  places: readonly Place[],
  set: ZoneSet,
  keys: readonly string[],
): MutationResult {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return refused(places, "pick at least one area first");
  return addPlace(places, { kind: "zone", set, keys: uniq });
}

export function isGeomOrUpload(p: Place): p is GeomPlace | UploadPlace {
  return p.kind === "geom" || p.kind === "upload";
}

/** the ", "-joined key list -- the fallback display name for a zone place when no boot lookup
 * (zoneStats.ts) is available yet. */
export function fallbackZoneLabel(z: ZonePlace): string {
  return z.keys.join(", ");
}

/** `ZoneHit.unit` (map/interaction.ts, e.g. `"programarea"`) -> the codec's `ZoneSet` code. D17
 * restricts a release to exactly one drawable unit (`programarea` or `planarea`), but this table
 * covers the codec's whole domain (`pa|pl|er|sr`) so it stays correct if that ever widens. */
const UNIT_TO_ZONE_SET: Readonly<Record<string, ZoneSet>> = {
  programarea: "pa",
  planarea: "pl",
  ecoregion: "er",
  subregion: "sr",
};

export function zoneSetForUnit(unit: string): ZoneSet | null {
  return UNIT_TO_ZONE_SET[unit] ?? null;
}

const ZONE_SET_TO_UNIT: Readonly<Record<ZoneSet, string>> = {
  pa: "programarea",
  pl: "planarea",
  er: "ecoregion",
  sr: "subregion",
};

/** the inverse of {@link zoneSetForUnit} -- a `ZonePlace.set` back to the `boot.zones` unit key. */
export function unitForZoneSet(set: ZoneSet): string {
  return ZONE_SET_TO_UNIT[set];
}
