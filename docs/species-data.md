# The species lens' data layer (`src/lens/species/data/`)

Everything the species lens needs that is **not** a map and not a component: pure TypeScript, no
DOM, no MapLibre, no DuckDB. The UI half (atlas-5 step 1's other half, once the shared map module
lands) calls these functions and renders what they return; the tests in `tests/lens/species/**`
assert the functions, so the two cannot drift.

Reference: `../workflows/.claude/plans_todo/atlas-5 species lens.md` and
`atlas-refs/parity species app.md` §4–§7. Data contract: atlas-1's `{ver}/app/` objects
(`taxa.json`, `taxon/{xx}.json`, `alias/{xx}.json`, `boot.datasets`), validated against msens'
schemas (`msens/inst/schema/app_{taxon,alias,taxa}.schema.json`, copied to
`tests/fixtures/species/schema/`).

Nothing here fetches a relative URL: every release URL is built by `dataUrl()`
(`src/lib/release/dataBase.ts`), the one place a data origin is formed.

## `shards.ts` — loading

| call                                | returns                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `shardIdFor(key)`                   | `"f9"` — the 256-way rule, `sprintf('%02x', trailing_integer(key) %% 256)`, `"00"` when the key ends in no digit. Twin of msens `.shard_of()` |
| `loadTaxon(ver, key, opts)`         | `ShardResult<TaxonCard>` — one fetch of `app/taxon/{xx}.json`, cached per shard                                                               |
| `loadAlias(ver, key, opts)`         | `ShardResult<AliasEntry>` — `{mergedKey, dsKey}`; a merged key maps to itself with `dsKey === "ms_merge"`                                     |
| `loadTaxonShard` / `loadAliasShard` | the whole shard, when you want more than one key out of it                                                                                    |

`ShardResult<T>` is `{ok: true, value} | {ok: false, error}`. `error.kind` is one of `network`,
`http` (with `status`), `parse`, `schema`, `not-found`. **Nothing throws**: a retired key, a 404, a
truncated body and a shard that fails msens' schema all arrive as values the UI can render. The
in-memory cache (`createShardCache()`, or the module default) holds successes only — a failure is
always retried.

A `TaxonCard.merged` of `null` means _no published surface for this taxon in this release_ (the
~192 residual taxa, and every taxon on v7b). It is a state, not an error: see
`card.noSurfaceNotice`.

Asset fields are passed through **verbatim** — `url`, `type` (`cog` | `pmtiles`), `rescale`,
`colormap`, `sourceLayer`, `bbox`. AquaX's delivered band really is `[0, 1000]`; everything else is
`[1, 100]`. Never default a `rescale`.

## `picker.ts` — the index and the search

```ts
const res = await loadTaxa(ver); // app/taxa.json, ≤ 1 MB gzip, at idle or on focus
if (res.ok) {
  const rows = visibleRows(res.value, usOnly); // the list, sorted by sp_cat then label
  const groups = groupByCat(rows); // optgroups
  const hits = searchTaxa(res.value, q, { usOnly }); // ranked matches
  const initial = defaultSpecies(res.value); // Dermochelys coriacea, else the first US-valid
  const kept = keepSelection(res.value, selected, usOnly); // when the checkbox flips
}
```

- Labels are `"{sp_cat}: {scientific}{ (common)}"` (§5.4).
- Search is normalized once at load (`foldText`: lowercase, diacritics stripped, curly apostrophes
  straightened), runs over **scientific and common** names, and ranks exact → prefix → word-start →
  substring, scientific before common at each tier (`MatchRank`).
- `usOnly` is applied _before_ ranking, so the two lists really are two lists.
- `keepSelection` is the trap §13.1 names: a taxon in **both** lists survives the swap; one that
  isn't falls back to `defaultSpecies`.
- `shouldLogSearch(q)` is the ≥ 3-character half of the `search_species` rule; the 900 ms debounce
  and the no-repeats rule belong to the UI.

## `resolve.ts` — deep links

```ts
const result = await resolveDeepLink(ver, new URLSearchParams(location.search), { index });
// { kind: "species", sp, in, resolution, clearUs, event } | { kind: "not-found", key, reasons, event } | { kind: "none" }
if (result.kind === "species") {
  const target = targetOf(result, sel)!; // { sp, in, us }
  const { search, hash } = canonicalUrl(location, target); // history.replaceState, never pushState
}
```

- `?sp=` (merged key) → `(sp, "merged")`; `?mdl_key=` (merged **or** any raw input key) and
  `?mdl_seq=<int>` → the same pair, via one `alias/{xx}.json` fetch. Precedence is `sp` > `mdl_key`
  > `mdl_seq`, matching `src/lib/state/legacy.ts`.
- A target that is not `valid_usa` sets `clearUs`, which unticks "Only species in US waters" — else
  the taxon just resolved to would not be in the list on screen. With the picker index not yet
  loaded, an unknown validity clears the box (show the taxon rather than hide it).
- Unknown → `{kind: "not-found", reasons}`: the three-paragraph explanation of §4 / §5.5 modal 4.
- `event` is the **analytics event as data** — `{name: "deeplink_mdl_key", params: {mdl_key,
resolution}}`, `resolution ∈ {merged_model, input_model, not_found}`. This module imports nothing
  from `src/lib/analytics/`; the UI hands the object to `track()`. A type test pins the shape
  against `EventParamsMap`.
- `canonicalUrl` is `parseSel → patch → formatSel`, so legacy keys are dropped by the same code that
  already knows how to drop them, and defaults are omitted by the same code that already omits them.

## `camera.ts` — the antimeridian

```ts
const cam = cameraFor(card, selectedInput, { rep, fallbackBbox: erBbox });
// { bounds: [[w, s], [e, n]], padding, source: "input" | "merged" | "fallback" } | null
if (refitNeeded(prevKey, { sp, in: selected })) map.fitBounds(cam.bounds, { padding: cam.padding });
```

- **Longitudes are never normalized.** The release publishes each extent already in the
  minimal-span (`lon_span_agg`) frame, so `e` may exceed 180 — `[[160, 48], [210, 73]]` is a walrus
  in the Bering and Chukchi seas. `((x + 180) % 360) - 180` anywhere on the way turns it into a
  350°-wide box framing Iceland (2,744 of v8's models once did that).
- Fallback order for an input: its own extent → unless it spans ≥ 350° → the merged extent → the
  supplied ecoregion extent → `null` (leave the camera alone).
- `refitNeeded` is true **only when the species changes**. A layer or representation switch keeps
  the user's camera, which is the point of switching.
- The extent is precomputed in the shard: the lens runs no aggregate and holds no grid constant.

## `layerBar.ts` — the pills

`layerBar(card, {ver, selectedInput, datasets})` returns the bar: `variant` (`merged` = green /
`input` = orange), `nInputs`, `mergedLabel`, `title`, `pills`, `representation`,
`mobileToggleLabel`. `datasets` comes from `datasetIndex(boot.datasets)`.

- Pills are the merged model plus one per input, ordered by `dataset.sort_order` (`null` last, then
  `ds_key`); the merged model is always first. A missing `name_display` (v1–v2) falls back to the
  `ds_key`.
- `pill.hasSurface === false` is the struck-through, disabled pill, and `pill.tooltip` is the title
  that says why: _"{label} feeds the merged model, but {ver} publishes no surface for it — nothing
  to draw"_. Every v1–v7 input is in this state.
- `nInputs` is counted from the shard's **input edges** and is always a number — 1 for a
  single-input taxon, 0 for a residual one (§11.5: the old `[[` on a `table` errored instead, and
  the bar died on every v1 taxon).
- `representation.available` is true only when the selected input publishes both representations;
  the labels and tooltips come from `REPRESENTATION_LABELS`, relabelled **Delivered / As ingested**
  when `dataset.on_grid` (AquaX on v9).
- `pill.assets` are the verbatim asset rows — this is what the map module's raster builder reads for
  `url`, `colormap` and `rescale`.

## `card.ts` — the sidebar card and the title

`speciesCard(card, {ver, selectedInput, datasets})` returns `{sci, facts, values, iucnMasked, mask,
noSurfaceNotice}`.

- `facts`: Common name, Category, ESA Listing `{code} ({SOURCE})` (the `ch_` prefix dropped, source
  upper-cased), IUCN RedList, WoRMS (**only** when `taxon_authority === "worms"`), `MMPA: Protected
(20)`, `MBTA: Protected (10)`. A row with no value is omitted.
- `values`: one flat node for a single model with no IUCN range; otherwise the merged node —
  labelled `Merged Model (IUCN masked)` when an `rng_iucn` input exists — with every input beneath
  it and each input's `value_info` as `info`.
- `mask`: `null` unless the taxon has an `rng_iucn` input; `rng_iucn` carries `required: true`.
- `documentTitle(card, {selectedInput, datasets})` →
  `"{sci} distribution ({cat}[: {common}]; {key}) from {layer} | Marine Sensitivity"`, where `{key}`
  is the id of the **layer on screen**.

Two deliberate differences from the Shiny app, both pinned by named tests: an ESA code with no
source prints as `FWS:EN`, not R's `FWS:EN (NA)`; and a taxon with no ESA code omits the row rather
than printing `NA`.

## Tests and fixtures

`tests/lens/species/*.test.ts`, one file per module plus `schema.test.ts` (drives msens' own
`required` lists through the validators) and `sourceScan.test.ts` (the gate: no file under
`src/lens/species/**` may contain `native_asset`, `mdl_bbox`, `7200`, `3600` or `fitBounds(` — with
a seeded-fault fixture proving the scan can fail).

Fixtures are trimmed copies of **real published bundles** — see
`tests/fixtures/species/README.md` for what each one is and why. The single hand-written file is
`derived/taxon-dateline.json`: no published release currently carries a `bbox` with `xmax > 180`, so
the antimeridian branch is exercised against the `lon_span_agg` frame written out by hand.
