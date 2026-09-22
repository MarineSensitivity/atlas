// One test per parser, asserting the ONE thing that parser is pinned for (docs/spikes/S4.md and
// package.json's pinReasons), plus the GeoPackage consent path in full.
//
// The parsers themselves are deliberately dumb — bytes in, `ParsedSource` out — so what is asserted
// here is the intermediate shape and the CRS each one reports, not geography: that is
// fixtures.test.ts's job, through the normalizer.
import { describe, expect, it, vi } from "vitest";
import { parseByFormat } from "../../../src/lib/geo/upload/parsers";
import { parseWktGeometry, parseWktText } from "../../../src/lib/geo/upload/parsers/wkt";
import { crsFromHeader } from "../../../src/lib/geo/upload/parsers/flatgeobuf";
import { readPrj } from "../../../src/lib/geo/upload/parsers/shapefile";
import { trackToArea } from "../../../src/lib/geo/upload/parsers/gpx";
import {
  SPATIAL_EXTENSION_BYTES,
  SPATIAL_EXTENSION_HOST,
  parseGeoPackage,
  type GeoPackageRuntime,
} from "../../../src/lib/geo/upload/parsers/geopackage";
import { classifyCrsText, classifyEpsg } from "../../../src/lib/geo/upload/crs";
import { UploadParseError } from "../../../src/lib/geo/upload/types";
import { fixtureBytes, textBytes, xmlParse } from "./support";

describe("shapefile (shpjs@6.2.0)", () => {
  it("reports the .prj it found, and that shpjs has ALREADY reprojected with it", async () => {
    const p = await parseByFormat("shapefile", "utm_zone.zip", fixtureBytes("utm_zone.zip"));
    expect(p.crs?.kind).toBe("projected");
    expect(p.crs?.reprojected).toBe(true);
    expect(p.crs?.raw).toBe("WGS_1984_UTM_Zone_10N");
  });

  it("reports NO crs when the zip has none — the silence the pin exists for", async () => {
    const p = await parseByFormat(
      "shapefile",
      "utm_zone_noprj.zip",
      fixtureBytes("utm_zone_noprj.zip"),
    );
    expect(p.crs).toBeNull();
    // and the coordinates really are raw metres, exactly as S4 measured
    const ring = (p.features[0].geometry as { coordinates: number[][][] }).coordinates[0];
    expect(Math.max(...ring.map((c) => c[1]))).toBe(4_320_000);
  });

  it("readPrj reads ONE member and returns null when there is none", async () => {
    expect(await readPrj(fixtureBytes("utm_zone_noprj.zip"))).toBeNull();
    expect(await readPrj(fixtureBytes("utm_zone.zip"))).toContain("PROJCS");
  });
});

describe("KML / GPX (@tmcw/togeojson@7.1.2)", () => {
  it("KML declares WGS84 because the FORMAT does, not because the file says so", async () => {
    const p = await parseByFormat("kml", "gulf_rectangle.kml", fixtureBytes("gulf_rectangle.kml"), {
      xmlParse,
    });
    expect(p.crs).toEqual({
      raw: "EPSG:4326 (fixed by the KML format)",
      kind: "geographic",
      reprojected: false,
    });
    expect(p.features[0].geometry?.type).toBe("Polygon");
  });

  it("a truncated KML is a parse failure, not a document with no shapes in it", async () => {
    // DOMParser never throws: it returns a <parsererror> document, and togeojson finds nothing in it
    await expect(
      parseByFormat("kml", "torn.kml", textBytes("<kml><Placemark>"), { xmlParse }),
    ).rejects.toThrow();
  });

  it("GPX: a closed track becomes a ring; an open one is left as a line for rule 3 to name", async () => {
    const closed = await parseByFormat(
      "gpx",
      "gulf_rectangle.gpx",
      fixtureBytes("gulf_rectangle.gpx"),
      { xmlParse },
    );
    expect(closed.features[0].geometry?.type).toBe("Polygon");
    const open = await parseByFormat("gpx", "open_track.gpx", fixtureBytes("open_track.gpx"), {
      xmlParse,
    });
    expect(open.features[0].geometry?.type).toBe("LineString");
  });

  it("trackToArea never invents a coordinate", () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(trackToArea({ type: "LineString", coordinates: ring })).toEqual({
      type: "Polygon",
      coordinates: [ring],
    });
    const open = { type: "LineString", coordinates: ring.slice(0, 3) };
    expect(trackToArea(open)).toBe(open);
    expect(trackToArea({ type: "Point", coordinates: [0, 0] })?.type).toBe("Point");
    expect(trackToArea(null)).toBeNull();
  });
});

describe("FlatGeobuf (flatgeobuf@4.4.0)", () => {
  it("reports the header CRS correctly and does NOT reproject — the division of labour it is pinned for", async () => {
    const p = await parseByFormat("flatgeobuf", "utm_zone.fgb", fixtureBytes("utm_zone.fgb"));
    expect(p.crs).toEqual({ raw: "EPSG:32610", kind: "projected", reprojected: false });
    const ring = (p.features[0].geometry as { coordinates: number[][][] }).coordinates[0];
    expect(Math.max(...ring.map((c) => c[0]))).toBe(520_000);
  });

  it("crsFromHeader: an EPSG code decides; falling back to the WKT when it cannot", () => {
    expect(crsFromHeader({ crs: { org: "EPSG", code: 4326 } })?.kind).toBe("geographic");
    expect(crsFromHeader({ crs: { org: "EPSG", code: 32610 } })?.kind).toBe("projected");
    expect(crsFromHeader({ crs: { wkt: 'PROJCRS["x",...]' } })?.kind).toBe("projected");
    expect(crsFromHeader(null)).toBeNull();
    expect(crsFromHeader({ crs: {} })).toBeNull();
  });
});

describe("WKT (hand-rolled, no dependency)", () => {
  it("parses every geometry type rather than throwing, so rule 3 gets to speak", () => {
    expect(parseWktGeometry("POINT (1 2)")).toEqual({ type: "Point", coordinates: [1, 2] });
    expect(parseWktGeometry("LINESTRING(1 2, 3 4)").type).toBe("LineString");
    expect(parseWktGeometry("POLYGON ((0 0,1 0,1 1,0 0))").coordinates).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ]);
    expect(parseWktGeometry("MULTIPOLYGON (((0 0,1 0,1 1,0 0)),((2 2,3 2,3 3,2 2)))").type).toBe(
      "MultiPolygon",
    );
  });

  it("keeps the polygon's holes, in order", () => {
    const g = parseWktGeometry("POLYGON ((0 0,4 0,4 4,0 0),(1 1,2 1,2 2,1 1))");
    expect((g.coordinates as number[][][]).length).toBe(2);
  });

  it("drops Z and M ordinates instead of reading them as another coordinate", () => {
    expect(parseWktGeometry("POINT Z (1 2 3)")).toEqual({ type: "Point", coordinates: [1, 2] });
  });

  it("understands EMPTY and a GEOMETRYCOLLECTION", () => {
    expect(parseWktGeometry("POLYGON EMPTY").coordinates).toEqual([]);
    const gc = parseWktGeometry("GEOMETRYCOLLECTION(POINT(1 2),POLYGON((0 0,1 0,1 1,0 0)))");
    expect(gc.geometries?.map((g) => g.type)).toEqual(["Point", "Polygon"]);
  });

  it("reads PostGIS's SRID prefix as a declared CRS — the only one WKT can carry", () => {
    expect(parseWktText("p.wkt", "SRID=32610;POLYGON((0 0,1 0,1 1,0 0))").crs).toEqual({
      raw: "EPSG:32610",
      kind: "projected",
      reprojected: false,
    });
    expect(parseWktText("p.wkt", "POLYGON((0 0,1 0,1 1,0 0))").crs).toBeNull();
  });

  it("treats each line of a paste as its own geometry", () => {
    const p = parseWktText("p.wkt", "POLYGON((0 0,1 0,1 1,0 0))\nPOLYGON((2 2,3 2,3 3,2 2))\n");
    expect(p.features).toHaveLength(2);
  });

  it("says what it could not read, rather than returning an empty geometry", () => {
    expect(() => parseWktGeometry("CIRCULARSTRING(0 0,1 1,2 0)")).toThrow(/not a geometry type/);
    expect(() => parseWktGeometry("just some words")).toThrow(/no geometry keyword/);
  });
});

describe("GeoPackage (DuckDB spatial, consented and best-effort)", () => {
  const rows = [
    {
      __geometry: JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [-93.5, 26.5],
            [-93.5, 29.5],
            [-88.5, 29.5],
            [-88.5, 26.5],
            [-93.5, 26.5],
          ],
        ],
      }),
      id: 1,
    },
  ];
  const runtime = (overrides: Partial<GeoPackageRuntime> = {}): GeoPackageRuntime => ({
    registerFile: vi.fn(async () => {}),
    query: vi.fn(async (sql: string) => {
      if (/ST_Read\(/.test(sql)) return rows as never;
      if (/gpkg_spatial_ref_sys/.test(sql)) {
        return [{ auth_name: "EPSG", auth_srid: 4326, definition: "" }] as never;
      }
      return [] as never;
    }),
    dropFile: vi.fn(async () => {}),
    ...overrides,
  });

  it("asks FIRST, naming the size and the third-party host", async () => {
    const consent = vi.fn(async () => true);
    await parseGeoPackage("place.gpkg", new Uint8Array([1]), { consent, runtime: runtime() });
    expect(consent).toHaveBeenCalledWith({
      fileName: "place.gpkg",
      bytes: SPATIAL_EXTENSION_BYTES,
      host: SPATIAL_EXTENSION_HOST,
    });
    expect(SPATIAL_EXTENSION_HOST).toBe("extensions.duckdb.org");
    expect(SPATIAL_EXTENSION_BYTES).toBeGreaterThan(22 * 1024 * 1024);
  });

  it("a decline is a refusal offering the conversion, and nothing is loaded", async () => {
    const rt = runtime();
    await expect(
      parseGeoPackage("place.gpkg", new Uint8Array([1]), {
        consent: async () => false,
        runtime: rt,
      }),
    ).rejects.toMatchObject({ refusal: { rule: "geopackageDeclined" } });
    expect(rt.query).not.toHaveBeenCalled();
    expect(rt.registerFile).not.toHaveBeenCalled();
  });

  it("a blocked extensions.duckdb.org degrades to the fallback sentence, carrying the real error", async () => {
    // S4 measured this exact message with every non-localhost host blocked
    const blocked = "Failed to execute 'send' on 'XMLHttpRequest': Failed to load";
    const rt = runtime({
      query: vi.fn(async (sql: string) => {
        if (/LOAD spatial/.test(sql)) throw new Error(blocked);
        return [] as never;
      }),
    });
    const err = await parseGeoPackage("place.gpkg", new Uint8Array([1]), {
      consent: async () => true,
      runtime: rt,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadParseError);
    expect((err as UploadParseError).refusal.rule).toBe("geopackageUnavailable");
    expect((err as UploadParseError).refusal.what).toContain("XMLHttpRequest");
    expect((err as UploadParseError).refusal.fix).toContain("GeoJSON");
  });

  it("with no engine at all it says so, rather than asking for a download it cannot use", async () => {
    await expect(
      parseGeoPackage("place.gpkg", new Uint8Array([1]), {
        consent: async () => true,
        runtime: null,
      }),
    ).rejects.toMatchObject({ refusal: { rule: "geopackageNoRuntime" } });
  });

  it("on consent it loads spatial, reads the layer's CRS, and drops the file afterwards", async () => {
    const rt = runtime();
    const p = await parseGeoPackage("place.gpkg", new Uint8Array([1]), {
      consent: async () => true,
      runtime: rt,
    });
    const sql = (rt.query as unknown as { mock: { calls: string[][] } }).mock.calls.map(
      (c) => c[0],
    );
    expect(sql[0]).toContain("INSTALL spatial");
    expect(sql[1]).toContain("LOAD spatial");
    expect(p.crs).toEqual({ raw: "EPSG:4326", kind: "geographic", reprojected: false });
    expect(p.features[0].geometry?.type).toBe("Polygon");
    expect(rt.dropFile).toHaveBeenCalled();
  });

  it("an unreadable CRS table is not a reason to fail the read", async () => {
    const rt = runtime({
      query: vi.fn(async (sql: string) => {
        if (/gpkg_spatial_ref_sys/.test(sql)) throw new Error("no function sqlite_scan");
        if (/ST_Read\(/.test(sql)) return rows as never;
        return [] as never;
      }),
    });
    const p = await parseGeoPackage("place.gpkg", new Uint8Array([1]), {
      consent: async () => true,
      runtime: rt,
    });
    // ... the magnitude test in normalize.ts is then the only thing that can speak, which is exactly
    // the arrangement S4 rule 3 describes
    expect(p.crs).toBeNull();
    expect(p.features).toHaveLength(1);
  });
});

describe("crs classification", () => {
  it("PROJCS wins over the GEOGCS nested inside it — the Arctic regression, in one line", () => {
    const esri =
      'PROJCS["WGS_1984_UTM_Zone_10N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]],PROJECTION["Transverse_Mercator"]]';
    expect(classifyCrsText(esri)).toBe("projected");
  });

  it("reads plain GEOGCS, the EPSG geodetic block, and the CRS84 spellings", () => {
    expect(classifyCrsText('GEOGCS["GCS_WGS_1984"]')).toBe("geographic");
    expect(classifyCrsText("EPSG:4326")).toBe("geographic");
    expect(classifyCrsText("urn:ogc:def:crs:OGC:1.3:CRS84")).toBe("geographic");
    expect(classifyEpsg(4269)).toBe("geographic");
    expect(classifyEpsg(3857)).toBe("projected");
  });

  it("says unknown rather than guessing, so the magnitudes decide", () => {
    expect(classifyCrsText("some local grid")).toBe("unknown");
    expect(classifyCrsText("")).toBe("unknown");
    expect(classifyEpsg(0)).toBe("unknown");
  });
});
