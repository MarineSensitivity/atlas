## Parity checklist (each line is an e2e assertion; § = section of the reference)

**Controls (§5.3)**
- [ ] Study area: FULL / AK / AT / GA / PA presets → `flyTo(center, zoom)`.
- [ ] Spatial units: `Raster cells (0.05°)` + one entry per `boot.units` row (derived, never hardcoded);
      the note "{ver} predates the BOEM Program Areas — it reports on {label}" when the primary unit is
      not `programarea` (v1 → Planning Areas).
- [ ] Layer select grouped by category in `order`; default = order 1 (overall score). Palette:
      Spectral / Viridis / Cividis / Magma. Globe ↔ mercator.

**Map (§6.2–6.4)**
- [ ] One PMTiles source + outline per unit, styles from the `zone_style` table (programarea/planarea
      white 1 px; ecoregion black 3 px; subregion `#d9d9d9` 2 px dashed `[3,3]` 0.7; labels: programarea
      white 12 px dark halo, ecoregion black 16 px light halo, subregion none); standalone ecoregion
      outline when ecoregion is not itself a scored unit. Label points from `boot.zones[*].label_pt`.
- [ ] Cell branch: titiler tiles of the `FULL` COG with the manifest's `rescale` verbatim and the chosen
      `colormap_name`, opacity 0.6, `raster-resampling: nearest`; legend endpoints `signif(rescale, 3)`.
- [ ] "Cells outside Program Areas" overlay from `manifest.overlays[_outside_pra]`, explicit colormap
      `{"1":[34,34,34,255]}`, opacity 0.55, off by default.
- [ ] Zone branch: ALL zones of the unit; fill by the 11-bin rule from `ramps.ts`, opacity 0.7, white
      outline, default lightgrey, hover purple; tooltip `"{name}: {round(value)}"`; legend endpoints
      `round(range, 1)`; empty values → a notice and no draw (the `Inf/-Inf` legend guard).
- [ ] Layers control lists the layers that actually exist (**fixes** the dead `pra_ln/pra_lbl/er_ln`
      switches, §6.4). Fullscreen, navigation, scale, Nominatim geocoder ("Go to location").
- [ ] The whole style is one composed object applied with `setStyle(diff)`; layer order is declared, so
      a missing `before` layer can never cascade (§11.4).

**Selection (§6.6, §7.1–7.3)**
- [ ] Click a cell: `cellFromLonLat` with the release's grid (no `/cog/point`, no `cellid.tif`); fetch the
      wide cell tile; show cell id, lon/lat (3 dp), the displayed layer's value; white ring with `#ff00aa`
      stroke; `sel=cell:<id>`.
- [ ] Cell flower: the `*_ecoregion_rescaled` columns → component = key minus `extrisk_` and
      `_ecoregion_rescaled`, `_` → space, drop `all`; title `Cell ID: {id} (x: …, y: …)`.
- [ ] Click a zone: highlight line `#ff00aa` 4 px; flower from `boot.zones`; `sel=zone:<unit>:<key>`.
- [ ] Nothing selected: flower from `boot.flower_default[zone_all_key]`, title "Full study area"
      (**fixes** the unversioned CSV); species = `zone_fld='subregion_key' AND zone_value=<zone_all_key>`.
- [ ] Flower centre = `round(mean(score))`; tooltips `"{component}: {round(score, 2)}"`; colors from
      `categories.ts` (**fixes** the grey `primary producer` petal).

**Species table + composition (§7.3–7.6)**
- [ ] Headers and filename stems exactly as §7.3 (`species_cellid-{id}`, `species_programarea-{name}`,
      `species_{zone_all_key}`), CSV = the unformatted frame + `_{YYYY-MM-DD}.csv`.
- [ ] Columns in order: `cat, taxon, scientific, common, er_code, er_score, model, is_mmpa, is_mbta,
      area_km2, avg_suit, pct_cat`; `er_score` as the release's own plain 1–100 number, never a
      percent (**fixes** P3/W3: the reference app's `formatPercentage(er_score, 0)` prints "1%"/
      "10%" for this query's own internal 0–1 fraction, which reads as a tiny, uninformative share
      of something — Ben's own live-review direction, 2026-09-24), `avg_suit`/`pct_cat` 2 dp percent,
      `area_km2` 4 significant; per-column filter, sort, keyboard cell navigation.
- [ ] `taxon` links: BOTW → birdsoftheworld.org, else WoRMS `aphia.php?p=taxdetails&id=`. `model` link
      switches to the Species lens **in place** (`lens=species&sp=<key>`, place and camera kept);
      modifier-click opens the same URL in a new tab.
- [ ] The column glossary modal including the ER rule (EN 100, TN 50, CR 50, EN 25, VU 5, NT 2, LC/DD 1,
      MMPA 20, MBTA 10).
- [ ] Composition treemap over `app/taxonomy.parquet` (`branchvalues: total` semantics), themed; the
      "birds are not in this view" note stays until BOTW taxa gain a hierarchy (enhancement, not parity).
- [ ] Cell species unavailable (`capabilities.cell_model = false`) → the header says so; nothing errors.

**Chrome (§5.5–5.7)**
- [ ] Release picker modal; welcome modal with "don't show again" (`localStorage`) and `tour=off`;
      a driver.js tour over `data-tour` anchors covering the old 10 steps; the three version modals
      (unknown / under review / not served).

**New, because a panel app needs it**
- [ ] Zones table: every zone of the unit ranked by the current layer, with all components. It is the
      keyboard and screen-reader equivalent of the choropleth, and the entry point for "add to report".
