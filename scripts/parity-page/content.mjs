// atlas-8 step 5 / Deliverable 2: the prose `docs/parity.html` is signed against.
//
// Three lists, and between them they must account for EVERY way the atlas differs from the two
// Shiny apps (`apps/scores`, `apps/species`) and the Quarto report — that is this phase's review
// rule ("The intentional-differences list is complete: nothing differs from the Shiny apps without
// a line in it"). A difference that was DECIDED goes in `INTENTIONAL`; a difference that is simply
// not built or not yet gated goes in `GAPS` with an owner; things the atlas has that the Shiny apps
// never had go in `NEW`. `NOT_COMPARED` says plainly what this page does not show.
//
// Every `where` string names a real test title, and the build verifies it the same way it verifies
// the checklist rows' evidence (see test-index-core.mjs) — so nothing here can claim a gate that
// does not exist.

export const INTENTIONAL = [
  {
    id: "ID-01",
    title: "A drawn place's scores change: one scoring method, coverage-weighted (D7)",
    what: "A custom (drawn, uploaded or coordinate-entered) place now scores with the SAME published zone method as a Program Area — Σ(coalesce(val,0)·pct) / Σ(pct) — and the species table honours `pct_covered` too. The old path (`scores_for_cells()` without the coverage blend; `cells_in_pra()` discarding `pct_covered`) read HIGH wherever a component covered only part of an area.",
    why: 'Master plan D7, decided with Ben 2026-09-20 ("absent means zero, inside the study area"), fixed in msens with regression tests rather than ported. Reproduced on v9: the blend equals every published `zone_metric` exactly (max |Δ| = 0.0). Measured effect of the OLD formula: turtle in St George Basin 49.8 vs 0.7 published, primary producer in SOC +20.3, coral in BFT +9.6, composite +6.3 for GEO, median +0.5 over the 20 Program Areas.',
    where: [
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "reproduces every published component and its post/pre coverage within 1e-9",
      },
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "scores divide by the study-area weight (w_all), not by the present weight (w_present)",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "fault 3 -- Overall as a weighted mean (by coverage) instead of a plain one",
      },
    ],
    rows: ["R-08", "R-12"],
  },
  {
    id: "ID-02",
    title: "A drawn place is clipped to US waters, and says so (D7b)",
    what: "ONE cell set drives a custom place's scores, species, area and N cells: the touched cells that are inside the study area (present in the release's cell table, `coalesce(in_usa, TRUE)`). Land and foreign waters never enter as zeros. A place tracing a Program Area therefore reads slightly ABOVE the published Area — +0.0498 on v9 GAA, +0.0076 on v7 — and the report states the share of the place inside the study area and footnotes any component below 100 % coverage.",
    why: "Master plan D7b, decided 2026-09-20. Inside Program Areas only 0–0.29 % of the weight lies outside study-area cells, so a traced Area still reproduces its published composite within 0.08 points (median 0.03).",
    where: [
      {
        file: "tests/analysis/studyAreaClip.test.ts",
        name: "n_cells_sa < n_cells: the touched-but-outside cells are dropped",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the SAME area traced as a custom place reads ~0.05 higher, and the fixture says which is which",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "fault 6 -- the D7b clip bypassed for a custom place",
      },
      { file: "tests/lib/report/narratives.test.ts", name: "is present for a geom place" },
    ],
    rows: ["R-08"],
  },
  {
    id: "ID-03",
    title: "Only Program Areas are drawn as a choropleth (D17) — Planning Areas on v1",
    what: "`boot.units` carries exactly ONE unit per release, so the Spatial units control offers \"Raster cells (0.05°)\" plus Program Areas (Planning Areas on v1) and nothing else, whatever the release's data would support. Subregion and ecoregion scores are still published and still used — the flower, the report and the zone numbers read them — they are simply never drawn as a choropleth. On **v7**, the release compared below, the Shiny app's own unit list is the same two entries, so this decision is not visible in the pairs; it bounds this and every later release.",
    why: 'Ben, 2026-09-22: "let\'s not display subregion or ecoregion scores, just program areas (or planning areas in v1) ... we keep getting stuck in minutia".',
    where: [
      {
        file: "tests/lens/scores/boot.test.ts",
        name: "primaryUnitType / primaryUnitLabel (D17: exactly one boot.units row)",
      },
      { file: "tests/lens/scores/boot.test.ts", name: "cell first, then the release's one unit" },
      { file: "tests/lens/scores/boot.test.ts", name: "v1: planarea" },
    ],
    rows: ["S-02"],
  },
  {
    id: "ID-04",
    title: "The report is computed in the browser and printed by the browser — no server, no LaTeX",
    what: 'The Shiny Report tab POSTed to `api.marinesensitivity.org/report`, which ran `quarto_render()` on the server (LaTeX for PDF, Pandoc for DOCX) in "a couple of minutes", wrote a file under `/share/public/reports/` and pointed a tab at it. The atlas report is a URL: `report.html?ver=…#pl=…` recomputes the document from the immutable release in seconds. PDF is the browser\'s own "Save as PDF" over a print stylesheet, so the text stays selectable, searchable and tagged; HTML is a self-contained download; the data package is a client-side ZIP; Word is built client-side with no reference template (the old DOCX had none either).',
    why: "Master plan atlas-7. Removes the shared-secret gate, the 600 s timeout, the 500 MiB LRU cache and the popup-blocker workaround; the place geometry never leaves the device.",
    where: [
      {
        file: "tests/report/printBreakInside.test.ts",
        name: "covers table tr (the row-clipping gate)",
      },
      {
        file: "e2e/report.spec.ts",
        name: "the running footer: real permalink + release + page N of M on every page, no overprinted/dropped body text",
      },
      {
        file: "e2e/report.spec.ts",
        name: "Download HTML opens OFFLINE (context.offline) and shows map, flowers and tables",
      },
      { file: "e2e/report.spec.ts", name: "20 zone places render completely in < 10 s" },
    ],
    rows: ["R-27"],
  },
  {
    id: "ID-05",
    title: "The report links into the Atlas, not into the Shiny apps",
    what: "§7 asks the intro to link `{host}/{ver}/scores/` and each top-20 species to `{host}/{ver}/species/?mdl_key=`. The atlas links RELATIVELY to its own `./index.html` at the same release instead.",
    why: "The Shiny apps retire at the atlas-9 cutover, and a relative link is what lets one `dist/` run unchanged on the public host and under `/{ver}/atlas/` on the preview host (CLAUDE.md, relative base).",
    where: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "the intro links to ./index.html at this release",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "a top-20 row links to the Species lens in this release, relatively",
      },
    ],
    rows: ["R-18", "R-19"],
  },
  {
    id: "ID-06",
    title:
      "Restricted releases never render on the public host; an unknown version falls through instead of erroring",
    what: "`versions.json`'s `access` decides what the public site may render. A restricted release (today v7b, v8, v9) makes NOT ONE request under its version on the public host — the version picker offers a preview-host link carrying the same query and hash instead. An unknown, malformed or denied `?ver=` falls through to `latest.txt` with the reason recorded, where the Shiny app errored, and preview access is a signed-in `session.json`, never a token in the URL.",
    why: 'Master plan D6 + D15. Everything fails closed: no `access` key, an unrecognized value, or no row at all are all "not renderable".',
    where: [
      {
        file: "e2e/shell.smoke.spec.ts",
        name: "public host + ?ver=v9: not one request under /v9/, falls through to latest",
      },
      {
        file: "e2e/scores.versionPicker.spec.ts",
        name: "?ver=v9 shows a denial notice with a preview-host link carrying the same query + hash",
      },
      {
        file: "e2e/report.spec.ts",
        name: "a restricted release on the PUBLIC host (no preview session) renders nothing to report on",
      },
    ],
    rows: ["R-21"],
  },
  {
    id: "ID-07",
    title: "A restricted release's report is watermarked, banner and all",
    what: 'On a preview session a restricted release\'s report carries a gold "PREVIEW — not for citation or distribution" banner on screen, a diagonal watermark on every printed page, and `PREVIEW_` file names on every export. The old API simply refused restricted versions.',
    why: 'atlas-7 §0: "a titled, citable PDF is exactly the artifact that must not circulate before review" — refusing outright also denied reviewers the thing they are reviewing.',
    where: [
      {
        file: "e2e/report.spec.ts",
        name: "a restricted release on a preview session shows the gold banner and the print watermark",
      },
      { file: "e2e/report.spec.ts", name: "v7 public: the PREVIEW watermark text is ABSENT" },
      {
        file: "tests/lib/report/model.test.ts",
        name: "a restricted release carries the PREVIEW banner and the PREVIEW_ file prefix (§0)",
      },
    ],
    rows: [],
  },
  {
    id: "ID-08",
    title: "The default flower comes from the release, not from an unversioned CSV",
    what: 'With nothing selected the flower is `boot.flower_default[zone_all_key]` of the release on screen, titled "Full study area". The Shiny app read a CSV that was not versioned with the release, so the default flower could describe a different release than the map.',
    why: "Documented bug in `atlas-refs/parity scores app.md` §7.1; fixed rather than ported.",
    where: [
      { file: "tests/lens/scores/flower.test.ts", name: "reads boot.flower_default[zoneAllKey]" },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "v1 (no flower_default published at all): null, never an empty flower masquerading as data",
      },
    ],
    rows: ["S-13"],
  },
  {
    id: "ID-09",
    title:
      "The `primary producer` petal has a real colour, and duplicate component keys fold into one slot",
    what: "The Shiny flower drew `primary producer` grey (an unmatched category name). The atlas resolves every component through one `categories.ts` table. On v8/v9, which publish BOTH `extrisk_primary_producer_*` and `primprod_*` as petals, the two fold into one slot instead of throwing.",
    why: "Documented bug (§7.1) plus a defect found by the atlas-4 review on the live v8/v9 boots — every flower threw before 0.9.12.",
    where: [
      {
        file: "tests/ui/categories.test.ts",
        name: "has a row for every category key the parity doc lists",
      },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "de-duplicates to exactly 7 components, dropping the bare primprod twin",
      },
      {
        file: "tests/lens/scores/composition.test.ts",
        name: "folds synonym spellings into the same category (the primary producer bug fix)",
      },
    ],
    rows: ["S-14", "R-17"],
  },
  {
    id: "ID-10",
    title:
      "The Layers control lists the layers that exist — and MapLibre's own map chrome is not there yet",
    what: "The Shiny apps' layers control carried switches (`pra_ln`, `pra_lbl`, `er_ln`) that controlled nothing. The atlas derives the list from the composed style, so a switch always has a layer. The other side of the same line: MapLibre's fullscreen / navigation / scale controls, the globe minimap and the Nominatim \"Go to location\" geocoder are NOT built in either lens.",
    why: 'The dead switches are a documented bug (§6.4). The missing chrome is a deliberate hold: those are real buttons that would nest inside `#map[role="img"]` and fail axe, so where map chrome lives is one cross-lens decision, recorded as gap G-02 rather than guessed at twice.',
    where: [
      {
        file: "tests/map/style.test.ts",
        name: "excludes page chrome, EVERY merged CARTO basemap layer, and the click-driven selection ring (never user-toggleable)",
      },
      {
        file: "tests/map/style.test.ts",
        name: "a bare background+basemap style (nothing selected yet) lists no items",
      },
    ],
    rows: ["S-08", "P-07"],
  },
  {
    id: "ID-11",
    title:
      "The species map draws Program-Area outlines; the Shiny app drew Ecoregions and let you choose",
    what: "The Shiny species app defaulted its Outlines select to Ecoregions (black) and offered Program Areas / Ecoregions / None. The atlas draws the release's ONE unit — Program Areas, white — on BOTH lenses (visible in the species pairs below), and has no Outlines select (G-02). The `out=` URL value exists and round-trips, but nothing reads it yet, so it cannot change what is drawn (G-25).",
    why: "The species-lens chrome was deferred (G-02) and D17 makes the release's one unit the only outline the app knows how to draw. `out`'s per-lens default (`none` for species, `programarea` for scores) was a documented interpretation taken in atlas-2 when no UI existed to confirm it against, pinned by a test so a later deliberate change shows as a diff rather than drift.",
    where: [{ file: "tests/state/codec.test.ts", name: "defaultOut" }],
    rows: ["P-07"],
  },
  {
    id: "ID-12",
    title: "On v7 a species frames the study area, not its own range",
    what: 'The Shiny species app computed each model\'s extent with `mdl_bbox()` — a min/max over a whole model joined to the 17 M-row cell table, the app\'s most expensive query — and offers a "Zoom to layer" button (which the atlas does not have, G-02). The atlas instead reads the extent the release PUBLISHES on the taxon shard. v7 publishes NONE (all 16,153 null) and 5,053 of v9\'s are written wrapped (> 300° wide), so the atlas re-frames client-side and, with no usable extent at all, frames the study area rather than the globe. **In the pairs below neither app is framed on the taxon** — the Shiny app also opens on a study-area view — so what this line costs today is the "fit to this species" first impression, not the data.',
    why: "The shard-bbox contract is not met by the published bundles (measured 2026-09-22 over every shard). The lens compensates; the msens fix (`.app_bbox` / `lon_span_agg`) and a re-publish of `app/` are atlas-1's (gap G-11).",
    where: [
      {
        file: "tests/lens/species/camera.test.ts",
        name: "with no extent at all, the study area frames US waters — never the globe",
      },
      {
        file: "tests/lens/species/camera.test.ts",
        name: "re-frames a WRAPPED published extent rather than obeying it",
      },
      {
        file: "tests/lens/species/camera.test.ts",
        name: "every fitted span is < 200 deg and every centre lies inside the model's own longitudes",
      },
    ],
    rows: ["P-11"],
  },
  {
    id: "ID-13",
    title: 'New: a zones table, places, and "Report a problem"',
    what: 'The atlas adds controls the Shiny apps never had: a zones table (every zone of the unit ranked by the current layer, with all components — the keyboard and screen-reader equivalent of the choropleth, and the "report on selected" entry point); places you can select, draw, upload or type as coordinates, carried in the URL hash; and a "Report a problem" control that opens a prefilled GitHub issue with the app SHA, release, lens and URL — without the hash.',
    why: 'atlas-4\'s "New, because a panel app needs it", atlas-6 and atlas-8 Deliverable 4.',
    where: [
      {
        file: "tests/lens/scores/zonesTable.test.ts",
        name: "ranks by the current layer, descending, and equals boot.zones' own metrics exactly",
      },
      {
        file: "e2e/places.spec.ts",
        name: "keyboard-only: Enter coordinates creates a place, rename, then remove -- drawing is never the only way",
      },
      {
        file: "e2e/feedback.spec.ts",
        name: "real browser: hash is present in location, absent from the control's href",
      },
    ],
    rows: ["S-22"],
  },
  {
    id: "ID-14",
    title: 'The document title says "Marine Sensitivity", not "BOEM Marine Sensitivity"',
    what: 'Species-lens document title: `"{sci} distribution ({cat}[: {common}]; {key}) from {layer} | Marine Sensitivity"`. The Shiny app\'s suffix is "| BOEM Marine Sensitivity".',
    why: "atlas-5's checklist writes the suffix this way; the agency lockup is a build-time option (`VITE_SEAL`) rather than part of every title.",
    where: [
      {
        file: "tests/lens/species/card.test.ts",
        name: "names the taxon, its category, the key on screen and the layer",
      },
    ],
    rows: ["P-18"],
  },
  {
    id: "ID-15",
    title: "Download file names carry the date, and `PREVIEW_` on a restricted release",
    what: "The species CSV is `{stem}_{YYYY-MM-DD}.csv` and the report's exports are `MarineSensitivity_{slug}_{ver}_{YYYY-MM-DD}.{ext}`, prefixed `PREVIEW_` on a restricted release; §7 asks for `species_<slug>_<ver>.csv`. Every file is built in the browser, which retires `GET /species.csv` and the WKT polygon it carried in a query string.",
    why: "A dated file name is what makes two downloads of the same area distinguishable; `PREVIEW_` belongs to ID-07.",
    where: [
      { file: "tests/lens/scores/species.test.ts", name: "stem_YYYY-MM-DD.csv" },
      {
        file: "tests/lib/report/model.test.ts",
        name: "the CSV filename carries the place, the release and the date (and PREVIEW_ when restricted)",
      },
    ],
    rows: ["R-20", "S-15"],
  },
  {
    id: "ID-16",
    title: "A species click uses the release's own grid; `native_asset` and `mdl_bbox()` are gone",
    what: "The Shiny species app converted a click with a hard-coded 7200×3600 grid, which is wrong for every v1–v7 release (they are `usa05`: 3103×2006 from 141.10°, 0–360 longitudes). The atlas takes the grid from the release. It also never reads the 86,857-row `native_asset` lookup or runs `mdl_bbox()`: one ≤ 25 KB shard per taxon carries the card, the inputs and every asset.",
    why: "Documented bug (§6.5) and atlas-5's data design; a source scan keeps the retired tokens out of the lens and the shared map module.",
    where: [
      {
        file: "tests/map/interaction.test.ts",
        name: "computes the cell id with the RELEASE's grid — the same lon/lat differs per grid",
      },
      { file: "tests/grid/grid.test.ts", name: "cellFromLonLat (msens::cell_from_lonlat)" },
      {
        file: "tests/lens/species/sourceScan.test.ts",
        name: "src/lens/species/** and src/lib/map/** contain none of the five retired tokens",
      },
    ],
    rows: ["P-13"],
  },
  {
    id: "ID-17",
    title: "The URL is the whole view, and a place never reaches a server",
    what: "Every input — release, lens, layer, palette, unit, study area, camera, species, input, representation, US-only, outlines, selection, theme — round-trips through the query string, and places live in the `#hash` under a versioned binary codec. The Shiny apps kept only `?ver=` across a reload, and a drawn polygon was POSTed as WKT to the API. Ordinary interaction uses `replaceState`, so a shared link reproduces its exact view and the Back button is not filled with view states.",
    why: "Master plan D8 and atlas-2's state rules; a fragment is never sent to a server or a referrer, which is why places live there.",
    where: [
      {
        file: "e2e/shell.url-state.spec.ts",
        name: "a full interaction walk never calls history.pushState, and never grows history.length",
      },
      {
        file: "e2e/places.spec.ts",
        name: "the hash is absent from every request the browser makes during the whole flow",
      },
      {
        file: "e2e/places.spec.ts",
        name: "fresh-profile round trip: copying the link and opening it elsewhere recomputes the SAME cell count and composite",
      },
    ],
    rows: [],
  },
  {
    id: "ID-18",
    title: "The basemap is CARTO's vector styles, and the whole style is applied in one call",
    what: "Basemap tiles come from CARTO's keyless `dark-matter` / `positron` GL styles, merged into ONE composed MapLibre style applied with `setStyle(diff: true)`; nothing is added layer-by-layer after load. The Shiny apps built their maps incrementally.",
    why: '`atlas-refs/calcofi explore review.md` lesson 3 (layers added after load vanish across a style swap). CARTO\'s RASTER endpoints started watermarking "API KEY REQUIRED" on 2026-09-23 and were replaced the same day.',
    where: [
      { file: "tests/map/basemap.test.ts", name: "navy is CARTO's dark-matter GL style" },
      {
        file: "tests/map/no-raster-basemap.test.ts",
        name: "SEEDED FAULT: the same scan flags tests/fixtures/map/raster-basemap-fault/",
      },
      {
        file: "tests/map/style.test.ts",
        name: "calls setStyle(style, {diff:true}) — and nothing else",
      },
    ],
    rows: ["S-09"],
  },
];

export const GAPS = [
  {
    id: "G-01",
    title:
      "Zone rows carry no `name` and no `label_pt`, so the app shows keys and draws no zone labels",
    detail:
      'Measured on every published boot (all eleven releases): the atlas-1 contract promised `{key, name, label_pt, …}`; msens\'s `app_zones()` writes neither. Tooltips, the species header and the CSV stem therefore read "GAA" where "Gulf of Alaska" belongs, and the label layer — which is built and tested — has nothing to draw.',
    owner: "atlas-1 (msens `app_zones()`), then re-publish `app/`",
    rows: ["S-04", "S-07", "S-15"],
  },
  {
    id: "G-02",
    title:
      'Map chrome: no fullscreen / navigation / scale controls, no geocoder, no minimap, no Outlines select, no "Zoom to layer"',
    detail:
      'Neither lens built them: they are real buttons that would nest inside `#map[role="img"]` and fail axe. One cross-lens decision (a toolbar outside the map element, or drop `role="img"` for a labelled region) is owed before they land.',
    owner: "atlas-8/9",
    rows: ["S-08", "P-07"],
  },
  {
    id: "G-03",
    title: 'The "cell click ≤ 2 requests cold, 0 warm" budget was never turned into a gate',
    detail: "The click path is asserted; the request COUNT is not.",
    owner: "atlas-8",
    rows: ["S-10"],
  },
  {
    id: "G-04",
    title: "The GAA species CSV is not compared byte-for-byte against the R fixture",
    detail:
      "atlas-4's gate (\"the CSV's bytes equal the fixture CSV for the GAA Program Area on v7\") has no fixture. The CSV's rules (columns, formats, quoting, filename) and the report's own species CSV round trip ARE asserted.",
    owner: "atlas-8",
    rows: ["S-15"],
  },
  {
    id: "G-05",
    title:
      "Two literal rules have no test of their own: the species table's column ORDER, and the species eligibility filter's three conditions",
    detail:
      "The column order is declared in `SpeciesTable.svelte`; the eligibility filter lives in `sql/species_for_cells.sql`, whose ANSWERS are diffed against msens at 1e-9 (so a changed filter goes red) but whose text is not asserted.",
    owner: "atlas-8",
    rows: ["S-16", "R-13"],
  },
  {
    id: "G-06",
    title: "The composition treemap is one level, not six WoRMS ranks",
    detail:
      "Species category only; the Shiny app drew a six-rank hierarchy. Birds (BOTW taxa) carry no hierarchy in either.",
    owner: "atlas-8",
    rows: ["S-19"],
  },
  {
    id: "G-07",
    title: "Neither lens reads `capabilities.cell_model`",
    detail:
      "On a release that publishes no cell-level species the scores header would not say so. The places panel DOES honour the same capability.",
    owner: "atlas-8",
    rows: ["S-20"],
  },
  {
    id: "G-08",
    title: "No guided tour",
    detail:
      'The Shiny apps had a 10-step (scores) and 5-step (species) driver.js tour. The atlas\'s "Take a Tour" button announces that there is no tour yet; `?tour=off` is honoured. driver.js is a new dependency against a 450 KB budget, so it was held.',
    owner: "atlas-8/9",
    rows: ["S-21", "P-19"],
  },
  {
    id: "G-09",
    title: "Five small behaviours are built but have no test of their own",
    detail:
      'The species name copy buttons and their `execCommand` fallback; the phone fold of the layer pills (`{N} layers ▾`); Share / "Download this layer" in the card; the deep-linked-input "jigger" (no merged-surface flash), verified by hand in atlas-5 but never turned into a spec; and a lens switch with a place active (the places layer is composed for both lenses, so it cannot structurally be dropped — but nothing asserts it).',
    owner: "atlas-8",
    rows: ["P-03", "P-05", "P-17", "P-21", "P-22"],
  },
  {
    id: "G-10",
    title: "`capabilities.pmtiles_s3` is not honoured",
    detail:
      "Ranges are drawn from the URL the shard gives; the documented preference for the S3 copy over `file.marinesensitivity.org` is unimplemented.",
    owner: "atlas-8",
    rows: ["P-09"],
  },
  {
    id: "G-11",
    title: "Published shard bboxes are not minimal-span, and v7 has none",
    detail:
      "v9: 48,378 bboxes, 5,053 spanning > 300° (Pacific taxa written wrapped), only 16 with `xmax > 180`, 38,448 null. v7: all 16,153 null. The lens compensates (ID-12); the fix is msens's.",
    owner: "atlas-1 (msens `.app_bbox` / `lon_span_agg`), re-publish `app/`",
    rows: ["P-11"],
  },
  {
    id: "G-12",
    title: "Three of the species lens's ten analytics events are not emitted",
    detail:
      "`toggle_obis`, `select_outlines` and `open_about` belong to controls that are not built (G-02, G-13).",
    owner: "atlas-8",
    rows: ["P-19"],
  },
  {
    id: "G-13",
    title: "No OBIS occurrence overlay",
    detail:
      "The Shiny species app has an OBIS h3 tile overlay behind its own toggle and a 3 s service probe; the atlas has none.",
    owner: "atlas-8/9",
    rows: ["P-20"],
  },
  {
    id: "G-14",
    title: "The ecoregion `norm_pct` blend is not re-tested in this repo",
    detail:
      "The blend across multi-ecoregion cells (951 cells affected; 10,996 cells in no ecoregion produce no value) happens in msens at publish time and the atlas reads the published column. Nothing here re-implements it, and nothing here re-asserts it.",
    owner: "msens (already has its own tests) / atlas-8 if it should be pinned from this side too",
    rows: ["R-15"],
  },
  {
    id: "G-15",
    title: "The per-version browser matrix (v1, v2, v3, v4b) was never run",
    detail:
      'v7 is exercised end to end (it is `latest`), and v9 through hermetic fixtures and the preview path. Step 4 of atlas-4 and atlas-5 — unit list, default layer, a zone click, a cell click either side of 180°, the single-model taxon of §11.5 — is outstanding, including "v1 renders Planning Areas with no console error".',
    owner: "atlas-8",
    rows: ["R-22"],
  },
  {
    id: "G-16",
    title: "No end-to-end fixture of a place that intersects ZERO cells",
    detail:
      "Every empty shape the report model can be handed is unit-tested; the whole-document path is not.",
    owner: "atlas-8",
    rows: ["R-26"],
  },
  {
    id: "G-25",
    title: "`out=` is parsed and round-tripped, but nothing reads it",
    detail:
      "`Sel.out` is written (and defaulted per lens) but no map code consumes it: the shell always composes the release's one zone unit, so a link carrying `out=none` or `out=ecoregion` still shows Program-Area outlines. Either wire it to `composeStyle`'s `zones` input with the Outlines select (G-02), or stop writing a value the view does not honour — a URL key that does not reproduce its view is exactly what the URL-is-the-view rule exists to prevent.",
    owner: "atlas-8 (with G-02)",
    rows: ["P-07"],
  },
  {
    id: "G-24",
    title:
      "The zones table's score column is headed by the metric's FULL label, which breaks the header",
    detail:
      'Visible in the "Scores · zones table" shot below: the current layer\'s column header is the whole published `label` ("Combined score of extinction risk per species category and primary productivity, equally weighted (and each previously rescaled [0,100] based on Ecoregional min/max values)"), which wraps to one word per line inside the panel and pushes every data row out of view. The table itself is correct (`zonesTableRows` equals `boot.zones` exactly) — it is the header that needs a short name, with the full label as a `title`/tooltip.',
    owner: "atlas-8 (a short column label; the full text belongs in a tooltip)",
    rows: ["S-22"],
  },
  {
    id: "G-23",
    title: "Two copy defects on the composition treemap, both visible in the screenshot pair below",
    detail:
      'Found by looking at the shots for this page, not by a test. (1) The summary line under the treemap reads "210,671,300.041 **species** across 7 categories" — that number is the summed `suit_er_area`, not a species count, and it is also the figure\'s accessible description (`Treemap.svelte#summaryText`). (2) The ported note "the \'bird\' component has yet to be added to this visualization" is printed above a treemap that DOES show a Bird box: the note belongs to the six-rank WoRMS version (G-06), while the shipped one-level treemap groups by `sp_cat` and therefore includes birds.',
    owner: "atlas-8 (a one-line copy fix each, plus the gallery treemap test)",
    rows: ["S-19"],
  },
  {
    id: "G-22",
    title: "Only the Spectral palette actually has stops",
    detail:
      'The palette control offers all four choices the Shiny app does (Spectral / Viridis / Cividis / Magma), but every published release carries `boot.palettes.spectral_r` alone, so the other three render an "unavailable" legend rather than an invented ramp. The Shiny app drew all four (it held its own ramps in R).',
    owner: "atlas-1 (publish the other three ramps) or atlas-8 (hide the choices until it does)",
    rows: ["S-03"],
  },
  {
    id: "G-17",
    title: "The basemap is a third-party dependency on every page load",
    detail:
      "CARTO's keyless vector styles (`dark-matter`, `positron`). A self-hosted PMTiles basemap on S3 would remove the dependency; CARTO's raster endpoints already started demanding a key once.",
    owner: "atlas-8/9",
    rows: [],
  },
  {
    id: "G-18",
    title: "The OPFS table store is built and tested but not wired into the app",
    detail:
      "The in-memory store is the default and the tested path. Whoever wires `openTableStoreBackend()` must pass `restrictedVersions`, or the ruled eviction order degrades to plain LRU.",
    owner: "atlas-8/9",
    rows: [],
  },
  {
    id: "G-19",
    title: "Upload parsers run on the main thread",
    detail: "Lazily imported, but not off-thread: 290 ms synchronous at 49 k vertices.",
    owner: "atlas-8",
    rows: [],
  },
  {
    id: "G-20",
    title: 'The places list shows "—" for coverage and composite on geometry places',
    detail: "`rowFigures` is null for a drawn place in the list, though the report computes both.",
    owner: "atlas-8",
    rows: [],
  },
  {
    id: "G-21",
    title: "v8's `zone_taxon` has no rows for subregion `AT`",
    detail:
      "Scored with 52,674 cells but 0 taxa (v9 has 7,562). The bundle carries `n_taxa = 0` and the species table says so rather than showing an empty list. v8 is restricted and superseded by v9.",
    owner: "atlas-1 (rebuild or leave)",
    rows: [],
  },
];

export const NOT_COMPARED = [
  "**v8 and v9 (restricted releases) are not in any screenshot.** They are not reachable on the public site by design (ID-06), and this page was produced against the public hosts only. Every pair below is **v7**, today's `latest.txt`.",
  "**The preview host is not exercised here.** `preview.marinesensitivity.org/{ver}/atlas/` and its Cloudflare Access policy are atlas-9 Deliverable 5; what this page shows about restricted releases comes from hermetic browser specs, not from the live preview host.",
  '**Only the states listed under "Screenshot pairs" were compared visually.** Every other checklist line is backed by the test named in its Evidence column, not by a picture.',
  '**No report was generated on the Shiny side.** The old pipeline renders server-side in "a couple of minutes" per request; the pair shows the Shiny Report FORM against the atlas\'s rendered report.',
  "**Desktop only.** Shots are 1280×800. The phone viewport (390×844) is covered by `scripts/verify.mjs`'s state matrix and the axe/layout specs, not by these images.",
  "**Print output is not shown as an image.** The PDF is asserted by extracting text from a real Chromium `page.pdf()` (labels, table headers, the running footer, the PREVIEW watermark) in `e2e/report.spec.ts`.",
  "**Numbers are not compared by eye.** Score equality with msens is a gate (`npm run parity`, `tests/lib/report/numbers.test.ts`, the DuckDB-WASM twin run), asserted at 1e-9 — a screenshot is not evidence of a number.",
];
