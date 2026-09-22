// parsers/shapefile.ts — zipped shapefile through `shpjs@6.2.0`, loaded LAZILY (46.7 KB gzip, the
// largest of the four parsers and the only one that would be felt on the critical path, S4).
//
// THE ONE THING THIS FILE EXISTS TO ADD. `shpjs` reprojects from the zip's `.prj` via its bundled
// proj4, measured at 0.000000 m from the GDAL/PROJ truth — and when the zip has NO `.prj` it
// returns raw metres SILENTLY: bbox `[500000, 4300000, 520000, 4320000]`, console output literally
// `[]`, no warning, no error, nothing in band (S4, `utm_zone_noprj.zip`). So this parser reads the
// `.prj` ITSELF, out of the zip's central directory, and reports what it found:
//
//   * a `.prj` present  -> `crs = {raw, kind, reprojected: true}`: shpjs has already converted, and
//     the normalizer must NOT then apply its magnitude test to coordinates that are now degrees.
//   * no `.prj`         -> `crs = null`: the normalizer's magnitude test is the only thing standing
//     between a Santa Barbara rectangle and a set of Arctic cells, and it is a gate in OUR code,
//     never a hope that the parser will warn (S4 rule 4).
import { classifyCrsText, crsLabel } from "../crs";
import type { DeclaredCrs, ParsedSource, RawFeature, RawGeometry } from "../types";
import { extractZipEntry, readZipCentralDirectory } from "../zip";

interface ShpFeature {
  geometry?: RawGeometry | null;
  properties?: Record<string, unknown> | null;
}
interface ShpCollection {
  type?: string;
  features?: ShpFeature[];
}

/** the `.prj` text, or null when the zip carries none. Reads ONE small member, nothing else. */
export async function readPrj(bytes: Uint8Array): Promise<string | null> {
  const entries = readZipCentralDirectory(bytes);
  const prj = entries.find((e) => /\.prj$/i.test(e.name) && !e.name.startsWith("__MACOSX/"));
  if (!prj) return null;
  const text = new TextDecoder("utf-8").decode(await extractZipEntry(bytes, prj));
  return text.trim() || null;
}

export async function parseShapefile(fileName: string, bytes: Uint8Array): Promise<ParsedSource> {
  const prj = await readPrj(bytes);
  const crs: DeclaredCrs | null = prj
    ? { raw: crsLabel(prj), kind: classifyCrsText(prj), reprojected: true }
    : null;

  // lazy by contract: `shp*` is on the size budget's forbidden-static list
  // (scripts/size-budget-core.mjs) and `tests/geo/upload/lazyImports.test.ts` re-checks the source.
  const shp = (await import("shpjs")).default;
  // shpjs wants a standalone ArrayBuffer; a subarray view of a larger buffer reads past its end.
  const copy = bytes.slice();
  const out = (await shp(copy.buffer as ArrayBuffer)) as ShpCollection | ShpCollection[];

  const collections = Array.isArray(out) ? out : [out];
  const features: RawFeature[] = [];
  for (const c of collections) {
    for (const f of c?.features ?? []) {
      features.push({
        geometry: (f?.geometry ?? null) as RawGeometry | null,
        properties: f?.properties && typeof f.properties === "object" ? f.properties : {},
      });
    }
  }
  return { format: "shapefile", fileName, features, crs };
}
