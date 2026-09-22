# `tests/fixtures/species/` — where these files come from

Every file under `v1/`, `v7/` and `v9/` is **copied out of a real published app bundle**
(`workflows/_output/app_bundle/{ver}/`, the same bytes S3 serves under
`marine-atlas/{ver}/app/`). Only the SET of keys is trimmed — a real v9 taxon shard holds ~84 taxa
and ~110 KB, and a test needs four. Each taxon object, alias entry and dataset row inside is
verbatim.

| file                                   | why it is here                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `v9/taxa.json`                         | the picker index (column-oriented), 13 rows: the default species, a non-US taxon (`Anarhynchus frontalis`, `flags = 2`), a diacritic (`señorita`), a curly apostrophe (`deadman’s fingers`), and four `Aethia`/`Aechmophorus` rows for prefix-vs-substring ranking |
| `v9/taxon/f9.json`                     | `Dermochelys coriacea` — the default species; an **AquaX** input whose `native` asset carries `rescale [0, 1000]`; 7 inputs; `merged.bbox = null` (spans the globe)                                                                                                |
| `v9/taxon/75.json`                     | `Odobenus rosmarus` — MMPA, an `rng_iucn` mask (so the card's Mask section exists), an input with a real bbox                                                                                                                                                      |
| `v9/taxon/03.json`                     | `Aethia cristatella` — a **single-input** taxon: the §11.5 `n_inputs` case; MBTA; `botw` authority, so no WoRMS link                                                                                                                                               |
| `v9/taxon/28.json`                     | `Anarhynchus frontalis` — `valid_usa: false`: the deep-link "turn the US-only box off" case                                                                                                                                                                        |
| `v9/alias/*.json`                      | the alias rows for the merged keys and the raw input keys above (`ax\|137209`, `am\|ITS-Mam-180639`, `bl\|22694915`, …)                                                                                                                                            |
| `v9/datasets.json`                     | `boot.datasets` verbatim: `sort_order`, `name_display`, `on_grid` (AquaX true), `is_mask`, `value_info`                                                                                                                                                            |
| `v7/taxon/6f.json`, `v7/taxon/e1.json` | `mdl_seq`-keyed taxa (`54383` walrus, `54241` leatherback) whose inputs publish **no assets at all** — the struck-through pill case                                                                                                                                |
| `v7/taxon/00.json`                     | `Brachyramphus marmoratus` — the only shape with a non-null `esa.source` (`ch_fws`), i.e. `FWS:TN (FWS)`                                                                                                                                                           |
| `v7/alias/*.json`                      | `mdl_seq` → `[merged_key, ds_key]`, including the raw input `790`                                                                                                                                                                                                  |
| `v7/datasets.json`, `v1/datasets.json` | v7's registry, and v1's where **every `name_display` and `sort_order` is null**                                                                                                                                                                                    |
| `v1/taxon/48.json`                     | `Buccinum undatum` — `merged: null` and zero inputs: the "no surface published in {ver}" case                                                                                                                                                                      |

`derived/taxon-dateline.json` is the **one hand-written** file, and it is marked as such on
purpose. No published release currently carries a `bbox` whose `xmax` exceeds 180 (checked across
all eleven local bundles: v8/v9 precompute 10,6xx merged bboxes and none exceeds 180.5; v1–v7
publish none at all), so the antimeridian branch has no real fixture yet. Its numbers are the
`lon_span_agg` 0–360 frame for the Bering/Chukchi walrus range (`[160, 48, 210, 73]`), plus a
wraparound input whose own COG honestly reads `[-180, 47, 180, 85]` and a taxon whose merged extent
spans the globe. Those are exactly the three branches `cameraFor()` has to separate.
