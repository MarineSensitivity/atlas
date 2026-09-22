// Shared boot.json-shaped fixture for the scores lens' tests — trimmed from the real v7 bundle
// (`.claude/worktrees/contract/workflows/_output/app_bundle/v7/boot.json`, orchestrator-verified
// 2026-09-22), so these tests exercise the SHAPE atlas-1 actually publishes rather than an
// idealized one.
export const BOOT_V7 = {
  schema: 1,
  ver: "v7",
  id_field: "mdl_seq",
  grid: {
    grid_id: "usa05",
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 82.6,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
  study_areas: [{ key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 }],
  units: [
    {
      zone_type: "programarea",
      fld: "programarea_key",
      zone_tbl: "ply_programareas_2026_v7",
      label: "Program areas",
      pmtiles: "https://s3.example/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
      source_layer: "programarea",
      keys: ["GAA", "GEO"],
    },
  ],
  layers: [
    {
      metric_key: "primprod",
      label: "Primary productivity",
      category: "raw",
      order: 1,
      colormap: "spectral_r",
      by_subregion: {
        FULL: {
          cog: "https://s3.example/cog/usa05/primprod-full.tif",
          rescale: [35.1489, 11033.6953],
        },
      },
    },
    {
      metric_key: "extrisk_bird_ecoregion_rescaled",
      label: "Bird: ext. risk, ecoregion",
      category: "component",
      order: 10,
      colormap: "spectral_r",
      by_subregion: {
        FULL: { cog: "https://s3.example/cog/usa05/bird-erc-full.tif", rescale: [0, 100] },
      },
    },
    {
      metric_key: "extrisk_other_ecoregion_rescaled",
      label: "Other: ext. risk, ecoregion",
      category: "component",
      order: 15,
      colormap: "spectral_r",
      by_subregion: {
        FULL: { cog: "https://s3.example/cog/usa05/other-erc-full.tif", rescale: [0, 100] },
      },
    },
    {
      metric_key: "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
      label: "Overall score",
      category: "composite",
      order: 17,
      colormap: "spectral_r",
      by_subregion: {
        FULL: { cog: "https://s3.example/cog/usa05/score-full.tif", rescale: [0, 96] },
      },
    },
  ],
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America, Eastern",
        n_cells: 14256,
        area_km2: 382002.5,
        n_taxa: 5861,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 59.09,
          extrisk_other_ecoregion_rescaled: 25.54,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 33.09,
        },
      },
      {
        key: "GEO",
        name: "Georgia",
        n_cells: 8000,
        area_km2: 200000,
        n_taxa: 4000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 10,
          extrisk_other_ecoregion_rescaled: 5,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 12,
        },
      },
    ],
    subregion: [
      { key: "AK", name: "Alaska", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "FULL", name: "All US waters", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "GA", name: "Gulf of America", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "PA", name: "Pacific", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
      { key: "USA", name: "All US waters", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
    ],
  },
  flower_default: {
    FULL: [
      { component: "bird", score: 45.67 },
      { component: "other", score: 15.18 },
      { component: "primprod", score: 10.38 },
    ],
  },
  palettes: {
    spectral_r: [
      "#5E4EA1",
      "#3287BD",
      "#66C1A5",
      "#ABDDA4",
      "#E5F498",
      "#FFFFBF",
      "#FEDF8B",
      "#FDAD60",
      "#F36C43",
      "#D43E4E",
      "#9E0041",
    ],
  },
  tables: {
    taxon: { href: "https://s3.example/marine-atlas/v7/app/taxon.parquet", bytes: 1, digest: "d1" },
    zone_taxon: {
      href: "https://s3.example/marine-atlas/v7/app/zone_taxon.parquet",
      bytes: 1,
      digest: "d2",
    },
  },
};

export const BOOT_V1_PLANAREA = {
  ...BOOT_V7,
  ver: "v1",
  units: [
    {
      zone_type: "planarea",
      fld: "planarea_key",
      label: "Planning areas",
      pmtiles: "https://s3.example/marine-atlas/zones/planarea_2025-06/zones.pmtiles",
      source_layer: "planarea",
      keys: ["GAA"],
    },
  ],
  zones: {
    subregion: [
      { key: "USA", name: "All US waters", n_cells: 1, area_km2: 1, n_taxa: 1, metrics: {} },
    ],
  },
  flower_default: {},
};

export const MANIFEST_OVERLAYS_V7 = [
  {
    overlay_key: "_outside_pra",
    subregion_key: "FULL",
    cog: "https://s3.example/cog/usa05/outside-pra.tif",
    colormap: "spectral_r",
  },
];
