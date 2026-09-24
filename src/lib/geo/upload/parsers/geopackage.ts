// parsers/geopackage.ts — the ONE consented, best-effort, third-party path (S4 rule 2, master plan
// D14; the verdict's exact words: "prompted, lazy, not mirrored, and falls back to convert to
// GeoJSON").
//
// WHAT MAKES IT DIFFERENT FROM EVERY OTHER PARSER HERE. A `.gpkg` is read by DuckDB's `spatial`
// extension, which is 22.4 MB, is NOT self-hosted (S3/S4's shared hosting rule: the app mirrors
// only the extensions on its core data path, and `spatial` is dead weight for the vast majority of
// sessions that never drop one), and is fetched from `extensions.duckdb.org` — a third-party host
// nothing else in this app contacts. So:
//
//   1. the person is asked FIRST, with the size and the host named, and "convert to GeoJSON or
//      FlatGeobuf instead" offered alongside; a decline is a refusal, not an error;
//   2. the extension is loaded LAZILY and only on a `.gpkg`, never on the first-paint path;
//   3. `INSTALL`/`LOAD` failing is EXPECTED (ad blocker, corporate DNS, blocked host — S4 measured
//      the exact message) and is a clean, catchable SQL error, unlike `read_parquet`'s implicit
//      autoload, so it degrades to the fallback sentence rather than crashing the tab.
//
// No geometry leaves the browser either way: the 22 MB is inbound, and the user's file is never
// uploaded anywhere.
import {
  geopackageDeclined,
  geopackageNoFeatureTable,
  geopackageNoRuntime,
  geopackageUnavailable,
} from "../messages";
import { classifyCrsText, classifyEpsg } from "../crs";
import {
  UploadParseError,
  type DeclaredCrs,
  type ParsedSource,
  type RawFeature,
  type RawGeometry,
} from "../types";

/** measured on the pinned engine (DuckDB 1.32.0 -> extension v1.4.3, `wasm_eh`), S4 part (b). */
export const SPATIAL_EXTENSION_BYTES = 23_469_719;
export const SPATIAL_EXTENSION_HOST = "extensions.duckdb.org";

/** what this parser needs from atlas-2's `Engine`, structurally — never the class itself, so a test
 * can drive every branch without a worker or a WASM module. */
export interface GeoPackageRuntime {
  registerFile(name: string, bytes: Uint8Array): Promise<void>;
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  dropFile?(name: string): Promise<void>;
}

export interface GeoPackageConsentRequest {
  fileName: string;
  bytes: number;
  host: string;
}

export interface GeoPackageDeps {
  /** resolve `true` only on an explicit yes; anything else is a decline, and a decline is final. */
  consent: (request: GeoPackageConsentRequest) => Promise<boolean>;
  runtime: GeoPackageRuntime | null;
}

/** single-quote escaping for the one value that reaches SQL here (the registered file name). */
const sqlLit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** a registered name that cannot collide and cannot carry anything interesting into SQL. */
const registeredName = (fileName: string): string =>
  `upload_${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;

interface MetaRow {
  auth_name?: unknown;
  auth_srid?: unknown;
  srs_wkt?: unknown;
  definition?: unknown;
}

function crsFromMeta(rows: MetaRow[]): DeclaredCrs | null {
  const row = rows[0];
  if (!row) return null;
  const org = typeof row.auth_name === "string" ? row.auth_name : null;
  const code = Number(row.auth_srid);
  const wkt =
    typeof row.definition === "string"
      ? row.definition
      : typeof row.srs_wkt === "string"
        ? row.srs_wkt
        : "";
  if (org && /^EPSG$/i.test(org) && Number.isInteger(code) && code > 0) {
    return { raw: `${org}:${code}`, kind: classifyEpsg(code), reprojected: false };
  }
  if (wkt) return { raw: wkt.slice(0, 60), kind: classifyCrsText(wkt), reprojected: false };
  return null;
}

export async function parseGeoPackage(
  fileName: string,
  bytes: Uint8Array,
  deps: GeoPackageDeps | undefined,
): Promise<ParsedSource> {
  if (!deps?.runtime) throw new UploadParseError(geopackageNoRuntime(fileName));

  const accepted = await deps.consent({
    fileName,
    bytes: SPATIAL_EXTENSION_BYTES,
    host: SPATIAL_EXTENSION_HOST,
  });
  if (!accepted) throw new UploadParseError(geopackageDeclined(fileName));

  const rt = deps.runtime;
  try {
    await rt.query("INSTALL spatial;");
    await rt.query("LOAD spatial;");
  } catch (err) {
    throw new UploadParseError(geopackageUnavailable(fileName, describe(err)));
  }

  const name = registeredName(fileName);
  await rt.registerFile(name, bytes);
  try {
    // does this GeoPackage carry a vector (features) layer at all? `gpkg_contents.data_type` also
    // covers `2d-gridded-coverage`/tile pyramids and plain attribute tables with no geometry column
    // — real GeoPackage contents `ST_Read`'s default (first-layer) read cannot turn into a place.
    // The same `sqlite_scan` this parser already needs for the CRS lookup below, so it gets the
    // same best-effort rule: a build without `sqlite_scanner` cannot ask, and falls through to let
    // `ST_Read` itself speak (as a generic `parseFailed`) rather than refusing on a guess.
    try {
      const contents = await rt.query<{ n: unknown }>(
        `SELECT count(*) AS n FROM sqlite_scan(${sqlLit(name)}, 'gpkg_contents') WHERE data_type = 'features';`,
      );
      if (Number(contents[0]?.n ?? 0) === 0) {
        throw new UploadParseError(geopackageNoFeatureTable(fileName));
      }
    } catch (err) {
      if (err instanceof UploadParseError) throw err;
      // no sqlite_scan available -- fall through, same reasoning as the CRS lookup just below
    }

    // the layer's declared CRS, straight out of the GeoPackage's own `gpkg_spatial_ref_sys` table:
    // `ST_Read` behaves like every non-shpjs reader S4 measured and hands back raw source units, so
    // this row is the only thing that can say the file is projected.
    let crs: DeclaredCrs | null = null;
    try {
      crs = crsFromMeta(
        await rt.query<MetaRow>(
          `SELECT s.organization AS auth_name, s.organization_coordsys_id AS auth_srid, s.definition AS definition
             FROM sqlite_scan(${sqlLit(name)}, 'gpkg_contents') c
             JOIN sqlite_scan(${sqlLit(name)}, 'gpkg_spatial_ref_sys') s ON s.srs_id = c.srs_id
            LIMIT 1;`,
        ),
      );
    } catch {
      // an older GeoPackage, or a build without `sqlite_scan`: fall through with no declared CRS,
      // and let the magnitude test in normalize.ts speak. Never a reason to fail the whole read.
      crs = null;
    }

    const rows = await rt.query<Record<string, unknown>>(
      `SELECT ST_AsGeoJSON(geom) AS __geometry, * EXCLUDE (geom) FROM ST_Read(${sqlLit(name)});`,
    );
    const features: RawFeature[] = rows.map((row) => {
      const { __geometry, ...properties } = row;
      let geometry: RawGeometry | null = null;
      if (typeof __geometry === "string" && __geometry) {
        geometry = JSON.parse(__geometry) as RawGeometry;
      }
      return { geometry, properties };
    });
    return { format: "geopackage", fileName, features, crs };
  } finally {
    await rt.dropFile?.(name);
  }
}

const describe = (err: unknown): string => {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 90 ? `${m.slice(0, 87)}…` : m;
};
