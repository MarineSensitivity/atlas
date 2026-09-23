-- e2e/fixtures/places-concurrency/generate.sql -- usability B1: the release e2e/places.concurrency
-- .spec.ts analyses two places against, back to back. Generated once with the duckdb CLI (the
-- e2e/fixtures/report/generate.sql convention) and checked in as binaries:
--   duckdb < e2e/fixtures/places-concurrency/generate.sql
--
-- A synthetic 48x48 grid, xmin=-125 ymax=42 resx=resy=.05, tile.size=24: four `cell` tiles
-- (0=NW, 1=NE, 2=SW, 3=SE), matching src/lib/grid/grid.ts#tileOf(). Unlike e2e/fixtures/places/
-- (every cell in_usa, one flat metric), two places here must read DIFFERENT coverage and composite
-- -- a place showing another place's numbers is the defect -- so:
--   in_usa   FALSE on columns 1-6 of tile 0 and on row 44+ of tile 3, TRUE elsewhere;
--   bird     row + col / 2 (varies everywhere);
--   fish     NULL where (row + col) % 3 = 0 (partial coverage, the D7 blend), else 100 - row.
-- The spec's places (by hand, from grid.ts's formulas):
--   A  -124.93, 41.22, -124.18, 41.87  rows 3-16, cols 2-17 (tile 0): 224 cells, 154 inside, 68.75 %
--   B  -123.62, 39.83, -122.77, 40.58  rows 29-44, cols 28-45 (tile 3): 288 cells, 270 inside, 93.75 %
--   D  -124.97, 41.50, -124.73, 41.70  rows 7-10, cols 1-6 (tile 0): no cell inside -- refused
-- Every numeric column is explicitly ::DOUBLE, as in the report fixture's own header.

.echo off

CREATE TEMP TABLE g AS
  SELECT (row_ - 1) * 48 + col_ AS cell_id,
         row_, col_,
         (row_ - 1) // 24 * 2 + (col_ - 1) // 24 AS tile,
         NOT ((col_ <= 6 AND row_ <= 24 AND col_ <= 24) OR (row_ >= 44 AND col_ >= 25)) AS in_usa,
         25.0::DOUBLE AS area_km2,
         (row_ + col_ / 2.0)::DOUBLE AS extrisk_bird_ecoregion_rescaled,
         CASE WHEN (row_ + col_) % 3 = 0 THEN NULL ELSE (100 - row_)::DOUBLE END
           AS extrisk_fish_ecoregion_rescaled
    FROM range(1, 49) t1(row_), range(1, 49) t2(col_);

COPY (SELECT cell_id, in_usa, area_km2, extrisk_bird_ecoregion_rescaled, extrisk_fish_ecoregion_rescaled
        FROM g WHERE tile = 0 ORDER BY cell_id)
  TO 'e2e/fixtures/places-concurrency/cell_tile0.parquet' (FORMAT PARQUET);
COPY (SELECT cell_id, in_usa, area_km2, extrisk_bird_ecoregion_rescaled, extrisk_fish_ecoregion_rescaled
        FROM g WHERE tile = 1 ORDER BY cell_id)
  TO 'e2e/fixtures/places-concurrency/cell_tile1.parquet' (FORMAT PARQUET);
COPY (SELECT cell_id, in_usa, area_km2, extrisk_bird_ecoregion_rescaled, extrisk_fish_ecoregion_rescaled
        FROM g WHERE tile = 2 ORDER BY cell_id)
  TO 'e2e/fixtures/places-concurrency/cell_tile2.parquet' (FORMAT PARQUET);
COPY (SELECT cell_id, in_usa, area_km2, extrisk_bird_ecoregion_rescaled, extrisk_fish_ecoregion_rescaled
        FROM g WHERE tile = 3 ORDER BY cell_id)
  TO 'e2e/fixtures/places-concurrency/cell_tile3.parquet' (FORMAT PARQUET);
