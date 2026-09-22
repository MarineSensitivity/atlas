// geo/upload/types.ts — the ONE intermediate shape every parser returns, and the refusal shape the
// normalizer returns (atlas-6 Deliverable 4; spike verdict docs/spikes/S4.md rule 3).
//
// WHY ONE SHAPE. S4 measured that no parser does any of the three things a place needs — reject
// projected coordinates, rewind rings to RFC 7946, handle the antimeridian — and that each parser
// gets a DIFFERENT one of them wrong (shpjs reprojects but is silent without a `.prj`; flatgeobuf
// carries the CRS and never reprojects; WKT has no CRS concept at all). So the parsers are
// deliberately dumb: bytes in, `ParsedSource` out, plus whatever CRS the FILE ITSELF declares. Every
// judgement lives in `normalize.ts`, which is the only place that has to be right.

/** the formats atlas-6 accepts (S4 verdict; `geopackage` is the consented best-effort path). */
export type UploadFormat =
  "geojson" | "shapefile" | "kml" | "gpx" | "flatgeobuf" | "wkt" | "geopackage";

/**
 * A geometry exactly as the parser produced it — ANY GeoJSON type, coordinates unvalidated.
 *
 * Deliberately not `AreaGeometry`: "points and lines are refused with a sentence, not buffered"
 * (Deliverable 4) is a rule the normalizer applies and reports, so a point has to be able to reach
 * it. A parser that narrowed the type here would turn that refusal into a silent drop.
 */
export interface RawGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: RawGeometry[];
}

export interface RawFeature {
  geometry: RawGeometry | null;
  /** untrusted: only the ONE chosen name ever survives this, and only as plain text. */
  properties: Record<string, unknown>;
}

export type CrsKind = "geographic" | "projected" | "unknown";

/** what the FILE declares about its coordinate system — never a guess about the numbers. */
export interface DeclaredCrs {
  /** as the file wrote it: a `.prj` WKT, an `EPSG:code`, a GeoJSON-2008 `crs` URN. */
  raw: string;
  kind: CrsKind;
  /**
   * the parser has ALREADY put the coordinates in WGS84 lon/lat (only `shpjs`, and only when the
   * zip carries a `.prj` — measured at 0.000000 m from the GDAL/PROJ truth, S4).
   */
  reprojected: boolean;
}

export interface ParsedSource {
  format: UploadFormat;
  fileName: string;
  features: RawFeature[];
  /** `null` means the file declares NO coordinate system — then, and only then, the magnitude
   * check in `normalize.ts` gets to speak (S4 rule 3: a declared CRS is always authoritative). */
  crs: DeclaredCrs | null;
}

/**
 * Why a file was not accepted, in the four parts the `design:ux-copy` rule asks for.
 *
 * `rule` is the machine-readable id (one per rule of Deliverable 4, so a test can name the branch
 * it is asserting); `what`/`why`/`fix` are the sentences the panel renders. None of them ever says
 * "invalid file" — `tests/geo/upload/messages.test.ts` is the gate for that.
 */
export interface Refusal {
  rule: string;
  what: string;
  why: string;
  fix: string;
}

/** a parser failure that already knows which rule it broke (e.g. a declined GeoPackage consent). */
export class UploadParseError extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(`${refusal.rule}: ${refusal.what}`);
    this.name = "UploadParseError";
    this.refusal = refusal;
  }
}
