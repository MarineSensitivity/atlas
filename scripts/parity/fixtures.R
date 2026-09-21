# scripts/parity/fixtures.R -- the R side of the atlas-2 parity gate.
#
# Writes tests/fixtures/parity/{v7,v9}/*.json: what msens answers, so `scripts/parity/run.mjs` can
# assert the `sql/*.sql` twins answer the same thing. R is the reference here and the .sql files are
# the port under test, which is why NOTHING in this file reads them.
#
# READ-ONLY, ALWAYS. msens is loaded with devtools::load_all() from the atlas-contract WORKTREE
# (never installed into the system R library, which the v7.1 release session depends on), and every
# DuckDB is opened read_only. Nothing is published and no S3 object is written.
#
# Usage:
#   Rscript scripts/parity/fixtures.R [v9 v7]
# Environment:
#   MSENS_DIR      the msens worktree to load_all()           (default: the atlas-contract worktree)
#   DERIVED_DIR    holds {ver}/sdm.duckdb                     (default: ~/_big/msens/derived)
#   BUNDLE_DIR     holds {ver}/boot.json (the app bundles)    (default: the atlas-contract dry runs)
#   OUT_DIR        where the fixtures land                    (default: tests/fixtures/parity)

suppressPackageStartupMessages({
  library(DBI); library(duckdb); library(jsonlite); library(tibble); library(dplyr)
})

`%||%` <- function(a, b) if (is.null(a)) b else a

# the repo root: wherever `sql/` and `tests/fixtures/places/` live. Rscript is normally run from
# there; ATLAS_ROOT overrides for a caller that is not.
ROOT <- normalizePath(Sys.getenv("ATLAS_ROOT", getwd()))
stopifnot("run from the atlas repo root (or set ATLAS_ROOT)" = dir.exists(file.path(ROOT, "sql")))
# msens lives in the `atlas-contract` WORKTREE, which is a sibling of this checkout when the app is
# itself being worked on in a worktree -- try both shapes before giving up.
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
OUT_DIR     <- Sys.getenv("OUT_DIR",     file.path(ROOT, "tests/fixtures/parity"))
VERS        <- commandArgs(trailingOnly = TRUE)
if (!length(VERS)) VERS <- c("v9", "v7")

message("msens:   ", MSENS_DIR)
suppressMessages(devtools::load_all(MSENS_DIR, quiet = TRUE))
MSENS_VERSION <- as.character(utils::packageVersion("msens"))
message("loaded msens ", MSENS_VERSION)

# ---- the release, as the browser sees it ------------------------------------------------------

# Where the local `cell_model` partitions live. v9's are also on the public bucket; v7's exist only
# here (atlas-1 fact: 757 MB / 428 tiles, never pushed).
cell_model_dir <- function(ver) {
  for (p in c(file.path(DERIVED_DIR, ver, "cell_model"),
              file.path(DERIVED_DIR, ver, "marine-atlas/serve/cell_model")))
    if (dir.exists(p)) return(p)
  NA_character_
}

# An in-memory catalog of VIEWS over the read-only release, plus `cell_model` over the local
# Parquet tiles. This is deliberately the shape a served release has, so msens takes the SAME code
# path the browser's SQL ports: .species_sql() prefers `cell_model` when the table exists
# (calc.R:443) and prunes by tile, instead of scanning model_cell's ~580M rows by mdl_id.
open_release <- function(ver) {
  path <- file.path(DERIVED_DIR, ver, "sdm.duckdb")
  stopifnot("release database not found" = file.exists(path))
  con <- DBI::dbConnect(duckdb::duckdb())                    # in-memory catalog
  DBI::dbExecute(con, sprintf("ATTACH '%s' AS rel (READ_ONLY)", path))
  tabs <- DBI::dbGetQuery(con, "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'rel'")$table_name
  for (t in tabs) DBI::dbExecute(con, sprintf('CREATE VIEW "%s" AS SELECT * FROM rel."%s"', t, t))
  cm <- cell_model_dir(ver)
  if (!is.na(cm))
    DBI::dbExecute(con, sprintf(
      "CREATE VIEW cell_model AS SELECT * FROM read_parquet('%s/tile=*/*.parquet', hive_partitioning = 1)", cm))
  # `zone_taxon` comes from the PUBLISHED BUNDLE, not from the release database. The browser can
  # only read `app/zone_taxon.parquet`, and that object is not bit-identical to the `zone_taxon`
  # table it was built from: 17 of v7's 3,077 `subregion_key = AK` rows differ from the release by
  # ONE ULP of `area_km2` (2,899,477.2579655861 published vs ...5843 in the database, 1.9e-9 apart),
  # which is over this gate's own 1e-9 tolerance. Comparing the app's SQL against a number the app
  # can never see would be measuring the publish step, not the port -- and `.zone_taxon_normalize()`
  # is idempotent over an already-normalized table, so msens reads it exactly as it reads its own.
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

# ---- the quantities the gate compares ---------------------------------------------------------

# Only the columns the gate asserts on, so a fixture stays a few hundred KB rather than a few MB.
# `mdl_key` is the join key the harness diffs row for row; area_km2 / avg_suit / pct_cat are three
# of the gate's four quantities (the fourth, `score`, comes from the scores fixtures).
species_cols <- function(d)
  tibble::tibble(
    mdl_key       = as.character(d$mdl_key),
    sp_cat        = as.character(d$sp_cat),
    sp_scientific = as.character(d$sp_scientific),
    area_km2      = as.numeric(d$area_km2),
    avg_suit      = as.numeric(d$avg_suit),
    pct_cat       = as.numeric(d$pct_cat))

score_cols <- function(d)
  tibble::tibble(
    metric_key         = as.character(d$metric_key),
    component          = as.character(d$component),
    score              = as.numeric(d$score),
    coverage           = as.numeric(d$coverage),
    mean_where_present = as.numeric(d$mean_where_present))

# `digits = I(17)`, NOT `digits = NA`: NA writes 15 significant digits, so a Program-Area-sized
# `area_km2` (3,832,315.832284535) is truncated to 3832315.83228453 and comes back 5.1e-9 away from
# the double R computed -- which is over the gate's own 1e-9 tolerance before any SQL has run. 17
# significant digits is the shortest form that round-trips an IEEE754 double exactly.
write_json_file <- function(x, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  writeLines(jsonlite::toJSON(x, auto_unbox = TRUE, digits = I(17), na = "null", null = "null"), path)
  message("  wrote ", sub(paste0(OUT_DIR, "/"), "", path, fixed = TRUE),
          " (", format(file.size(path), big.mark = ","), " B)")
}

# ---- per version ------------------------------------------------------------------------------

# Three zones, one per zone FIELD where the release has three (v9: programarea / ecoregion /
# subregion; v7 publishes only programarea, so it falls back to three Program Areas). Within a
# field the zone whose species count is nearest TARGET_ZONE_ROWS is taken, NOT the biggest: these
# fixtures are committed, and `subregion_key = USA` alone is 17,120 species and a 6 MB JSON file.
# The choice is deterministic (a distance, then an alphabetical tie-break), never sampled.
TARGET_ZONE_ROWS <- 600L

zone_choices <- function(con) {
  d <- DBI::dbGetQuery(con, "SELECT zone_fld, zone_value, count(*) AS n FROM zone_taxon GROUP BY 1,2 ORDER BY 1,2")
  nearest <- function(s) s[order(abs(s$n - TARGET_ZONE_ROWS), s$zone_value), ][1, ]
  pick <- do.call(rbind, lapply(split(d, d$zone_fld), nearest))
  pick <- pick[order(pick$zone_fld), , drop = FALSE]
  if (nrow(pick) < 3) {
    rest <- d[!paste(d$zone_fld, d$zone_value) %in% paste(pick$zone_fld, pick$zone_value), , drop = FALSE]
    rest <- rest[order(abs(rest$n - TARGET_ZONE_ROWS), rest$zone_fld, rest$zone_value), , drop = FALSE]
    pick <- rbind(pick, utils::head(rest, 3 - nrow(pick)))
  }
  utils::head(pick, 3)
}

cell_choices <- function(con, n = 5) {
  # Five cells that carry BOTH a cell_model row (so species_for_cells answers) and a cell_metric row
  # (so the click-popup fixture is not five empty lists -- the first cut picked v7 cells with models
  # but no metrics and wrote a 169-byte cell_components.json that asserted nothing). One per tile,
  # so the fixture exercises more than one partition; deterministic (ordered), never sampled.
  # A COMPONENT metric, not just any metric: v7 cell 990 carries extrisk_bird / _invertebrate /
  # _mammal / _other but no `_ecoregion_rescaled` row at all, so the first cut's five picks all
  # scored nothing and cell_components.json was 169 bytes of empty lists.
  vc <- sdm_val_col(con, "cell_metric")
  cand <- DBI::dbGetQuery(con, glue::glue(
    "SELECT cell_id FROM (
       SELECT cell_id, row_number() OVER (PARTITION BY tile ORDER BY cell_id) AS rn
         FROM (SELECT DISTINCT cm.cell_id, cm.tile FROM cell_model cm
                WHERE cm.cell_id IN (
                  SELECT x.cell_id FROM cell_metric x JOIN metric m USING (metric_seq)
                   WHERE x.{vc} IS NOT NULL
                     AND regexp_matches(m.metric_key, '_ecoregion_rescaled$')))
     ) WHERE rn = 1 ORDER BY cell_id"))$cell_id
  stopifnot("no cell carries both a model and a component metric" = length(cand) > 0)
  # evenly spaced through the candidate list rather than its first five, so the fixture spans the
  # release's whole latitude range instead of five neighbouring Arctic tiles
  cand[unique(round(seq(1, length(cand), length.out = min(n, length(cand)))))]
}

PLACE_FIXTURES <- c("gulf_rectangle", "polygon_hole", "programarea_gaa")

# EVERY ANALYSIS RUNS ON decode(encode(geometry)) (master-plan D8), so the reference must too.
# `place_encode()` normalizes (unwrap_polygon) and then encodes, exactly as a TypeScript caller goes
# normalizeForAnalysis() -> encodeGeometry(); `place_decode()` brings back the quantized ring
# (10^-3 degrees, or 10^-4 for a place under half a degree). Skipping it is not a rounding detail:
# on the 63,417-vertex GAA outline the raw and the quantized rings give edge cells different
# `pct_covered`, and the first cut of this gate was 2.0e-3 off on `score` for that one fixture --
# R analysing a polygon no shared link can carry.
analysis_geometry <- function(g)
  place_decode(place_encode(list(kind = "geom", name = "p", geometry = g)))[[1]]$geometry

build_version <- function(ver) {
  message("== ", ver)
  boot <- boot_of(ver)
  grid <- grid_of(boot)
  con  <- open_release(ver)
  on.exit(DBI::dbDisconnect(con, shutdown = TRUE), add = TRUE)
  out  <- file.path(OUT_DIR, ver)

  write_json_file(list(
    ver = ver, msens = MSENS_VERSION, grid_id = grid$grid_id, id_field = boot$id_field,
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    note = paste("R reference for the atlas-2 parity gate; scripts/parity/run.mjs asserts the",
                 "sql/*.sql twins reproduce it. Regenerate with scripts/parity/fixtures.R.")),
    file.path(out, "meta.json"))

  # --- species for 3 zones (the precomputed zone_taxon path)
  zc <- zone_choices(con)
  zones <- lapply(seq_len(nrow(zc)), function(i) {
    d <- species_for_zone(con, zc$zone_fld[i], zc$zone_value[i])
    message("  zone ", zc$zone_fld[i], "=", zc$zone_value[i], ": ", nrow(d), " rows")
    list(zone_fld = zc$zone_fld[i], zone_value = zc$zone_value[i], n = nrow(d), rows = species_cols(d))
  })
  write_json_file(zones, file.path(out, "species_zone.json"))

  # --- species for 5 single cells (the live cell_model path, incl. the id_field join)
  cids <- cell_choices(con)
  cells <- lapply(cids, function(id) {
    d <- species_for_cells(con, tibble::tibble(cell_id = as.integer(id), pct_covered = 100))
    message("  cell ", id, ": ", nrow(d), " species")
    list(cell_id = as.integer(id), n = nrow(d), rows = species_cols(d))
  })
  write_json_file(cells, file.path(out, "species_cell.json"))

  # --- the same five cells as the click popup sees them (single-cell scores_for_cells)
  comps <- lapply(cids, function(id) {
    d <- scores_for_cells(con, tibble::tibble(cell_id = as.integer(id), pct_covered = 100))
    list(cell_id = as.integer(id), n = nrow(d), rows = score_cols(d))
  })
  write_json_file(comps, file.path(out, "cell_components.json"))

  # --- scores for 3 polygon fixtures, on THIS release's grid
  scores <- lapply(PLACE_FIXTURES, function(id) {
    fx <- place_fixture(file.path(ROOT, "tests/fixtures/places", paste0(id, ".json")))
    cl <- cells_in_polygon_grid(analysis_geometry(fx$geometry), grid)
    sa <- cells_in_study_area(con, cl)
    d  <- scores_for_cells(con, cl, blend = TRUE, denominator = "study_area")
    message("  place ", id, ": ", nrow(cl), " cells, ", nrow(sa), " in study area, ",
            nrow(d), " components")
    list(fixture = id, n_cells = nrow(cl), n_cells_sa = nrow(sa),
         w_all = sum(sa$pct_covered), composite = if (nrow(d)) mean_score(d) else NA_real_,
         n = nrow(d), rows = score_cols(d))
  })
  write_json_file(scores, file.path(out, "scores.json"))

  # --- composition: the taxonomy join for the treemap, on the first zone
  tx <- arrow_taxonomy(ver)
  cmp <- {
    d <- species_for_zone(con, zc$zone_fld[1], zc$zone_value[1])
    j <- dplyr::left_join(
      dplyr::mutate(d, taxon_id = sub("\\.0$", "", as.character(.data$taxon_id))),
      tx, by = "taxon_id")
    list(zone_fld = zc$zone_fld[1], zone_value = zc$zone_value[1], n = nrow(j),
         rows = tibble::tibble(
           mdl_key      = as.character(j$mdl_key),
           sp_cat       = as.character(j$sp_cat),
           kingdom      = ifelse(is.na(j$Kingdom), "unknown", as.character(j$Kingdom)),
           phylum       = ifelse(is.na(j$Phylum),  "unknown", as.character(j$Phylum)),
           class        = ifelse(is.na(j$Class),   "unknown", as.character(j$Class)),
           suit_er_area = as.numeric(j$suit_er_area)))
  }
  write_json_file(cmp, file.path(out, "composition.json"))

  # --- the Program-Area tracing cases
  write_json_file(tracing(con, ver, grid), file.path(out, "tracing.json"))
  invisible(NULL)
}

# `taxonomy.parquet` is read straight from the bundle: it is the published object the browser joins,
# and there is no msens function that returns it for a release.
arrow_taxonomy <- function(ver) {
  p <- file.path(BUNDLE_DIR, ver, "taxonomy.parquet")
  con <- DBI::dbConnect(duckdb::duckdb())
  on.exit(DBI::dbDisconnect(con, shutdown = TRUE), add = TRUE)
  tibble::as_tibble(DBI::dbGetQuery(con, sprintf(
    'SELECT CAST(taxon_id AS VARCHAR) AS taxon_id, "Kingdom", "Phylum", "Class" FROM read_parquet(%s)',
    DBI::dbQuoteString(con, p))))
}

# THE PROGRAM-AREA TRACING GATE (atlas-1's gate correction, inherited by atlas-2).
#
#   POSITIVE, on the release whose Program-Area vintage matches the fixture (v9): the GAA outline
#   traced with cells_in_polygon_grid() reproduces GAA's published zone_metric within 0.5 per
#   component. On v7 the fixture is v9's vintage (14,238 vs 14,256 published cells), so the traced
#   case is recorded but NOT asserted -- atlas-1 skipped it there for the same reason.
#
#   NEGATIVE, the RED side: GEO, never GAA. GAA is 99.1-99.9 % covered and the old unblended
#   formula misses it by only 0.1551, well inside 0.5 -- it cannot discriminate. GEO's turtle
#   component covers 1.41 % of the area, and the old formula misses it by 49.1448 on v9 / 58.9534 on
#   v7. `mean_where_present` IS the old formula (calc.R:328's `num_present / w_present`), so the
#   harness needs no second query: it reads that column off the SAME blended result.
tracing <- function(con, ver, grid) {
  published <- function(key) {
    vz <- sdm_val_col(con, "zone"); vm <- sdm_val_col(con, "zone_metric")
    d <- DBI::dbGetQuery(con, glue::glue(
      "SELECT m.metric_key, zm.{vm} AS score
         FROM zone z JOIN zone_metric zm USING (zone_seq) JOIN metric m USING (metric_seq)
        WHERE z.fld = 'programarea_key' AND z.{vz} = {DBI::dbQuoteString(con, key)}
          AND regexp_matches(m.metric_key, '_ecoregion_rescaled$')
        ORDER BY m.metric_key"))
    d[!grepl("_all_", d$metric_key), , drop = FALSE]
  }

  fx  <- place_fixture(file.path(ROOT, "tests/fixtures/places/programarea_gaa.json"))
  gaa_cells <- cells_in_polygon_grid(analysis_geometry(fx$geometry), grid)
  gaa <- scores_for_cells(con, gaa_cells, blend = TRUE, denominator = "study_area")
  gaa_pub <- published("GAA")
  m <- merge(score_cols(gaa), gaa_pub, by = "metric_key", suffixes = c("", "_pub"))
  message("  GAA traced: ", nrow(gaa_cells), " cells, max|d| vs published ",
          signif(max(abs(m$score - m$score_pub)), 6))

  geo_cells <- cells_in_pra(con, "GEO")
  geo <- scores_for_cells(con, geo_cells, blend = TRUE, denominator = "study_area")
  geo_pub <- published("GEO")
  g <- merge(score_cols(geo), geo_pub, by = "metric_key", suffixes = c("", "_pub"))
  g$delta_old <- abs(g$mean_where_present - g$score_pub)
  message("  GEO: ", nrow(geo_cells), " cells, blended max|d| ",
          signif(max(abs(g$score - g$score_pub)), 6),
          "; OLD formula max|d| ", signif(max(g$delta_old), 6),
          " on ", g$metric_key[which.max(g$delta_old)])

  list(
    gaa = list(fixture = "programarea_gaa", zone_value = "GAA", assert_within = 0.5,
               # the outline fixture is a v9-vintage Program Area; only assert it there
               assert = identical(ver, "v9"),
               n_cells = nrow(gaa_cells),
               rows = score_cols(gaa), published = tibble::as_tibble(gaa_pub),
               max_abs_delta = max(abs(m$score - m$score_pub))),
    geo = list(zone_value = "GEO", n_cells = nrow(geo_cells),
               cell_id = as.integer(geo_cells$cell_id),
               pct_covered = as.numeric(geo_cells$pct_covered),
               rows = score_cols(geo), published = tibble::as_tibble(geo_pub),
               blend_max_abs_delta = max(abs(g$score - g$score_pub)),
               old_formula_worst_metric = g$metric_key[which.max(g$delta_old)],
               old_formula_max_abs_delta = max(g$delta_old)))
}

for (v in VERS) build_version(v)
message("done -> ", OUT_DIR)
