-- e2e/fixtures/report/generate.sql -- fix round 1, item 2: real Parquet fixtures for
-- e2e/report.spec.ts's species + custom-place paths (a real cell_model tile is needed, unlike
-- e2e/fixtures/places/*, which only exercises scores). Generated once with the duckdb CLI (same
-- convention as e2e/fixtures/places/*.parquet's own header) and checked in as binaries:
--   duckdb < e2e/fixtures/report/generate.sql
--
-- A synthetic 48x48 grid (test05r), xmin=-125 ymax=42 resx=resy=.05, tile.size=24 -- FOUR
-- cell_model/cell partition tiles (0=NW,1=NE,2=SW,3=SE quadrant), matching
-- src/lib/grid/grid.ts#tileOf()'s formula exactly. The default coordinate box
-- e2e/places.spec.ts's addByCoordinates() already uses (-124.5, 40.0, -123.0, 41.5) sits astride
-- BOTH the lon boundary (-123.8) and the lat boundary (40.8), so a place drawn there touches all
-- four tiles -- the "4-tile custom place" gate.
--
-- Every numeric column is explicitly ::DOUBLE (a bare `50.0` literal is DuckDB's DECIMAL(3,1),
-- which the real published Parquet never is -- e2e/fixtures/places/cell_tile0.parquet's own
-- columns are DOUBLE, checked with `duckdb -c "SELECT typeof(...)"` before writing this).
--
-- Every cell: in_usa=true, area_km2=25, two components (extrisk_bird_ecoregion_rescaled=50,
-- extrisk_fish_ecoregion_rescaled=30 -- Overall = 40). cell_model carries three species (mdl_seq
-- 1-3) over two cells in EACH tile with a DIFFERENT species mix per tile, so the combined species
-- table is complete only if all four tiles' partial sums were actually combined
-- (src/lib/analysis/combine.ts) -- the point of the "4-tile" gate.

.echo off

-- ---- cell, one file per tile (0=NW,1=NE,2=SW,3=SE) ----------------------------------------------
COPY (
  SELECT (row_ - 1) * 48 + col_ AS cell_id, true AS in_usa, 25.0::DOUBLE AS area_km2,
         50.0::DOUBLE AS extrisk_bird_ecoregion_rescaled,
         30.0::DOUBLE AS extrisk_fish_ecoregion_rescaled
    FROM range(1, 25) t1(row_), range(1, 25) t2(col_)
) TO 'e2e/fixtures/report/cell_tile0.parquet' (FORMAT PARQUET);

COPY (
  SELECT (row_ - 1) * 48 + col_ AS cell_id, true AS in_usa, 25.0::DOUBLE AS area_km2,
         50.0::DOUBLE AS extrisk_bird_ecoregion_rescaled,
         30.0::DOUBLE AS extrisk_fish_ecoregion_rescaled
    FROM range(1, 25) t1(row_), range(25, 49) t2(col_)
) TO 'e2e/fixtures/report/cell_tile1.parquet' (FORMAT PARQUET);

COPY (
  SELECT (row_ - 1) * 48 + col_ AS cell_id, true AS in_usa, 25.0::DOUBLE AS area_km2,
         50.0::DOUBLE AS extrisk_bird_ecoregion_rescaled,
         30.0::DOUBLE AS extrisk_fish_ecoregion_rescaled
    FROM range(25, 49) t1(row_), range(1, 25) t2(col_)
) TO 'e2e/fixtures/report/cell_tile2.parquet' (FORMAT PARQUET);

COPY (
  SELECT (row_ - 1) * 48 + col_ AS cell_id, true AS in_usa, 25.0::DOUBLE AS area_km2,
         50.0::DOUBLE AS extrisk_bird_ecoregion_rescaled,
         30.0::DOUBLE AS extrisk_fish_ecoregion_rescaled
    FROM range(25, 49) t1(row_), range(25, 49) t2(col_)
) TO 'e2e/fixtures/report/cell_tile3.parquet' (FORMAT PARQUET);

-- two cells per tile, WITHIN the default coordinate box (-124.5, 40.0, -123.0, 41.5) -- verified
-- against grid.ts's cellFromLonLat()/tileOf() formulas by hand. Different species per tile (bird
-- "1" in tiles 0+2, fish "2" in tiles 0+1, bird "3" in tiles 1+3).
COPY (
  SELECT cell_id, mdl_seq, val::DOUBLE AS val FROM (
    VALUES (687, 1, 60.0), (687, 2, 40.0),
           (736, 1, 55.0), (736, 2, 35.0)
  ) AS t(cell_id, mdl_seq, val)
) TO 'e2e/fixtures/report/cell_model_tile0.parquet' (FORMAT PARQUET);

COPY (
  SELECT cell_id, mdl_seq, val::DOUBLE AS val FROM (
    VALUES (702, 2, 45.0), (702, 3, 20.0),
           (751, 2, 42.0), (751, 3, 18.0)
  ) AS t(cell_id, mdl_seq, val)
) TO 'e2e/fixtures/report/cell_model_tile1.parquet' (FORMAT PARQUET);

COPY (
  SELECT cell_id, mdl_seq, val::DOUBLE AS val FROM (
    VALUES (1407, 1, 58.0),
           (1456, 1, 52.0)
  ) AS t(cell_id, mdl_seq, val)
) TO 'e2e/fixtures/report/cell_model_tile2.parquet' (FORMAT PARQUET);

COPY (
  SELECT cell_id, mdl_seq, val::DOUBLE AS val FROM (
    VALUES (1422, 3, 30.0),
           (1471, 3, 28.0)
  ) AS t(cell_id, mdl_seq, val)
) TO 'e2e/fixtures/report/cell_model_tile3.parquet' (FORMAT PARQUET);

-- ---- taxon: three species, keyed by mdl_seq as a VARCHAR (v7's cell_model_seq.sql branch) ------
COPY (
  SELECT key, sp_cat, common, sci, taxon_id, taxon_authority, er_code, er_score::DOUBLE AS er_score,
         is_mmpa, is_mbta, valid_usa
    FROM (
      VALUES
        ('1', 'bird', 'Marbled Murrelet',  'Brachyramphus marmoratus', 't1', 'FWS',  'FWS:TN',  50.0, true,  true,  true),
        ('2', 'fish', 'Pacific Herring',   'Clupea pallasii',          't2', 'IUCN', 'IUCN:LC',  1.0, false, false, true),
        ('3', 'bird', 'Ashy Storm-Petrel', 'Hydrobates homochroa',     't3', 'IUCN', 'IUCN:EN', 25.0, false, true,  true)
    ) AS t(key, sp_cat, common, sci, taxon_id, taxon_authority, er_code, er_score, is_mmpa, is_mbta, valid_usa)
) TO 'e2e/fixtures/report/taxon.parquet' (FORMAT PARQUET);

-- ---- zone_taxon: two Program Areas (GAA, ALA), a handful of species each, er_score a 0-1
-- fraction (species_for_zone.sql's own contract) --------------------------------------------------
-- V5 fix (Opus eyes-on, phone-15/desktop-14): GAA's five ADDED rows below (NMFS:EN/FWS:LC/
-- IUCN:EN/IUCN:VU/IUCN:NT) give it all 8 `ER_CAT_ORDER` categories (report/er.ts) beside its
-- original three (USA:TN/IUCN:CR/other), so e2e/report.spec.ts's scroll-affordance test gets a
-- REAL 10-column (8 ER + Category + Total) species counts table -- exactly the shape wide enough
-- to overflow a 390px report, the same way a real release's counts table did. ALA/Z3..Z20 are
-- untouched (other tests key on ALA's exact two rows).
COPY (
  SELECT zone_fld, zone_value, sp_cat, sp_common, sp_scientific, taxon_id, taxon_authority,
         er_code, er_score::DOUBLE AS er_score, is_mmpa, is_mbta, mdl_key,
         area_km2::DOUBLE AS area_km2, avg_suit::DOUBLE AS avg_suit
    FROM (
      VALUES
        ('programarea_key', 'GAA', 'bird',   'Marbled Murrelet',   'Brachyramphus marmoratus', 't1',  'FWS',  'FWS:TN',   0.50, true,  true,  'z1', 1200.0, 0.6),
        ('programarea_key', 'GAA', 'fish',   'Pacific Herring',    'Clupea pallasii',          't2',  'IUCN', 'IUCN:LC',  0.01, false, false, 'z2',  800.0, 0.3),
        ('programarea_key', 'GAA', 'coral',  'Elkhorn Coral',      'Acropora palmata',         't3',  'IUCN', 'IUCN:CR',  0.50, false, false, 'z3',  400.0, 0.2),
        ('programarea_key', 'GAA', 'turtle', 'Leatherback Turtle', 'Dermochelys coriacea',     't6',  'NMFS', 'NMFS:EN',  1.00, false, false, 'z6',  700.0, 0.5),
        ('programarea_key', 'GAA', 'mammal', 'Harbor Seal',        'Phoca vitulina',           't7',  'FWS',  'FWS:LC',   0.01, true,  false, 'z7',  500.0, 0.4),
        ('programarea_key', 'GAA', 'bird',   'Short-tailed Albatross', 'Phoebastria albatrus', 't8',  'IUCN', 'IUCN:EN',  0.25, false, true,  'z8',  350.0, 0.3),
        ('programarea_key', 'GAA', 'fish',   'Nassau Grouper',     'Epinephelus striatus',     't9',  'IUCN', 'IUCN:VU',  0.05, false, false, 'z9',  450.0, 0.35),
        ('programarea_key', 'GAA', 'invertebrate', 'Queen Conch',  'Aliger gigas',             't10', 'IUCN', 'IUCN:NT',  0.02, false, false, 'z10', 300.0, 0.25),
        ('programarea_key', 'ALA', 'bird',  'Ashy Storm-Petrel', 'Hydrobates homochroa',     't4', 'IUCN', 'IUCN:EN', 0.25, false, true,  'z4',  900.0, 0.5),
        ('programarea_key', 'ALA', 'mammal','Steller Sea Lion',  'Eumetopias jubatus',       't5', 'FWS',  'FWS:LC',  0.01, true,  false, 'z5',  600.0, 0.4)
    ) AS t(zone_fld, zone_value, sp_cat, sp_common, sp_scientific, taxon_id, taxon_authority,
           er_code, er_score, is_mmpa, is_mbta, mdl_key, area_km2, avg_suit)
) TO 'e2e/fixtures/report/zone_taxon.parquet' (FORMAT PARQUET);

-- ---- taxonomy: unused by any twin this suite runs -- a minimal, loadable placeholder -----------
COPY (SELECT 1 AS taxonomy_id) TO 'e2e/fixtures/report/taxonomy.parquet' (FORMAT PARQUET);
