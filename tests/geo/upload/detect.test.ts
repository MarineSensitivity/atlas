// One case per sniff, because a format decided from the wrong evidence sends a file to a parser
// that cannot read it and turns a clear refusal into a stack trace.
import { describe, expect, it } from "vitest";
import { detectFormat, extensionOf } from "../../../src/lib/geo/upload/detect";
import { fixtureBytes, textBytes } from "./support";

describe("detectFormat reads the bytes, not the name", () => {
  it("a zipped shapefile is a zip archive", () => {
    expect(detectFormat("gulf_rectangle.zip", fixtureBytes("gulf_rectangle.zip"))).toEqual({
      format: "shapefile",
      evidence: "a zip archive",
    });
  });

  it("a FlatGeobuf is its magic bytes — the first SEVEN, the eighth being a patch level", () => {
    // GDAL writes 0x01 where the library's own constant says 0x00; matching all eight rejects every
    // real file, which is the bug this case exists to keep fixed.
    expect(detectFormat("x.fgb", fixtureBytes("gulf_rectangle.fgb")).format).toBe("flatgeobuf");
    expect(fixtureBytes("gulf_rectangle.fgb")[7]).toBe(0x01);
  });

  it("a GeoPackage is a SQLite database header", () => {
    expect(detectFormat("x.gpkg", fixtureBytes("gulf_rectangle.gpkg"))).toEqual({
      format: "geopackage",
      evidence: "a SQLite database header",
    });
  });

  it("KML and GPX are told apart by their root element, not their extension", () => {
    expect(detectFormat("x.gpx", fixtureBytes("gulf_rectangle.kml")).format).toBe("kml");
    expect(detectFormat("x.kml", fixtureBytes("gulf_rectangle.gpx")).format).toBe("gpx");
  });

  it("a GeoJSON saved under a .kml name is still GeoJSON", () => {
    expect(detectFormat("place.kml", fixtureBytes("gulf_rectangle.geojson")).format).toBe(
      "geojson",
    );
  });

  it("a bare JSON array is GeoJSON too (a paste, not an export)", () => {
    expect(detectFormat("paste.txt", textBytes("  [1,2]")).format).toBe("geojson");
  });

  it("pasted WKT is its geometry keyword, with or without an SRID prefix", () => {
    expect(detectFormat("paste.txt", fixtureBytes("gulf_rectangle.wkt")).format).toBe("wkt");
    expect(detectFormat("p.txt", textBytes("SRID=4326;POLYGON((0 0,1 0,1 1,0 0))")).format).toBe(
      "wkt",
    );
    expect(detectFormat("p.txt", textBytes("multipolygon z (((0 0 1,1 0 1)))")).format).toBe("wkt");
  });

  it("a .kmz is named rather than handed to the shapefile parser", () => {
    expect(detectFormat("place.kmz", fixtureBytes("gulf_rectangle.zip"))).toEqual({
      format: null,
      evidence: "a zipped KML (.kmz)",
    });
  });

  it("an unknown XML dialect says which root it found", () => {
    expect(
      detectFormat("x.xml", textBytes('<?xml version="1.0"?><osm version="0.6"></osm>')),
    ).toEqual({
      format: null,
      evidence: "an XML document whose root is <osm>",
    });
  });

  it("XML with an unrecognized root falls back to the extension, and only then", () => {
    expect(detectFormat("x.kml", textBytes("<Document><Placemark/></Document>")).format).toBe(
      "kml",
    );
    expect(detectFormat("x.gpx", textBytes("<Document><Placemark/></Document>")).format).toBe(
      "gpx",
    );
  });

  it("plain prose and an empty file are both reported as themselves", () => {
    expect(detectFormat("notes.txt", textBytes("hello")).format).toBeNull();
    expect(detectFormat("empty.bin", new Uint8Array(0))).toEqual({
      format: null,
      evidence: "an empty file",
    });
  });

  it("loads nothing: the sniff is byte comparison, so it cannot be async", () => {
    expect(detectFormat("x.zip", fixtureBytes("gulf_rectangle.zip"))).not.toBeInstanceOf(Promise);
  });
});

describe("extensionOf", () => {
  it("lowercases and drops the dot; a name without one gives an empty string", () => {
    expect(extensionOf("Place.GeoJSON")).toBe("geojson");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("README")).toBe("");
  });
});
