# scripts/parity/report_fixtures.R -- the R side of the atlas-7 step 1 NUMBERS GATE.
#
# Writes tests/fixtures/report/{v7,v9}/report_{place}.json: for three places x two releases, both
# the INPUT a caller hands `buildReport()` (the already-run query results) and the EXPECTED derived
# output R produces from it (composite, er_consolidate() counts, the top-20 order, the full-list
# order). `tests/lib/report/numbers.test.ts` drives `src/lib/report/model.ts` through them.
#
# R IS THE TRUTH HERE. Nothing in this file reads src/lib/report/*: the TypeScript is the port under
# test, exactly as scripts/parity/fixtures.R is the reference for the sql/*.sql twins.
#
# READ-ONLY, ALWAYS. msens is loaded with devtools::load_all() from the atlas-contract WORKTREE
# (never installed), every DuckDB is opened read_only, nothing is published.
#
# Usage:
#   Rscript scripts/parity/report_fixtures.R [v9 v7]
# Environment (same contract as scripts/parity/fixtures.R):
#   MSENS_DIR    the msens worktree to load_all()        (default: the atlas-contract worktree)
#   DERIVED_DIR  holds {ver}/sdm.duckdb                  (default: ~/_big/msens/derived)
#   BUNDLE_DIR   holds {ver}/boot.json + zone_taxon      (default: the atlas-contract dry runs)
#   OUT_DIR      where the fixtures land                 (default: tests/fixtures/report)

suppressPackageStartupMessages({
  library(DBI); library(duckdb); library(jsonlite); library(tibble); library(dplyr)
  library(stringr); library(tidyr); library(sf)
})

`%||%` <- function(a, b) if (is.null(a)) b else a

ROOT <- normalizePath(Sys.getenv("ATLAS_ROOT", getwd()))
stopifnot("run from the atlas repo root (or set ATLAS_ROOT)" = dir.exists(file.path(ROOT, "sql")))

find_msens <- function() {
  for (p in c(file.path(ROOT, ".claude/worktrees/contract/msens"),
              file.path(ROOT, "../contract/msens"),
              file.path(ROOT, "../../../.claude/worktrees/contract/msens")))
    if (file.exists(file.path(p, "DESCRIPTION"))) return(normalizePath(p))
  stop("msens not found; set MSENS_DIR to the atlas-contract worktree", call. = FALSE)
}
MSENS_DIR   <- Sys.getenv("MSENS_DIR", ""); if (!nzchar(MSENS_DIR)) MSENS_DIR <- find_msens()
DERIVED_DIR <- Sys.getenv("DERIVED_DIR", path.expand("~/_big/msens/derived"))
BUNDLE_DIR  <- Sys.getenv("BUNDLE_DIR", ""); if (!nzchar(BUNDLE_DIR))
  BUNDLE_DIR <- file.path(dirname(MSENS_DIR), "workflows/_output/app_bundle")
OUT_DIR     <- Sys.getenv("OUT_DIR", file.path(ROOT, "tests/fixtures/report"))
VERS        <- commandArgs(trailingOnly = TRUE)
if (!length(VERS)) VERS <- c("v9", "v7")

message("msens:   ", MSENS_DIR)
suppressMessages(devtools::load_all(MSENS_DIR, quiet = TRUE))
MSENS_VERSION <- as.character(utils::packageVersion("msens"))
message("loaded msens ", MSENS_VERSION)

# ---- the release, as the browser sees it (identical to scripts/parity/fixtures.R) --------------

cell_model_dir <- function(ver) {
  for (p in c(file.path(DERIVED_DIR, ver, "cell_model"),
              file.path(DERIVED_DIR, ver, "marine-atlas/serve/cell_model")))
    if (dir.exists(p)) return(p)
  NA_character_
}

open_release <- function(ver) {
  path <- file.path(DERIVED_DIR, ver, "sdm.duckdb")
  stopifnot("release database not found" = file.exists(path))
  con <- DBI::dbConnect(duckdb::duckdb())
  DBI::dbExecute(con, sprintf("ATTACH '%s' AS rel (READ_ONLY)", path))
  tabs <- DBI::dbGetQuery(con, "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'rel'")$table_name
  for (t in tabs) DBI::dbExecute(con, sprintf('CREATE VIEW "%s" AS SELECT * FROM rel."%s"', t, t))
  cm <- cell_model_dir(ver)
  if (!is.na(cm))
    DBI::dbExecute(con, sprintf(
      "CREATE VIEW cell_model AS SELECT * FROM read_parquet('%s/tile=*/*.parquet', hive_partitioning = 1)", cm))
  zt <- file.path(BUNDLE_DIR, ver, "zone_taxon.parquet")
  if (file.exists(zt)) {
    DBI::dbExecute(con, "DROP VIEW IF EXISTS zone_taxon")
    DBI::dbExecute(con, sprintf("CREATE VIEW zone_taxon AS SELECT * FROM read_parquet('%s')", zt))
  }
  con
}

boot_of <- function(ver) jsonlite::fromJSON(file.path(BUNDLE_DIR, ver, "boot.json"), simplifyVector = FALSE)

grid_of <- function(boot) {
  g <- boot$grid
  list(grid_id = g$grid_id, nc = as.integer(g$nc), nr = as.integer(g$nr),
       xmin = as.numeric(g$xmin), ymax = as.numeric(g$ymax),
       resx = as.numeric(g$resx), resy = as.numeric(g$resy), lon360 = isTRUE(g$lon360))
}

# `digits = I(17)` for the same reason scripts/parity/fixtures.R gives: 15 significant digits does
# not round-trip an IEEE754 double and the gate's own tolerance is 1e-9.
write_json_file <- function(x, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  writeLines(jsonlite::toJSON(x, auto_unbox = TRUE, digits = I(17), na = "null", null = "null"), path)
  message("  wrote ", sub(paste0(OUT_DIR, "/"), "", path, fixed = TRUE),
          " (", format(file.size(path), big.mark = ","), " B)")
}

# ---- er_consolidate(), PORTED NOWHERE: this IS api/report_area_child.qmd:45-57 -----------------
# Copied verbatim from the old report so the fixture is the old report's own answer, not a
# re-derivation of it. src/lib/report/er.ts is the TypeScript port under test.
er_consolidate <- function(code) {
  authority <- stringr::str_split_i(code, ":", 1)
  status    <- stringr::str_split_i(code, ":", 2)
  dplyr::case_when(
    authority %in% c("FWS", "NMFS") & status == "EN" ~ "USA:EN(100)",
    authority %in% c("FWS", "NMFS") & status == "TN" ~ "USA:TN(50)",
    authority %in% c("FWS", "NMFS") & status == "LC" ~ "USA:LC(1)",
    authority == "IUCN" & status == "CR"             ~ "IUCN:CR(50)",
    authority == "IUCN" & status == "EN"             ~ "IUCN:EN(25)",
    authority == "IUCN" & status == "VU"             ~ "IUCN:VU(5)",
    authority == "IUCN" & status == "NT"             ~ "IUCN:NT(2)",
    TRUE                                             ~ "other(1)")
}

ER_CAT_ORDER <- c("USA:EN(100)", "USA:TN(50)", "USA:LC(1)",
                  "IUCN:CR(50)", "IUCN:EN(25)", "IUCN:VU(5)", "IUCN:NT(2)", "other(1)")

# the counts table exactly as report_area_child.qmd:60-83 builds it (UNFORMATTED -- scales::comma()
# is a display step the TypeScript does separately, and a fixture of strings would hide a count).
species_counts <- function(d) {
  d <- dplyr::mutate(d, er_code = ifelse(is.na(.data$er_code), "NA", .data$er_code))
  d <- dplyr::mutate(d, er_cat = er_consolidate(.data$er_code))
  seen <- intersect(ER_CAT_ORDER, unique(d$er_cat))
  w <- d |>
    dplyr::distinct(.data$mdl_key, .data$sp_cat, .data$er_cat) |>
    dplyr::count(.data$sp_cat, .data$er_cat) |>
    tidyr::pivot_wider(names_from = "er_cat", values_from = "n", values_fill = 0L) |>
    dplyr::rename(Category = "sp_cat") |>
    dplyr::arrange(.data$Category) |>
    dplyr::relocate("Category", dplyr::all_of(seen))
  w$Total <- rowSums(w[, seen, drop = FALSE])
  tot <- vapply(w[, c(seen, "Total"), drop = FALSE], sum, numeric(1))
  list(
    columns   = seen,
    rows      = lapply(seq_len(nrow(w)), function(i)
                   c(list(category = w$Category[i]),
                     list(counts = as.integer(unlist(w[i, seen, drop = TRUE]))),
                     list(total = as.integer(w$Total[i])))),
    total_row = list(counts = as.integer(tot[seen]), total = as.integer(tot[["Total"]])),
    n_species = dplyr::n_distinct(d$mdl_key))
}

# the Top 20 exactly as report_area_child.qmd:99-104: distinct on the seven display columns, then
# arrange(desc(suit_er_area)) (dplyr's stable radix order), head(20).
species_top20 <- function(d) {
  t <- d |>
    dplyr::distinct(.data$mdl_key, .data$sp_cat, .data$sp_common, .data$sp_scientific,
                    .data$er_code, .data$er_score, .data$suit_er_area) |>
    dplyr::arrange(dplyr::desc(.data$suit_er_area)) |>
    utils::head(20)
  lapply(seq_len(nrow(t)), function(i) list(
    mdl_key       = as.character(t$mdl_key[i]),
    sp_cat        = as.character(t$sp_cat[i]),
    sp_common     = if (is.na(t$sp_common[i])) NULL else as.character(t$sp_common[i]),
    sp_scientific = as.character(t$sp_scientific[i]),
    er_code       = if (is.na(t$er_code[i])) NULL else as.character(t$er_code[i]),
    er_score      = as.numeric(t$er_score[i]),
    suit_er_area  = as.numeric(t$suit_er_area[i])))
}

# COLUMNAR, not row objects: the GAA species list is ~6,300 rows and repeating 13 keys per row
# triples the committed fixture for nothing.
SPECIES_COLS <- c("sp_cat", "sp_common", "sp_scientific", "taxon_id", "taxon_authority",
                  "er_code", "er_score", "is_mmpa", "is_mbta", "mdl_key",
                  "area_km2", "avg_suit", "suit_er", "suit_er_area", "cat_suit_er_area", "pct_cat")

species_columnar <- function(d) {
  cols <- intersect(SPECIES_COLS, names(d))
  out <- lapply(cols, function(k) {
    v <- d[[k]]
    if (is.numeric(v)) as.numeric(v) else if (is.logical(v)) v else as.character(v)
  })
  names(out) <- cols
  list(n = nrow(d), columns = cols, values = out)
}

# ---- component scores --------------------------------------------------------------------------

score_rows <- function(d)
  lapply(seq_len(nrow(d)), function(i) list(
    metric_key         = as.character(d$metric_key[i]),
    component          = as.character(d$component[i]),
    score              = as.numeric(d$score[i]),
    even               = 1,
    coverage           = as.numeric(d$coverage[i]),
    mean_where_present = as.numeric(d$mean_where_present[i])))

# A ZONE PLACE's components, as the browser gets them: straight out of `boot.zones[unit][key].metrics`
# (= the published `zone_metric`), never recomputed. `coverage` is NOT published as such, but both
# the post-weight value and its `_prepctareaweighting` twin are, and
# `score = coverage * mean_where_present` is an identity of the pipeline (score_zone_metrics.qmd's
# steps (a) and (c)) -- so coverage is exactly post/pre, and mean_where_present IS the pre value.
zone_components <- function(boot, unit, key) {
  rows <- Filter(function(z) identical(z$key, key), boot$zones[[unit]])
  stopifnot("zone key not in boot.zones" = length(rows) == 1)
  m <- rows[[1]]$metrics
  keys <- grep("_ecoregion_rescaled$", names(m), value = TRUE)
  keys <- sort(keys)
  comp <- function(k) sub("_", " ", sub("_ecoregion_rescaled", "", sub("extrisk_", "", k)))
  keys <- keys[vapply(keys, comp, "") != "all"]
  lapply(keys, function(k) {
    pre <- m[[paste0(k, "_prepctareaweighting")]]
    post <- as.numeric(m[[k]])
    list(metric_key = k, component = comp(k), score = post, even = 1,
         coverage = if (is.null(pre) || pre == 0) NULL else post / as.numeric(pre),
         mean_where_present = if (is.null(pre)) NULL else as.numeric(pre))
  })
}

zone_stat <- function(boot, unit, key) {
  rows <- Filter(function(z) identical(z$key, key), boot$zones[[unit]])
  r <- rows[[1]]
  list(n_cells = as.integer(r$n_cells), area_km2 = as.numeric(r$area_km2),
       n_taxa = if (is.null(r$n_taxa)) NULL else as.integer(r$n_taxa),
       published_composite = as.numeric(
         r$metrics[["score_extriskspcat_primprod_ecoregionrescaled_equalweights"]]))
}

# ---- custom places -------------------------------------------------------------------------------

# EVERY ANALYSIS RUNS ON decode(encode(geometry)) (master-plan D8) -- see scripts/parity/fixtures.R's
# note: skipping it moves `pct_covered` on edge cells and the gate is 1e-9.
analysis_geometry <- function(g)
  place_decode(place_encode(list(kind = "geom", name = "p", geometry = g)))[[1]]$geometry

wkt_geometry <- function(id)
  sf::st_as_sfc(paste(readLines(file.path(ROOT, "tests/fixtures/upload", paste0(id, ".wkt")),
                                warn = FALSE), collapse = " "), crs = 4326)

# `sum(cell.area_km2 * pct/100)` over the D7b-clipped cell set: the SAME quantity
# sql/species_for_cells.sql sums per species, summed once for the place (the report's "Area").
place_area_km2 <- function(con, cells) {
  if (!nrow(cells)) return(0)
  ids <- paste(sprintf("(%d, %.10f)", as.integer(cells$cell_id), as.numeric(cells$pct_covered)),
               collapse = ", ")
  DBI::dbGetQuery(con, glue::glue(
    "WITH z AS (SELECT * FROM (VALUES {ids}) AS v(cell_id, pct_covered))
     SELECT sum(c.area_km2 * z.pct_covered / 100.0) AS a
       FROM z JOIN cell c USING (cell_id)"))$a[1]
}

custom_place <- function(con, grid, geom, species = TRUE) {
  g   <- analysis_geometry(geom)
  all <- cells_in_polygon_grid(g, grid)
  sa  <- cells_in_study_area(con, all)
  d   <- scores_for_cells(con, all, blend = TRUE, denominator = "study_area")
  spp <- if (!species) NULL else
           species_for_cells(con, if (nrow(sa)) sa else
             tibble::tibble(cell_id = integer(), pct_covered = numeric()))
  list(cells_all = all, cells_sa = sa, scores = d, species = spp,
       area_km2 = place_area_km2(con, sa))
}

# ---- per place x version ---------------------------------------------------------------------

build_zone_fixture <- function(ver, con, boot, grid) {
  unit <- "programarea"; key <- "GAA"
  comps <- zone_components(boot, unit, key)
  zs    <- zone_stat(boot, unit, key)
  spp   <- species_for_zone(con, "programarea_key", key)
  composite <- mean(vapply(comps, function(c) c$score, numeric(1)))
  message("  GAA (zone): ", length(comps), " components, composite ", signif(composite, 8),
          " (published ", signif(zs$published_composite, 8), "), ", nrow(spp), " species rows")

  # THE SAME AREA, TRACED AS A CUSTOM PLACE. The atlas-6 reviewer measured a UI-traced GAA composite
  # of 40.4982 against the published 40.4484; this block records both so a reader of the fixture can
  # see WHICH number a report shows for WHICH kind of place, rather than discovering the ~0.05 gap
  # as a failing assertion. The outline fixture is a v9-vintage Program Area, so the gap is only
  # meaningful on v9 (on v7 it also carries a boundary-vintage difference).
  fx <- place_fixture(file.path(ROOT, "tests/fixtures/places/programarea_gaa.json"))
  tr <- custom_place(con, grid, fx$geometry, species = FALSE)
  tr_comp <- if (nrow(tr$scores)) mean_score(tr$scores) else NA_real_
  message("  GAA (traced as a custom place): ", nrow(tr$cells_sa), " cells in the study area, ",
          "composite ", signif(tr_comp, 8), "; delta vs published ",
          signif(tr_comp - zs$published_composite, 4))

  list(
    place = "gaa", kind = "zone", name = key, zone_set = "pa", zone_keys = list(key),
    input = list(
      n_cells = zs$n_cells, area_km2 = zs$area_km2, study_area_pct = 100,
      components = comps, species = species_columnar(spp),
      # the raw `boot.zones[unit][key]` row the browser reads, so the TypeScript's own
      # `zoneComponents()` derivation (post/pre -> coverage) is measured against R's, not just
      # handed R's answer
      boot_zone = Filter(function(z) identical(z$key, key), boot$zones[[unit]])[[1]]),
    expected = list(
      composite = composite,
      published_composite = zs$published_composite,
      n_species = dplyr::n_distinct(spp$mdl_key),
      counts = species_counts(spp),
      top20 = species_top20(spp),
      full_order = as.character(spp$mdl_key)),
    traced_as_custom_place = list(
      note = paste("the SAME Program Area traced as a drawn place: the report shows THIS number for",
                   "a custom place and the published `zone_metric` one above for a zone place"),
      n_cells_touched = nrow(tr$cells_all), n_cells_study_area = nrow(tr$cells_sa),
      area_km2 = tr$area_km2, composite = tr_comp,
      delta_vs_published = tr_comp - zs$published_composite,
      components = score_rows(tr$scores)))
}

build_custom_fixture <- function(ver, con, grid, id, name) {
  p <- custom_place(con, grid, wkt_geometry(id))
  composite <- if (nrow(p$scores)) mean_score(p$scores) else NA_real_
  message("  ", id, ": ", nrow(p$cells_all), " cells touched, ", nrow(p$cells_sa),
          " in the study area, ", nrow(p$scores), " components, composite ", signif(composite, 8),
          ", ", nrow(p$species), " species rows")
  list(
    place = id, kind = "geom", name = name,
    input = list(
      n_cells_touched = nrow(p$cells_all),
      n_cells = nrow(p$cells_sa),
      area_km2 = p$area_km2,
      study_area_pct = if (nrow(p$cells_all)) nrow(p$cells_sa) / nrow(p$cells_all) * 100 else 0,
      components = score_rows(p$scores),
      species = species_columnar(p$species)),
    expected = list(
      composite = composite,
      n_species = dplyr::n_distinct(p$species$mdl_key),
      counts = if (nrow(p$species)) species_counts(p$species) else NULL,
      top20 = species_top20(p$species),
      full_order = as.character(p$species$mdl_key)))
}

build_version <- function(ver) {
  message("== ", ver)
  boot <- boot_of(ver)
  grid <- grid_of(boot)
  con  <- open_release(ver)
  on.exit(DBI::dbDisconnect(con, shutdown = TRUE), add = TRUE)
  out  <- file.path(OUT_DIR, ver)

  meta <- list(ver = ver, msens = MSENS_VERSION, grid_id = grid$grid_id,
               id_field = boot$id_field, boot_built_at = boot$built_at,
               generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"))

  z <- build_zone_fixture(ver, con, boot, grid)
  write_json_file(c(meta, z), file.path(out, "report_gaa.json"))

  g <- build_custom_fixture(ver, con, grid, "gulf_rectangle", "Gulf rectangle")
  write_json_file(c(meta, g), file.path(out, "report_gulf_rectangle.json"))

  a <- build_custom_fixture(ver, con, grid, "aleutian_dateline", "Aleutian box")
  write_json_file(c(meta, a), file.path(out, "report_aleutian_dateline.json"))
  invisible(NULL)
}

for (v in VERS) build_version(v)
message("done -> ", OUT_DIR)
