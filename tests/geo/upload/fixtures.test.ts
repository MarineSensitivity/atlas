// The five S4 fixtures, end to end, in every format each one ships in, on BOTH grids — the
// subplan's own gate:
//
//   "The five S4 fixtures produce their expected cell sets on both grids; the projected-UTM
//    shapefile lands in the Gulf [of the Farallones] (the regression where a Santa Barbara polygon
//    resolved to Arctic cells and returned zero species silently, msens/R/calc.R:1-13): assert cell
//    latitudes, not just non-empty."
//
// So every case below asserts a cell COUNT and a latitude/longitude band. A count alone cannot tell
// a rectangle off California from the same rectangle in the Arctic — they have the same number of
// cells. The band can, and it is the assertion the regression is named after.
import { describe, expect, it } from "vitest";
import { cellsInPolygon } from "../../../src/lib/geo/coverage";
import { cellLonLat, type GridSpec } from "../../../src/lib/grid/grid";
import { normalizeUpload, type NormalizeResult } from "../../../src/lib/geo/upload/normalize";
import type { AreaGeometry } from "../../../src/lib/geo/types";
import { GRIDS, fixtureBytes, global05, manifest, usa05, xmlParse } from "./support";

const load = async (name: string): Promise<NormalizeResult> =>
  normalizeUpload({ name, bytes: fixtureBytes(name) }, {}, { xmlParse });

const geometryOf = async (name: string): Promise<AreaGeometry> => {
  const r = await load(name);
  if (!r.ok) throw new Error(`${name}: ${r.refusal.rule} — ${r.refusal.what}`);
  expect(r.places).toHaveLength(1);
  return r.places[0].geometry;
};

/** every covered cell's centre, in the grid's own frame (`wrap: false` keeps usa05 at 0-360). */
const centres = (geom: AreaGeometry, grid: GridSpec) =>
  cellsInPolygon(geom, grid).map((c) => cellLonLat(c.cell_id, grid, false));

interface Band {
  cells: number;
  lat: [number, number];
  /** longitudes in the grid's OWN frame: usa05 sees the Gulf at 266 and Alaska at 178. */
  lon: { global05: [number, number]; usa05: [number, number] };
}

function assertBand(geom: AreaGeometry, band: Band): void {
  for (const [id, grid] of GRIDS) {
    const cells = cellsInPolygon(geom, grid);
    expect(cells.length, `${id} cell count`).toBe(band.cells);
    expect(
      cells.every((c) => c.pct === 100),
      `${id} every cell wholly covered`,
    ).toBe(true);
    const pts = centres(geom, grid);
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const wantLon = band.lon[id as "global05" | "usa05"];
    expect(Math.min(...lats), `${id} southernmost cell`).toBeGreaterThanOrEqual(band.lat[0]);
    expect(Math.max(...lats), `${id} northernmost cell`).toBeLessThanOrEqual(band.lat[1]);
    expect(Math.min(...lons), `${id} westernmost cell`).toBeGreaterThanOrEqual(wantLon[0]);
    expect(Math.max(...lons), `${id} easternmost cell`).toBeLessThanOrEqual(wantLon[1]);
  }
}

// ---- 1. gulf_rectangle -----------------------------------------------------------------------

describe("gulf_rectangle · the control fixture, in all six formats", () => {
  // 5 deg x 3 deg at 0.05 deg = 100 x 60 cells, every one wholly inside
  const band: Band = {
    cells: 6000,
    lat: [26.5, 29.5],
    lon: { global05: [-93.5, -88.5], usa05: [266.5, 271.5] },
  };

  for (const name of [
    "gulf_rectangle.zip",
    "gulf_rectangle.kml",
    "gulf_rectangle.fgb",
    "gulf_rectangle.wkt",
    "gulf_rectangle.geojson",
    "gulf_rectangle.gpx",
  ]) {
    it(`${name} covers 6,000 Gulf cells on both grids`, async () => {
      assertBand(await geometryOf(name), band);
    });
  }

  it("every format agrees on the same 6,000 cell ids, to the cell", async () => {
    const ids = async (n: string) =>
      cellsInPolygon(await geometryOf(n), global05).map((c) => c.cell_id);
    const reference = await ids("gulf_rectangle.geojson");
    expect(reference).toHaveLength(6000);
    for (const n of [
      "gulf_rectangle.kml",
      "gulf_rectangle.wkt",
      "gulf_rectangle.fgb",
      "gulf_rectangle.gpx",
    ]) {
      expect(await ids(n), n).toEqual(reference);
    }
    // shpjs round-trips through proj4 even for EPSG:4326 -> EPSG:4326, so its corner comes back as
    // 29.500000000000004; the 4e-15 sliver it adds rounds to pct 0 and is dropped, and the cell set
    // is therefore still exactly the same one
    expect(await ids("gulf_rectangle.zip")).toEqual(reference);
  });

  it("matches the R-computed ground truth's vertex count", async () => {
    const g = (await geometryOf("gulf_rectangle.geojson")) as AreaGeometry & { type: "Polygon" };
    expect(g.coordinates[0]).toHaveLength(manifest.gulf_rectangle.vertex_count);
  });
});

// ---- 2. aleutian_dateline ---------------------------------------------------------------------

describe("aleutian_dateline · the same 4,000 cells on both grids", () => {
  // 5 deg x 2 deg = 100 x 40. usa05's window starts at 141.10 E, so 178..183 needs no wrapping
  // there; global05's columns fold modulo nc. Both read the UNWRAPPED ring literally.
  const band: Band = {
    cells: 4000,
    lat: [51, 53],
    lon: { global05: [-180, 183], usa05: [178, 183] },
  };

  for (const name of [
    "aleutian_dateline.zip",
    "aleutian_dateline.kml",
    "aleutian_dateline.fgb",
    "aleutian_dateline.wkt",
  ]) {
    it(`${name} is one continuous place of 4,000 cells`, async () => {
      const g = await geometryOf(name);
      assertBand(g, band);
      // the naive bbox every parser S4 measured reports is 355 deg wide; this one is 5
      const lons = (g as AreaGeometry & { type: "Polygon" }).coordinates[0].map((p) => p[0]);
      expect(Math.max(...lons) - Math.min(...lons)).toBe(
        manifest.aleutian_dateline.true_bbox_width_deg,
      );
      expect(manifest.aleutian_dateline.naive_bbox_width_deg).toBe(355);
    });
  }

  it("all four formats produce the identical ring, despite disagreeing on winding in the file", async () => {
    // S4: shpjs reports the source ring CW (signed area -710) where togeojson/flatgeobuf/WKT report
    // it CCW (+710) — GDAL's shapefile WRITER reversed it. After rule 6 nothing downstream can tell.
    const rings = await Promise.all(
      ["zip", "kml", "fgb", "wkt"].map(async (ext) =>
        JSON.stringify(await geometryOf(`aleutian_dateline.${ext}`)),
      ),
    );
    expect(new Set(rings).size).toBe(1);
    expect(rings[0]).toBe(
      JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [178, 51],
            [183, 51],
            [183, 53],
            [178, 53],
            [178, 51],
          ],
        ],
      }),
    );
  });
});

// ---- 3. multipolygon ----------------------------------------------------------------------------

describe("multipolygon · two disjoint parts, kept as two", () => {
  // two 1 deg x 1 deg rectangles = 2 x 400 cells
  const band: Band = {
    cells: 800,
    lat: [34, 37],
    lon: { global05: [-122, -119], usa05: [238, 241] },
  };

  for (const name of [
    "multipolygon.zip",
    "multipolygon.kml",
    "multipolygon.fgb",
    "multipolygon.wkt",
  ]) {
    it(`${name} covers 800 cells in two parts`, async () => {
      const g = await geometryOf(name);
      expect(g.type).toBe("MultiPolygon");
      expect((g as AreaGeometry & { type: "MultiPolygon" }).coordinates).toHaveLength(2);
      assertBand(g, band);
    });
  }
});

// ---- 4. utm_zone / utm_zone_noprj — the regression this gate is named after -----------------------

describe("utm_zone · the projected shapefile, with and without its .prj", () => {
  it("WITH the .prj, shpjs reprojects and the cells land off Point Arena — not in the Arctic", async () => {
    const g = await geometryOf("utm_zone.zip");
    for (const [id, grid] of GRIDS) {
      const pts = centres(g, grid);
      expect(pts.length, `${id}`).toBe(25);
      // the assertion the regression is named after: LATITUDE, not "non-empty"
      expect(Math.min(...pts.map((p) => p.lat)), id).toBeGreaterThan(38.8);
      expect(Math.max(...pts.map((p) => p.lat)), id).toBeLessThan(39.05);
    }
  });

  it("its cells are exactly the GDAL/PROJ ground truth's cells, on both grids", async () => {
    // non-circular: the expected ring is the one R reprojected with GDAL/PROJ in
    // generate_fixtures.R, not anything shpjs computed
    const truth: AreaGeometry = {
      type: "Polygon",
      coordinates: [manifest.utm_zone.wgs84_ground_truth_ring as [number, number][]],
    };
    const got = await geometryOf("utm_zone.zip");
    for (const [id, grid] of GRIDS) {
      expect(
        cellsInPolygon(got, grid).map((c) => c.cell_id),
        id,
      ).toEqual(cellsInPolygon(truth, grid).map((c) => c.cell_id));
    }
  });

  it("WITHOUT the .prj it is refused, because shpjs returns raw metres and says nothing", async () => {
    const r = await load("utm_zone_noprj.zip");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.rule).toBe("projectedCoordinates");
    // the number in the message is the file's own, so the person can see what was wrong
    expect(r.refusal.what).toContain("4,320,000");
  });

  it("the .fgb and the .wkt of the same rectangle are refused for their own reasons", async () => {
    const fgb = await load("utm_zone.fgb");
    expect(fgb.ok).toBe(false);
    // flatgeobuf's header CARRIES EPSG:32610 correctly and the reader does not reproject
    if (!fgb.ok) expect(fgb.refusal.rule).toBe("projectedCrs");
    const wkt = await load("utm_zone.wkt");
    expect(wkt.ok).toBe(false);
    // plain WKT has no CRS concept at all, so only the magnitudes can say
    if (!wkt.ok) expect(wkt.refusal.rule).toBe("projectedCoordinates");
  });
});

// ---- 5. coastline_40k ------------------------------------------------------------------------------

describe("coastline_40k · 40,000 vertices, refused for its SHAPE, not its size", () => {
  for (const name of [
    "coastline_40k.zip",
    "coastline_40k.kml",
    "coastline_40k.fgb",
    "coastline_40k.wkt",
  ]) {
    it(`${name} is refused as a line, under the 50 k vertex cap`, async () => {
      const r = await load(name);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.refusal.rule).toBe("notPolygon");
      expect(r.refusal.what).toContain("LineString");
      expect(manifest.coastline_40k.vertex_count).toBeLessThan(50_000);
    });
  }

  it("parses all 40,000 vertices well inside a click's worth of time", async () => {
    const t0 = performance.now();
    await load("coastline_40k.fgb");
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

// ---- the two grids really are different --------------------------------------------------------------

describe("the grids are not each other", () => {
  it("a Gulf place has DIFFERENT cell ids on global05 and usa05", async () => {
    // if this ever passed by both grids being the same object, every assertion above would be half
    // a test
    const g = await geometryOf("gulf_rectangle.geojson");
    const a = cellsInPolygon(g, global05).map((c) => c.cell_id);
    const b = cellsInPolygon(g, usa05).map((c) => c.cell_id);
    expect(a).toHaveLength(b.length);
    expect(a[0]).not.toBe(b[0]);
  });
});
