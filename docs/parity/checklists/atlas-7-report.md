## 7. Parity checklist — "report parity = done when…"

### Structure
- [ ] Order: title + timestamp · intro · **Parameters** (collapsed) · **Map** · **Plot of Scores** · **Table of Scores** · **Summary of Species** · **Software/Provenance**.
- [ ] Multiple areas → tab-set (HTML), one `### <label>` per area under *Plot of Scores* and *Summary of Species*, in submission order.
- [ ] All static narrative from §2 present, with the **stale category sentence at `report.qmd:304` corrected** to the 8 real components.
- [ ] Empty-area case prints `_No species found for this area._`

### Numbers
- [ ] For each of the 20 v9 Program Areas the 8 component scores equal `zone_metric.val` to 2 dp (ALA: 55.12 / 17.66 / 20.85 / 20.30 / 28.18 / 10.40 / 49.98 / 1.43).
- [ ] `Overall` = unweighted mean of those 8 = the published composite `score_…_equalweights` (ALA 25.489 · COK 51.665 · GAA 40.448 · BFT 13.146).
- [ ] `N cells` for a PRA = `COUNT(*) FROM zone_cell` (HAR 67,835 · ALA 45,685 · GAA 14,238 · COK 1,505).
- [ ] **A drawn polygon exactly tracing a Program Area reproduces that Area's 8 published scores** — requires the pct-area down-weight of §3.5. *This is the test that catches inconsistency #1.*
- [ ] Species counts per PRA match `zone_taxon` (GAA 6,346 · GAB 5,841 · SOC 3,547 · ALA 2,157).
- [ ] `er_consolidate()` reproduced exactly incl. `NA`→`other(1)` and the fixed order `USA:EN(100), USA:TN(50), USA:LC(1), IUCN:CR(50), IUCN:EN(25), IUCN:VU(5), IUCN:NT(2), other(1)`; Total row **and** Total column; comma-formatted.
- [ ] Top-20 sorted by `suit_er_area = avg_suit × er_score × area_km2` desc, `head(20)`; `ER score` an integer percent of a 0–1 fraction; `Score` = `comma(round(suit_er_area))`.
- [ ] `avg_suit = Σ(val·pct)/Σ(pct)/100`, `area_km2 = Σ(cell.area_km2 · pct/100)` — both coverage-weighted.
- [ ] Eligibility: `is_valid_usa AND is_marine AND sp_cat NOT IN ('reptile','amphibian')`.
- [ ] If any raw metric is recomputed, per-cell ER honoured for `er_mode='cell'` and `100` used for `'premultiplied'` (spot-check: cell 1080221 `extrisk_mammal` = **30.54**, not 32.85).
- [ ] Ecoregion rescale blends across multi-ecoregion cells via `norm_pct` (951 cells affected); cells in no ecoregion produce no value (10,996 cells).

### Figures
- [ ] Map: Spectral **reversed** (red = high), opacity 0.6, label at `point_on_surface`, legend "Mean score" with the **report-relative** range (±0.5 when all areas equal), tooltip `"<label> — mean score: <score>"`.
- [ ] Flower: one petal per component, equal widths, radius = score, centre = rounded mean, polar, white borders, alpha 0.5, legend beneath — **and a real colour for `primary producer`**.

### Links & downloads
- [ ] Intro links to `{host}/{ver}/scores/`; host = preview for `restricted`.
- [ ] Top-20 `Common` links to `{host}/{ver}/species/?mdl_key=<urlencoded>` (v8+) / `?mdl_seq=` (v1–v7).
- [ ] CSV control yields the `species_for_cells()` + `.species_shares()` columns: `sp_cat, sp_common, sp_scientific, taxon_id, taxon_authority, er_code, er_score, is_mmpa, is_mbta, mdl_key, area_km2, avg_suit, suit_er, suit_er_area, cat_suit_er_area, pct_cat`; filename `species_<slug>_<ver>.csv`.

### Versioning & robustness
- [ ] Version from `versions.json`; `latest` → `latest.txt` (**v7** today); unknown version errors clearly; `prerelease`/`restricted` handled per the §6.1-7 decision.
- [ ] v1–v7 releases work: `is_ok`/`mdl_seq`/`value` resolved by introspection; `usa05` grid (`ncol = 3103`, 0-360 longitudes).
- [ ] Published Parquet read with **`val`**, not `value`.
- [ ] The whole report regenerates from the URL alone.
- [ ] An antimeridian polygon (Aleutians) returns the same cells as the R path.
- [ ] Zero intersecting cells degrades gracefully (no silent empty report).

### Output
- [ ] HTML is self-contained and prints cleanly via "Save as PDF" (callouts expanded, tab-sets flattened, no clipped tables).
- [ ] Provenance names `ver`, release `status`/`access`, table URLs, generation time, app version.
