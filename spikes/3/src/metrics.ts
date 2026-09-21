// atlas-0 S3 spike: the 8 "rescaled component" metrics -- the flower's 7-8 petals (plan Ground
// truth, S2 gate: "the flower has 7-8 petals"). Confirmed against v9/tables/metric.parquet
// (metric_seq for `%_ecoregion_rescaled`, excluding the `_min`/`_max`/`_prepctareaweighting`
// siblings and the composite score) and v9/manifest.json `metrics[]` (subregion_key="FULL" cog +
// rescale). Hardcoded here (a spike does not re-derive the manifest at runtime) -- see
// spikes/3/RESULTS.md for the exact commands used to read them.
export interface RescaledMetric {
  metricSeq: number;
  metricKey: string;
  cog: string;
  rescaleMin: number;
  rescaleMax: number;
}

const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas";

export const RESCALED_METRICS: RescaledMetric[] = [
  { metricSeq: 10, metricKey: "extrisk_bird_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/a8a3f43d9bf7fc20.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 13, metricKey: "extrisk_coral_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/c2125eda225300d8.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 16, metricKey: "extrisk_fish_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/d3cd2ae7ca205666.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 19, metricKey: "extrisk_invertebrate_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/6db3f2ab36d65b06.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 22, metricKey: "extrisk_mammal_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/0ad39c32a3fe8c74.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 25, metricKey: "extrisk_primary_producer_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/ca4bf641209e3de3.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 28, metricKey: "extrisk_turtle_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/756fc54abb83308c.tif`, rescaleMin: 0, rescaleMax: 100 },
  { metricSeq: 32, metricKey: "primprod_ecoregion_rescaled", cog: `${BUCKET}/cog/global05/a507b19a3bf12a24.tif`, rescaleMin: 0, rescaleMax: 100 },
];

export const RESCALED_METRIC_SEQS = RESCALED_METRICS.map((m) => m.metricSeq);

// the single COG used by the display question (deck.gl BitmapLayer vs titiler tiles).
export const DISPLAY_METRIC = RESCALED_METRICS[0]; // extrisk_bird_ecoregion_rescaled
