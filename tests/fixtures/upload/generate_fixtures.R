#!/usr/bin/env Rscript
# atlas-0 S4 spike — generates the five committed fixtures under spikes/4/fixtures/, in every
# format each candidate parser needs (shpjs -> zipped shapefile, @tmcw/togeojson -> KML,
# flatgeobuf -> .fgb, the hand-rolled WKT-paste parser -> .wkt), plus a .gpkg per fixture for
# part (b)'s DuckDB-WASM `spatial` extension / ST_Read test. Also writes fixtures_manifest.json:
# the ground-truth vertex counts, bboxes, ring orientation and (for the UTM case) the exact
# WGS84 reprojection, computed once here via GDAL/PROJ so the Playwright spec has something
# independent to compare parser output against. Deterministic (no randomness in the geometry or
# in fixtures_manifest.json — verified by diffing the extracted content of a re-run's .zip/.gpkg
# against a prior run, byte-identical); the raw .zip/.gpkg CONTAINER bytes themselves can still
# differ run-to-run (zip and SQLite/GeoPackage both embed a last-modified timestamp), which is
# fine — content, not container bytes, is what every test here actually checks. Geometry is
# entirely synthetic (plausible coordinates picked by hand); nothing here is real survey/coastline
# data and nothing is uploaded anywhere.
#
# usage: Rscript fixtures/generate_fixtures.R   (run from spikes/4/, or anywhere — paths below
# are relative to this script's own location)

suppressPackageStartupMessages({
  library(sf)
  library(jsonlite)
})

here <- dirname(sub("--file=", "", grep("--file=", commandArgs(trailingOnly = FALSE), value = TRUE)))
if (length(here) == 0 || here == "") here <- "."
setwd(here)

sf_use_s2(TRUE)

# a small rectangle ring in the fixed vertex order (xmin,ymin) -> (xmin,ymax) -> (xmax,ymax) ->
# (xmax,ymin) -> close. In a standard x-right/y-up plane this order is always clockwise (negative
# shoelace signed area) — kept the same across fixtures on purpose so "did this parser flip my
# ring's winding" is a clean yes/no per format, not a per-fixture coincidence.
rect_ring <- function(xmin, ymin, xmax, ymax) {
  matrix(
    c(xmin, ymin, xmin, ymax, xmax, ymax, xmax, ymin, xmin, ymin),
    ncol = 2, byrow = TRUE
  )
}

signed_area <- function(ring) {
  n <- nrow(ring)
  s <- 0
  for (i in seq_len(n - 1)) {
    s <- s + ring[i, 1] * ring[i + 1, 2] - ring[i + 1, 1] * ring[i, 2]
  }
  s / 2
}

orientation_of <- function(ring) {
  a <- signed_area(ring)
  if (a > 0) "CCW" else if (a < 0) "CW" else "N/A"
}

write_zip_shapefile <- function(sfobj, out_zip, layer_name) {
  td <- tempfile("shp_")
  dir.create(td)
  shp_path <- file.path(td, paste0(layer_name, ".shp"))
  # NOT delete_dsn=TRUE: `td` is always a fresh tempfile() dir, so there is nothing to delete yet —
  # asking GDAL to delete a dataset that does not exist is what throws the (harmless) "does not
  # appear to be a file or directory" warning seen on a first pass of this script.
  st_write(sfobj, shp_path, layer = layer_name, driver = "ESRI Shapefile", quiet = TRUE)
  parts <- list.files(td, full.names = TRUE)
  if (file.exists(out_zip)) unlink(out_zip)
  old <- setwd(td)
  on.exit(setwd(old), add = TRUE)
  system2("zip", c("-j", "-q", shQuote(file.path(old, out_zip)), basename(parts)))
}

# FIX ROUND 1, item 2: the SAME shapefile parts as write_zip_shapefile(), but with the .prj
# component dropped before zipping -- proof, on the PARSER side, that "the .prj is ignored"
# reproduces from a real file a reader would actually be handed (not just a hand-edited
# expectation). shpjs has no CRS to reproject with here, by construction.
write_zip_shapefile_no_prj <- function(sfobj, out_zip, layer_name) {
  td <- tempfile("shp_noprj_")
  dir.create(td)
  shp_path <- file.path(td, paste0(layer_name, ".shp"))
  st_write(sfobj, shp_path, layer = layer_name, driver = "ESRI Shapefile", quiet = TRUE)
  parts <- list.files(td, full.names = TRUE)
  parts <- parts[!grepl("\\.prj$", parts, ignore.case = TRUE)] # the one deliberate omission
  if (file.exists(out_zip)) unlink(out_zip)
  old <- setwd(td)
  on.exit(setwd(old), add = TRUE)
  system2("zip", c("-j", "-q", shQuote(file.path(old, out_zip)), basename(parts)))
}

write_kml <- function(sfobj, out_kml, layer_name) {
  if (file.exists(out_kml)) unlink(out_kml)
  st_write(sfobj, out_kml, layer = layer_name, driver = "KML", quiet = TRUE)
}

write_fgb <- function(sfobj, out_fgb, layer_name) {
  if (file.exists(out_fgb)) unlink(out_fgb)
  st_write(sfobj, out_fgb, layer = layer_name, driver = "FlatGeobuf", quiet = TRUE)
}

write_gpkg <- function(sfobj, out_gpkg, layer_name) {
  if (file.exists(out_gpkg)) unlink(out_gpkg)
  st_write(sfobj, out_gpkg, layer = layer_name, driver = "GPKG", quiet = TRUE)
}

write_wkt <- function(sfobj, out_wkt) {
  writeLines(st_as_text(st_geometry(sfobj)[[1]]), out_wkt)
}

manifest <- list()

## 1. gulf_rectangle — plain WGS84 rectangle, open Gulf of Mexico water, no dateline/no CRS
##    weirdness. The "everything should just work" control fixture.
{
  id <- "gulf_rectangle"
  ring <- rect_ring(-93.5, 26.5, -88.5, 29.5)
  poly <- st_sfc(st_polygon(list(ring)), crs = 4326)
  sfobj <- st_sf(id = 1, geometry = poly)

  write_zip_shapefile(sfobj, sprintf("%s.zip", id), id)
  write_kml(sfobj, sprintf("%s.kml", id), id)
  write_fgb(sfobj, sprintf("%s.fgb", id), id)
  write_gpkg(sfobj, sprintf("%s.gpkg", id), id)
  write_wkt(sfobj, sprintf("%s.wkt", id))

  manifest[[id]] <- list(
    description = "simple rectangle, open Gulf of Mexico water, EPSG:4326, no antimeridian issue",
    geometry_type = "Polygon",
    crs = "EPSG:4326",
    formats = c("zip", "kml", "fgb", "gpkg", "wkt"),
    vertex_count = nrow(ring),
    bbox = c(xmin = -93.5, ymin = 26.5, xmax = -88.5, ymax = 29.5),
    first_ring_signed_area = signed_area(ring),
    first_ring_orientation = orientation_of(ring)
  )
}

## 2. aleutian_dateline — rectangle over the Aleutians whose ring crosses the +/-180 antimeridian
##    using the standard wrapped [-180,180] coordinate range (178 -> -177), i.e. the discontinuous
##    jump a real GIS export in WGS84 actually produces. A NAIVE min/max bbox over these raw
##    coordinates is wrong (it reports ~355 degrees of width, not the true ~5 degrees) — that is
##    exactly the thing this fixture measures per parser, not a bug in the fixture.
{
  id <- "aleutian_dateline"
  ring <- rect_ring(178, 51, -177, 53)
  poly <- st_sfc(st_polygon(list(ring)), crs = 4326)
  sfobj <- st_sf(id = 1, geometry = poly)

  write_zip_shapefile(sfobj, sprintf("%s.zip", id), id)
  write_kml(sfobj, sprintf("%s.kml", id), id)
  write_fgb(sfobj, sprintf("%s.fgb", id), id)
  write_gpkg(sfobj, sprintf("%s.gpkg", id), id)
  write_wkt(sfobj, sprintf("%s.wkt", id))

  manifest[[id]] <- list(
    description = "rectangle over the Aleutians crossing the antimeridian, wrapped WGS84 coords (178 -> -177)",
    geometry_type = "Polygon",
    crs = "EPSG:4326",
    formats = c("zip", "kml", "fgb", "gpkg", "wkt"),
    vertex_count = nrow(ring),
    naive_bbox_raw_coords = c(xmin = -177, ymin = 51, xmax = 178, ymax = 53),
    naive_bbox_width_deg = 178 - (-177),
    true_bbox_width_deg = 5,
    first_ring_signed_area = signed_area(ring),
    first_ring_orientation = orientation_of(ring)
  )
}

## 3. multipolygon — two disjoint rectangles (off-shore California, purely synthetic), MultiPolygon.
{
  id <- "multipolygon"
  ringA <- rect_ring(-122.0, 36.0, -121.0, 37.0)
  ringB <- rect_ring(-120.0, 34.0, -119.0, 35.0)
  mp <- st_sfc(st_multipolygon(list(list(ringA), list(ringB))), crs = 4326)
  sfobj <- st_sf(id = 1, geometry = mp)

  write_zip_shapefile(sfobj, sprintf("%s.zip", id), id)
  write_kml(sfobj, sprintf("%s.kml", id), id)
  write_fgb(sfobj, sprintf("%s.fgb", id), id)
  write_gpkg(sfobj, sprintf("%s.gpkg", id), id)
  write_wkt(sfobj, sprintf("%s.wkt", id))

  manifest[[id]] <- list(
    description = "two disjoint rectangles as one MultiPolygon feature, EPSG:4326",
    geometry_type = "MultiPolygon",
    crs = "EPSG:4326",
    formats = c("zip", "kml", "fgb", "gpkg", "wkt"),
    vertex_count = nrow(ringA) + nrow(ringB),
    bbox = c(xmin = -122.0, ymin = 34.0, xmax = -119.0, ymax = 37.0),
    part_count = 2,
    first_ring_signed_area = signed_area(ringA),
    first_ring_orientation = orientation_of(ringA)
  )
}

## 4. utm_zone — rectangle defined directly in projected metres (EPSG:32610, UTM zone 10N,
##    plausible for the Northern California/Oregon coast), shipped ONLY as a zipped shapefile
##    (its .prj carries the CRS — this is the whole point: does the reader reproject using it?),
##    a .fgb (does the reader reproject using the header's embedded CRS? flatgeobuf CAN carry a
##    CRS but the JS reader does not reproject — see RESULTS.md), a .gpkg, and a .wkt (raw metre
##    numbers with NO crs tag at all — the "paste WKT" UX has no reprojection path by construction,
##    which is itself the measurement). No .kml: KML mandates WGS84, so a KML fixture here would
##    just be a pre-reprojected rectangle and would not exercise anything UTM-specific.
{
  id <- "utm_zone"
  utm_epsg <- 32610
  ring_utm <- rect_ring(500000, 4300000, 520000, 4320000)
  poly_utm <- st_sfc(st_polygon(list(ring_utm)), crs = utm_epsg)
  sfobj <- st_sf(id = 1, geometry = poly_utm)

  write_zip_shapefile(sfobj, sprintf("%s.zip", id), id)
  write_fgb(sfobj, sprintf("%s.fgb", id), id)
  write_gpkg(sfobj, sprintf("%s.gpkg", id), id)
  write_wkt(sfobj, sprintf("%s.wkt", id)) # raw UTM metres, on purpose — no CRS tag in plain WKT

  # fix round 1, item 2: the same shapefile with its .prj removed -- e2e/utm-noprj.fail.spec.ts
  # (test.fail()) proves shpjs is given zero CRS to reproject with, on a real file, not just a
  # rewritten expectation.
  write_zip_shapefile_no_prj(sfobj, sprintf("%s_noprj.zip", id), id)

  # ground truth: reproject the same 4 corners to WGS84 via GDAL/PROJ, once, here.
  poly_wgs84 <- st_transform(sfobj, 4326)
  ring_wgs84 <- st_coordinates(st_geometry(poly_wgs84)[[1]])[, c("X", "Y")]

  manifest[[id]] <- list(
    description = "rectangle defined directly in projected metres, EPSG:32610 (UTM zone 10N)",
    geometry_type = "Polygon",
    crs = sprintf("EPSG:%d", utm_epsg),
    formats = c("zip", "fgb", "gpkg", "wkt"),
    vertex_count = nrow(ring_utm),
    bbox_utm_metres = c(xmin = 500000, ymin = 4300000, xmax = 520000, ymax = 4320000),
    first_ring_signed_area_utm = signed_area(ring_utm),
    first_ring_orientation_utm = orientation_of(ring_utm),
    wgs84_ground_truth_ring = unname(split(ring_wgs84, row(ring_wgs84))),
    wgs84_ground_truth_bbox = c(
      xmin = min(ring_wgs84[, 1]), ymin = min(ring_wgs84[, 2]),
      xmax = max(ring_wgs84[, 1]), ymax = max(ring_wgs84[, 2])
    )
  )

  manifest[["utm_zone_noprj"]] <- list(
    description = "same rectangle as utm_zone, same shapefile parts, .prj DELIBERATELY removed before zipping",
    geometry_type = "Polygon",
    crs = "none (no .prj in the zip)",
    formats = c("zip"),
    vertex_count = nrow(ring_utm),
    bbox_utm_metres = c(xmin = 500000, ymin = 4300000, xmax = 520000, ymax = 4320000),
    wgs84_ground_truth_bbox = c(
      xmin = min(ring_wgs84[, 1]), ymin = min(ring_wgs84[, 2]),
      xmax = max(ring_wgs84[, 1]), ymax = max(ring_wgs84[, 2])
    )
  )
}

## 5. coastline_40k — synthetic wiggly LineString with exactly 40,000 vertices (deterministic
##    formula, not real coastline data) for parse-time and vertex-count measurement only; a
##    LineString has no ring, so orientation is N/A for this fixture.
{
  id <- "coastline_40k"
  n <- 40000
  i <- 0:(n - 1)
  lon <- -124 + i * 0.0005
  lat <- 40 + 0.5 * sin(i * 0.01) + 0.05 * sin(i * 0.37)
  coords <- cbind(lon, lat)
  ls <- st_sfc(st_linestring(coords), crs = 4326)
  sfobj <- st_sf(id = 1, geometry = ls)

  write_zip_shapefile(sfobj, sprintf("%s.zip", id), id)
  write_kml(sfobj, sprintf("%s.kml", id), id)
  write_fgb(sfobj, sprintf("%s.fgb", id), id)
  write_gpkg(sfobj, sprintf("%s.gpkg", id), id)
  write_wkt(sfobj, sprintf("%s.wkt", id))

  manifest[[id]] <- list(
    description = "synthetic wiggly LineString, exactly 40000 vertices, deterministic formula (not real coastline data)",
    geometry_type = "LineString",
    crs = "EPSG:4326",
    formats = c("zip", "kml", "fgb", "gpkg", "wkt"),
    vertex_count = n,
    bbox = c(xmin = min(lon), ymin = min(lat), xmax = max(lon), ymax = max(lat)),
    first_ring_orientation = "N/A"
  )
}

write_json(manifest, "fixtures_manifest.json", auto_unbox = TRUE, pretty = TRUE, digits = 12)

cat("wrote fixtures + fixtures_manifest.json for:", paste(names(manifest), collapse = ", "), "\n")

# --- seeded-fault control fixtures (Gate: correctness spec must FAIL on a deliberately wrong
# expectation) --------------------------------------------------------------------------------
# a second, deliberately-WRONG manifest: same geometry, hand-corrupted expected vertex_count and
# bbox for gulf_rectangle, and a UTM manifest entry whose wgs84 ground truth is left at the raw
# UTM metre values (i.e. "pretend .prj was ignored"). e2e/correctness.spec.ts runs the real
# assertions against fixtures_manifest.json (must PASS) and against this file (must FAIL), which
# is the committed proof that the correctness gate can actually fail.
faulty <- manifest
faulty$gulf_rectangle$vertex_count <- manifest$gulf_rectangle$vertex_count + 1L
faulty$gulf_rectangle$bbox <- manifest$gulf_rectangle$bbox
faulty$gulf_rectangle$bbox["xmax"] <- manifest$gulf_rectangle$bbox["xmax"] + 10 # deliberately wrong bbox
faulty$utm_zone$wgs84_ground_truth_bbox <- manifest$utm_zone$bbox_utm_metres # deliberately "un-reprojected": metres left as if they were degrees
names(faulty$utm_zone$wgs84_ground_truth_bbox) <- c("xmin", "ymin", "xmax", "ymax")

write_json(faulty, "fixtures_manifest.faulty.json", auto_unbox = TRUE, pretty = TRUE, digits = 12)
cat("wrote fixtures_manifest.faulty.json (seeded-fault control for the correctness gate)\n")
