// The central-directory reader, on its own: the zip-bomb rule is only as good as the numbers it
// reads, and those numbers come from here.
import { describe, expect, it } from "vitest";
import {
  extractZipEntry,
  readZipCentralDirectory,
  zipTotals,
  ZipFormatError,
} from "../../../src/lib/geo/upload/zip";
import { fixtureBytes } from "./support";
import { buildZip, zipBomb, zipWith300Entries } from "./hostile";

describe("readZipCentralDirectory", () => {
  it("lists a real shapefile zip's members", () => {
    const entries = readZipCentralDirectory(fixtureBytes("gulf_rectangle.zip"));
    expect(entries.map((e) => e.name).sort()).toEqual([
      "gulf_rectangle.dbf",
      "gulf_rectangle.prj",
      "gulf_rectangle.shp",
      "gulf_rectangle.shx",
    ]);
    expect(entries.every((e) => e.uncompressedSize > 0)).toBe(true);
  });

  it("the .prj-less fixture really has no .prj (the silence shpjs is pinned for)", () => {
    const names = readZipCentralDirectory(fixtureBytes("utm_zone_noprj.zip")).map((e) => e.name);
    expect(names).not.toContain("utm_zone.prj");
    expect(readZipCentralDirectory(fixtureBytes("utm_zone.zip")).map((e) => e.name)).toContain(
      "utm_zone.prj",
    );
  });

  it("reads the DECLARED uncompressed size, not the bytes on disk", () => {
    const bomb = zipBomb();
    const totals = zipTotals(readZipCentralDirectory(bomb));
    expect(totals.uncompressedBytes).toBe(60 * 1024 * 1024);
    // ... from an archive of a few hundred bytes: nothing was unpacked to learn that
    expect(bomb.length).toBeLessThan(4096);
  });

  it("counts entries without touching one of them", () => {
    expect(zipTotals(readZipCentralDirectory(zipWith300Entries())).entryCount).toBe(300);
  });

  it("refuses an archive with no end-of-central-directory record", () => {
    const truncated = fixtureBytes("gulf_rectangle.zip").slice(0, 100);
    expect(() => readZipCentralDirectory(truncated)).toThrow(ZipFormatError);
  });

  it("refuses a zip64 archive rather than half-reading its sizes", () => {
    const z = buildZip([{ name: "a.shp", declaredUncompressed: 8, data: new Uint8Array([1, 2]) }]);
    // park the zip64 sentinel in the central directory's uncompressed-size slot
    const at = z.length - 22 - (46 + 5);
    new DataView(z.buffer).setUint32(at + 24, 0xffffffff, true);
    expect(() => readZipCentralDirectory(z)).toThrow(/zip64/);
  });
});

describe("extractZipEntry", () => {
  it("inflates one member — the .prj, and only the .prj", async () => {
    const bytes = fixtureBytes("utm_zone.zip");
    const prj = readZipCentralDirectory(bytes).find((e) => e.name.endsWith(".prj"))!;
    const text = new TextDecoder().decode(await extractZipEntry(bytes, prj));
    // ESRI WKT, with no EPSG id anywhere in it — which is exactly why crs.ts classifies by the
    // OUTERMOST keyword rather than by looking for a code
    expect(text).toContain("PROJCS");
    expect(text).toContain("Transverse_Mercator");
    expect(text).not.toContain("32610");
  });
});
