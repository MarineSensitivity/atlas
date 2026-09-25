-- cell_histogram.sql  --  every finite value of ONE caller-chosen column, over whatever tiles are
-- currently mounted in the `cell` view.
--
-- Ben's ask (round-3 review, 2026-09-25): "a sparkline style histogram showing the range of values
-- ... in the popup" for the scores lens' Raster-cells branch. Binning itself happens in JS
-- (`lib/map/density.ts#binValues`, the SAME binner every distribution source shares) -- this
-- template's only job is to hand back the raw finite values for the layer on screen, which is
-- cheap: the `cell` view already holds only whatever tiles a click/place analysis mounted
-- (`AnalysisSources#cellTiles`), never re-fetched here. `{{cols}}` is the ident()-validated single
-- column reference (sql.ts's RAW_ALLOWLIST), same convention as cell_value.sql beside it.
--
-- Numbers never come from the tile server (master-plan D4): read from the wide `cell` Parquet tile,
-- never a sampled COG pixel.
SELECT {{cols}} AS val
  FROM cell
 WHERE {{cols}} IS NOT NULL
