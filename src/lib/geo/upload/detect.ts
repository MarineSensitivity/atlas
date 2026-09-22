// geo/upload/detect.ts — which format is this, decided from the BYTES, with the file name only as a
// tie-break (atlas-6 Deliverable 4, step 2's prerequisite).
//
// WHY BYTES FIRST. The name is the one part of an upload the person can get wrong for free: a
// GeoJSON saved as `place.kml`, a shapefile zip renamed `.zip.txt` by a mail gateway. Sniffing the
// magic bytes means the wrong extension costs nothing, and it means a parser is never handed a file
// it cannot possibly read.
//
// WHY IT LOADS NOTHING. This runs before any `import()`: 46.7 KB of `shpjs` must not be fetched to
// discover that the drop was a GeoJSON (S4's cost table). So the whole of this file is literal byte
// comparison and a short text peek — no dependency, and no decompression either.
import type { UploadFormat } from "./types";

/** how far into the file the text sniffs look. Enough for an XML prolog + root element. */
const PEEK_BYTES = 4096;

export interface DetectedFormat {
  format: UploadFormat | null;
  /** what the decision keyed on — quoted into the `unknownFormat` refusal, and asserted by tests. */
  evidence: string;
}

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean => {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
};

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

// "PK\x03\x04" (a normal zip), plus the empty-archive and spanned variants a picker can hand over.
const ZIP_LOCAL = ascii("PK\x03\x04");
const ZIP_EMPTY = ascii("PK\x05\x06");
const ZIP_SPANNED = ascii("PK\x07\x08");
// every GeoPackage is a SQLite 3 database, and SQLite writes this 16-byte header first.
const SQLITE = ascii("SQLite format 3\0");
// flatgeobuf's magic: "fgb" + spec version, then "fgb" + PATCH version. Only the first SEVEN bytes
// are fixed — the eighth is the patch level and differs between files (the library's own constant
// says 0x00; GDAL 3.13 writes 0x01 into every fixture here), which is exactly why the reader
// compares `magicbytes.slice(0, 7)` and so does this.
const FGB7 = [0x66, 0x67, 0x62, 0x03, 0x66, 0x67, 0x62];

const WKT_HEAD =
  /^\s*(?:SRID\s*=\s*\d+\s*;\s*)?(POINT|LINESTRING|LINEARRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*(?:[ZM]{1,2}\s*)?[(E]/i;

/** the extension, lowercased, without the dot; "" when the name has none. */
export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  return m ? m[1].toLowerCase() : "";
}

/** a UTF-8 BOM, which Windows exporters write and which would hide the first `{` or `<`. */
const BOM = 0xfeff;

const peek = (bytes: Uint8Array): string => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, PEEK_BYTES));
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
};

/**
 * Sniff an upload's format without loading a parser.
 *
 * `format: null` is not a failure of this function — it is the answer, and the caller turns it into
 * the `unknownFormat` refusal with the `evidence` string attached, so the person is told what the
 * file actually looked like rather than that it was rejected.
 */
export function detectFormat(fileName: string, bytes: Uint8Array): DetectedFormat {
  const ext = extensionOf(fileName);

  if (startsWith(bytes, SQLITE))
    return { format: "geopackage", evidence: "a SQLite database header" };
  if (startsWith(bytes, FGB7))
    return { format: "flatgeobuf", evidence: "the FlatGeobuf magic bytes" };
  if (
    startsWith(bytes, ZIP_LOCAL) ||
    startsWith(bytes, ZIP_EMPTY) ||
    startsWith(bytes, ZIP_SPANNED)
  ) {
    // a `.kmz` is a zip too; it is not on S4's format list, so it is reported as what it is rather
    // than handed to shpjs to fail inside.
    if (ext === "kmz") return { format: null, evidence: "a zipped KML (.kmz)" };
    return { format: "shapefile", evidence: "a zip archive" };
  }

  const head = peek(bytes);
  const trimmed = head.replace(/^\s+/, "");

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { format: "geojson", evidence: "JSON text" };
  }

  if (trimmed.startsWith("<")) {
    // the root element, past any `<?xml ?>` prolog, any comment and any namespace prefix
    const root = /<(?:[A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)[\s>/]/.exec(
      trimmed.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, ""),
    );
    const name = root ? root[1].toLowerCase() : "";
    if (name === "kml") return { format: "kml", evidence: "a <kml> document" };
    if (name === "gpx") return { format: "gpx", evidence: "a <gpx> document" };
    // some exporters wrap KML in a bare <Document>/<Folder>; fall back to the name, which is the
    // only evidence left, rather than guessing between two XML dialects.
    if (ext === "kml") return { format: "kml", evidence: "XML text named .kml" };
    if (ext === "gpx") return { format: "gpx", evidence: "XML text named .gpx" };
    return { format: null, evidence: `an XML document whose root is <${name || "?"}>` };
  }

  if (WKT_HEAD.test(trimmed)) {
    return { format: "wkt", evidence: "text beginning with a WKT geometry keyword" };
  }

  return {
    format: null,
    evidence: bytes.length === 0 ? "an empty file" : `bytes beginning ${hexHead(bytes)}`,
  };
}

function hexHead(bytes: Uint8Array): string {
  return [...bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}
