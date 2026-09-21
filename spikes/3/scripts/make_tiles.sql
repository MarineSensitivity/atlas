-- spikes/3: build 4 local tiles of v9 cell_metric for the S3 spike (candidate (a) fixture).
--
-- Tiles the same way `serve/cell_model/tile={t}/data_0.parquet` is already tiled on S3 (atlas-1
-- will publish `cell_metric` the same way; this script is the stand-in for that publish step).
-- Key formula (2026-09-20 atlas app plan.md, S3): tile = ((cell_id-1)//nc)//50 * (nc//50) +
-- ((cell_id-1)%nc)//50, with nc = 7200 (v9 manifest grid.nc, global05).
--
-- Tile set: r in {24,25} x c in {36,37} -> tiles 3492, 3493, 3636, 3637. That 2x2 block of 2.5deg
-- tiles covers lon [-90,-85] x lat [25,30] (Gulf of America / GA subregion, all 4 quadrants have
-- scored cells for all 8 metrics below -- verified before picking this block; the adjacent
-- lat[22.5,27.5] block has an entirely-unscored NW quadrant) and contains all three test
-- geometries the spike measures (clicked cell, 2x2deg polygon, Program-Area-sized polygon -- see
-- spikes/3/RESULTS.md for why that 5x5deg box stands in for a Program Area).
--
-- metric_seq IN (10,13,16,19,22,25,28,32) = the 8 "*_ecoregion_rescaled" components (7 extrisk
-- taxa + primprod) -- the flower's 7-8 petals (plan Ground truth, S2 gate) -- confirmed against
-- v9/tables/metric.parquet.
--
-- Run: duckdb < spikes/3/scripts/make_tiles.sql   (from repo root; writes spikes/3/tiles/, gitignored)

INSTALL httpfs;
LOAD httpfs;

COPY (
  WITH tiled AS (
    SELECT
      cell_id,
      metric_seq,
      val,
      ( ((cell_id - 1) // 7200) // 50 ) * (7200 // 50)
        + ( ((cell_id - 1) % 7200) // 50 ) AS tile
    FROM read_parquet('https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/cell_metric.parquet')
    WHERE metric_seq IN (10, 13, 16, 19, 22, 25, 28, 32)
  )
  SELECT cell_id, metric_seq, val, tile
  FROM tiled
  WHERE tile IN (3492, 3493, 3636, 3637)
)
TO 'spikes/3/tiles/app/cell'
(FORMAT PARQUET, PARTITION_BY (tile), OVERWRITE_OR_IGNORE true);
